import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { ACCOUNTS, parseFilter } from './validation.ts';
import { planTransactionChange, type TransactionRecord, type AuditPlan } from './transactionPlan.ts';
import { canManageFinance } from './access.ts';
import type { Filter } from './domain.ts';
export interface TransactionRepository {
  list(filter: Filter): Promise<TransactionRecord[]>;
  // Must atomically lock/read, compare expected version/idempotency key,
  // validate outlet/account existence and commit record + append-only audit.
  change(id: string, expectedVersion: number | null, plan: (before: TransactionRecord | null) => { record: TransactionRecord; audit: AuditPlan }): Promise<TransactionRecord>;
}
// NOT mounted in production. No SQL writer or runtime mock fallback exists.
export function createTransactionRouter(repository: TransactionRepository, authenticate: (req: Request) => Promise<{ id: number; role: string } | null>) {
  const router = Router(); router.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const actor = await authenticate(req);
      if (!actor) { res.status(401).json({ error: 'Login required' }); return; }
      if (!canManageFinance(actor.role)) { res.status(403).json({ error: 'Finance role required' }); return; }
      if (req.method !== 'GET' && req.header('Origin') !== `${req.protocol}://${req.get('host')}`) { res.status(403).json({ error: 'Same-origin request required' }); return; }
      res.locals.actor = actor; next();
    } catch { res.status(503).json({ error: 'Transaction authentication unavailable' }); }
  });
  router.get('/', async (req, res) => {
    try { const filter = parseFilter(req.query); res.json({ transactions: await repository.list(filter) }); }
    catch { res.status(400).json({ error: 'Invalid filters or transaction source unavailable' }); }
  });
  router.post('/', async (req, res) => {
    try {
      if (!req.body || req.body.status !== 'draft' || req.body.nature !== 'EXTERNAL') throw new Error();
      const code = req.body.accountCode;
      if (!Object.hasOwn(ACCOUNTS, code) || ['OI','SH'].includes(code)) throw new Error();
      const key = req.body.idempotencyKey;
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new Error();
      const id = randomUUID();
      const record = await repository.change(id, null, before => {
        if (before) throw new Error();
        return planTransactionChange(res.locals.actor, null, { ...req.body, id, version: 1, legacyEntryId: null, counterparty: null }, 'Create expense draft');
      });
      res.status(201).json({ transaction: record });
    } catch { res.status(400).json({ error: 'Draft rejected; verify account, unit, date, decimal amount, reference and idempotency key' }); }
  });
  router.post('/:id/:action', async (req, res) => {
    try {
      if (!['post','void'].includes(req.params.action) || !Number.isSafeInteger(req.body.version)) throw new Error();
      const record = await repository.change(req.params.id, req.body.version, before => {
        if (!before || (req.params.action === 'post' && before.status !== 'draft') || (req.params.action === 'void' && before.status !== 'posted')) throw new Error();
        return planTransactionChange(res.locals.actor, before, { ...before, status: req.params.action === 'post' ? 'posted' : 'void', version: before.version + 1 }, req.body.reason);
      });
      res.json({ transaction: record });
    } catch { res.status(409).json({ error: 'Status/version conflict or audit reason missing' }); }
  });
  return router;
}
