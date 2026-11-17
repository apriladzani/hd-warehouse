import express, { Router, type Request, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNT_CODE, ATTACHMENT_PATH, parseFilter } from './validation.ts';
import { planTransactionChange, TransactionRuleError, type TransactionRecord, type AuditPlan } from './transactionPlan.ts';
import { canManageFinance } from './access.ts';
import { decimal } from './decimal.ts';
import type { Filter } from './domain.ts';

export type Actor = { id: number; role: string; name?: string };
export type TransactionChange = { id: string; expectedVersion: number | null; plan: (before: TransactionRecord | null) => { record: TransactionRecord; audit: AuditPlan } };
export interface TransactionRepository {
  list(filter: Filter): Promise<TransactionRecord[]>;
  // Must atomically lock/read, compare expected version/idempotency key,
  // validate period, outlet and account, and commit record + audit together.
  change(id: string, expectedVersion: number | null, plan: TransactionChange['plan'], actor?: Actor): Promise<TransactionRecord>;
  changeMany(changes: TransactionChange[], actor?: Actor): Promise<TransactionRecord[]>;
}

// A write must come from the app's own pages (CSRF protection). Accepted when
// the browser itself says so (Sec-Fetch-Site: same-origin — set by the browser,
// not by page scripts, and correct behind any proxy such as the Vite dev proxy
// or the hosting gateway, which rewrite Host), or when Origin is the request's
// own origin or one of trustedOrigins (the app's public URL). A cross-site page
// gets "cross-site" and an Origin of its own, so it is refused.
export function sameOrigin(req: Request, trustedOrigins: string[] = []): boolean {
  const site = req.header('Sec-Fetch-Site');
  if (site === 'cross-site' || site === 'same-site') return false;
  if (site === 'same-origin') return true;
  const origin = req.header('Origin');
  return !!origin && (origin === `${req.protocol}://${req.get('host')}` || trustedOrigins.includes(origin));
}

// Finance writes need the FINANCE role and a same-origin request (sameOrigin).
export function financeWriteGuard(authenticate: (req: Request) => Promise<Actor | null>, trustedOrigins: string[] = []): RequestHandler {
  return async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const actor = await authenticate(req);
      if (!actor) { res.status(401).json({ error: 'Login required' }); return; }
      if (!canManageFinance(actor.role)) { res.status(403).json({ error: 'Finance role required' }); return; }
      if (req.method !== 'GET' && !sameOrigin(req, trustedOrigins)) { res.status(403).json({ error: 'Same-origin request required' }); return; }
      res.locals.actor = actor; next();
    } catch { res.status(503).json({ error: 'Transaction authentication unavailable' }); }
  };
}

export class EntryInputError extends Error {}
// Friendly checks for one typed-in row before the strict ledger validation.
export function entryInput(body: any, row = ''): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new EntryInputError(`${row}Data entri tidak valid.`);
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new EntryInputError(`${row}Tanggal transaksi wajib diisi.`);
  const unit = body.unit;
  if (!unit || (unit.type !== 'WAREHOUSE' && !(unit.type === 'OUTLET' && Number.isSafeInteger(unit.outletId) && unit.outletId > 0))) throw new EntryInputError(`${row}Pilih unit/outlet.`);
  if (typeof body.accountCode !== 'string' || !ACCOUNT_CODE.test(body.accountCode)) throw new EntryInputError(`${row}Pilih kode biaya.`);
  let amount: bigint;
  try { amount = decimal(String(body.amount ?? '')); } catch { throw new EntryInputError(`${row}Nominal wajib diisi dengan angka Rupiah yang valid.`); }
  if (amount <= 0n) throw new EntryInputError(`${row}Nominal harus lebih dari Rp0.`);
  if (typeof body.notes !== 'string' || !body.notes.trim()) throw new EntryInputError(`${row}Keterangan wajib diisi.`);
  if (body.notes.length > 500) throw new EntryInputError(`${row}Keterangan maksimal 500 karakter.`);
  if (body.reference != null && (typeof body.reference !== 'string' || body.reference.length > 255)) throw new EntryInputError(`${row}Referensi bukti maksimal 255 karakter.`);
  if (body.attachment != null && body.attachment !== '' && !ATTACHMENT_PATH.test(String(body.attachment))) throw new EntryInputError(`${row}Lampiran tidak valid; unggah ulang.`);
  return {
    date: body.date, unit: unit.type === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: unit.outletId },
    accountCode: body.accountCode, amount: String(body.amount), notes: body.notes, reference: body.reference ?? '', attachment: body.attachment || null,
  };
}

function failure(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof EntryInputError || error instanceof TransactionRuleError) {
    res.status(error instanceof TransactionRuleError ? error.status : 400).json({ error: error.message }); return;
  }
  res.status(400).json({ error: fallback });
}

const ATTACHMENT_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: 'pdf', magic: b => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  'image/png': { ext: 'png', magic: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/jpeg': { ext: 'jpg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
};
const CONTENT_TYPE: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

// Mounted at /api/finance/v2/transactions (mount.ts) with the SQL repository.
export function createTransactionRouter(repository: TransactionRepository, authenticate: (req: Request) => Promise<Actor | null>, trustedOrigins: string[] = [], attachmentDir?: string) {
  const router = Router();
  router.use(financeWriteGuard(authenticate, trustedOrigins));
  const actorOf = (res: express.Response) => res.locals.actor as Actor;

  router.get('/', async (req, res) => {
    try { const filter = parseFilter(req.query); res.json({ transactions: await repository.list(filter) }); }
    catch { res.status(400).json({ error: 'Invalid filters or transaction source unavailable' }); }
  });

  // Several rows typed at once ("tambah baris"), saved together and counted at once.
  router.post('/batch', async (req, res) => {
    try {
      const rows = req.body?.rows, key = req.body?.batchKey;
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,90}$/.test(key)) throw new EntryInputError('Kunci penyimpanan tidak valid; muat ulang halaman.');
      if (!Array.isArray(rows) || !rows.length) throw new EntryInputError('Tambahkan minimal satu baris entri.');
      if (rows.length > 50) throw new EntryInputError('Maksimal 50 baris per penyimpanan.');
      const inputs = rows.map((row: unknown, index: number) => entryInput(row, rows.length > 1 ? `Baris ${index + 1}: ` : ''));
      const actor = actorOf(res);
      const changes = inputs.map((input, index) => {
        const id = randomUUID();
        return { id, expectedVersion: null, plan: (before: TransactionRecord | null) => {
          if (before) throw new TransactionRuleError('Entri sudah ada.');
          return planTransactionChange(actor, null, { ...input, id, status: 'posted', nature: 'EXTERNAL', counterparty: null, idempotencyKey: `${key}-${index}`, legacyEntryId: null, version: 1, source: 'manual', sourceRef: null }, 'Input biaya manual');
        } };
      });
      res.status(201).json({ transactions: await repository.changeMany(changes, actor) });
    } catch (error) { failure(res, error, 'Entri gagal disimpan. Periksa isian.'); }
  });

  // Single draft or posted entry (kept for the earlier draft → post flow).
  router.post('/', async (req, res) => {
    try {
      if (!req.body || !['draft', 'posted'].includes(req.body.status) || req.body.nature !== 'EXTERNAL') throw new EntryInputError('Status atau sifat transaksi tidak valid.');
      const key = req.body.idempotencyKey;
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new EntryInputError('Kunci penyimpanan tidak valid.');
      const input = entryInput(req.body), id = randomUUID(), actor = actorOf(res);
      const record = await repository.change(id, null, before => {
        if (before) throw new TransactionRuleError('Entri sudah ada.');
        return planTransactionChange(actor, null, { ...input, id, status: req.body.status, nature: 'EXTERNAL', counterparty: null, idempotencyKey: key, legacyEntryId: null, version: 1, source: 'manual', sourceRef: null }, req.body.status === 'posted' ? 'Input biaya manual' : 'Create expense draft');
      }, actor);
      res.status(201).json({ transaction: record });
    } catch (error) { failure(res, error, 'Draft rejected; verify account, unit, date, decimal amount and idempotency key'); }
  });

  // Edit a manual entry. Every change is versioned, audited and logged.
  router.put('/:id', async (req, res) => {
    try {
      if (!Number.isSafeInteger(req.body?.version)) throw new EntryInputError('Versi entri tidak valid; muat ulang.');
      const input = entryInput(req.body), actor = actorOf(res);
      const record = await repository.change(req.params.id, req.body.version, before => {
        if (!before) throw new TransactionRuleError('Entri tidak ditemukan.');
        return planTransactionChange(actor, before, { ...before, ...input, version: before.version + 1 }, typeof req.body.reason === 'string' && req.body.reason.trim() ? req.body.reason : 'Edit entri biaya');
      }, actor);
      res.json({ transaction: record });
    } catch (error) { failure(res, error, 'Perubahan ditolak.'); }
  });

  // Delete = void (soft delete) with a reason; the row and its audit remain.
  router.delete('/:id', async (req, res) => {
    try {
      if (!Number.isSafeInteger(req.body?.version)) throw new EntryInputError('Versi entri tidak valid; muat ulang.');
      const actor = actorOf(res);
      await repository.change(req.params.id, req.body.version, before => {
        if (!before) throw new TransactionRuleError('Entri tidak ditemukan.');
        return planTransactionChange(actor, before, { ...before, status: 'void', version: before.version + 1 }, req.body.reason);
      }, actor);
      res.json({ success: true });
    } catch (error) { failure(res, error, 'Entri gagal dihapus.'); }
  });

  router.post('/:id/:action', async (req, res) => {
    try {
      if (!['post', 'void'].includes(req.params.action) || !Number.isSafeInteger(req.body?.version)) throw new EntryInputError('Aksi tidak valid.');
      const actor = actorOf(res);
      const record = await repository.change(req.params.id, req.body.version, before => {
        if (!before || (req.params.action === 'post' && before.status !== 'draft') || (req.params.action === 'void' && before.status !== 'posted')) throw new TransactionRuleError('Status entri tidak sesuai.');
        return planTransactionChange(actor, before, { ...before, status: req.params.action === 'post' ? 'posted' : 'void', version: before.version + 1 }, req.body.reason);
      }, actor);
      res.json({ transaction: record });
    } catch (error) { res.status(409).json({ error: error instanceof TransactionRuleError ? error.message : 'Status/version conflict or audit reason missing' }); }
  });

  // Proof attachments (PDF or image, ≤ 5 MB). Stored outside the public static
  // folders and served only to Finance through this router.
  if (attachmentDir) {
    router.post('/attachments', express.raw({ type: Object.keys(ATTACHMENT_TYPES), limit: '5mb' }), (req, res) => {
      const type = ATTACHMENT_TYPES[String(req.header('Content-Type') || '').split(';')[0].toLowerCase()];
      const body = req.body as Buffer;
      if (!type || !Buffer.isBuffer(body) || !body.length || !type.magic(body)) { res.status(400).json({ error: 'Lampiran harus PDF, PNG, JPG, atau WEBP (maksimal 5 MB).' }); return; }
      fs.mkdirSync(attachmentDir, { recursive: true });
      const name = `${randomUUID()}.${type.ext}`;
      fs.writeFileSync(path.join(attachmentDir, name), body, { flag: 'wx' });
      res.status(201).json({ attachment: name });
    });
    router.get('/attachments/:name', (req, res) => {
      const name = req.params.name;
      if (!ATTACHMENT_PATH.test(name)) { res.status(404).json({ error: 'Lampiran tidak ditemukan' }); return; }
      const file = path.join(attachmentDir, name);
      if (!fs.existsSync(file)) { res.status(404).json({ error: 'Lampiran tidak ditemukan' }); return; }
      res.setHeader('Content-Type', CONTENT_TYPE[name.split('.').pop()!]);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${name}"`);
      res.sendFile(file);
    });
  }
  return router;
}
