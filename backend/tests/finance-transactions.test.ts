import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTransactionRouter, type TransactionChange, type TransactionRepository } from '../src/finance/transactionApi.ts';
import type { TransactionRecord } from '../src/finance/transactionPlan.ts';

// The Finance entry API over real HTTP with an in-memory repository: several
// rows saved at once, edit and delete (void) of manual rows, HD Outlet rows
// read-only, Finance role and same-origin writes only.
function memoryRepository() {
  const rows = new Map<string, TransactionRecord>(), audits: { action: string; reason: string }[] = [];
  const repo: TransactionRepository = {
    list: async f => [...rows.values()].filter(r => r.date >= f.startDate && r.date <= f.endDate),
    change: async (id, version, plan, actor) => (await repo.changeMany([{ id, expectedVersion: version, plan }], actor))[0],
    changeMany: async (changes: TransactionChange[]) => {
      const staged = new Map(rows), out: TransactionRecord[] = [], log: typeof audits = [];
      for (const change of changes) {
        const before = staged.get(change.id) ?? null;
        if (change.expectedVersion === null ? before !== null : before?.version !== change.expectedVersion) throw new Error('version');
        const { record, audit } = change.plan(before);
        staged.set(record.id, record); out.push(record); log.push({ action: audit.action, reason: audit.reason });
      }
      for (const [k, v] of staged) rows.set(k, v);
      audits.push(...log); return out;
    },
  };
  return { repo, rows, audits };
}

async function api(t: any, role = 'FINANCE') {
  const memory = memoryRepository();
  const app = express(); app.use(express.json());
  const who = { role };
  app.use('/tx', createTransactionRouter(memory.repo, async () => who.role === 'NONE' ? null : { id: 7, role: who.role, name: 'Finance' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, path: string, body?: unknown, origin = base) => {
    const r = await fetch(`${base}/tx${path}`, { method, headers: { 'content-type': 'application/json', origin }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { ...memory, call, who };
}
const row = (extra: Record<string, unknown> = {}) => ({ date: '2026-11-17', unit: { type: 'OUTLET', outletId: 3 }, accountCode: 'UC01', amount: '300000', notes: 'Listrik', ...extra });
const KEY = 'batch-key-0000000000001';

test('several rows are saved together and counted at once (posted)', async t => {
  const { call, rows, audits } = await api(t);
  const saved = await call('POST', '/batch', { batchKey: KEY, rows: [row(), row({ accountCode: 'LC01', amount: '3500000', notes: 'Gaji', unit: { type: 'WAREHOUSE' } })] });
  assert.equal(saved.status, 201);
  assert.deepEqual(saved.body.transactions.map((r: any) => [r.accountCode, r.amount, r.status, r.source]), [['UC01', '300000.000000', 'posted', 'manual'], ['LC01', '3500000.000000', 'posted', 'manual']]);
  assert.equal(rows.size, 2); assert.deepEqual(audits.map(a => a.action), ['CREATE', 'CREATE']);
  const listed = await call('GET', '/?mode=ALL&startDate=2026-11-01&endDate=2026-11-30');
  assert.equal(listed.body.transactions.length, 2);
});

test('a bad row rejects the whole batch with the row number; negative/empty amounts refused', async t => {
  const { call, rows } = await api(t);
  for (const [bad, message] of [[{ amount: '-5' }, /Baris 2: Nominal harus lebih dari Rp0/], [{ amount: '' }, /Baris 2: Nominal wajib diisi/], [{ notes: ' ' }, /Baris 2: Keterangan wajib/], [{ accountCode: '' }, /Baris 2: Pilih kode biaya/], [{ unit: null }, /Baris 2: Pilih unit/]] as const) {
    const r = await call('POST', '/batch', { batchKey: KEY, rows: [row(), row(bad)] });
    assert.equal(r.status, 400); assert.match(r.body.error, message);
  }
  assert.equal(rows.size, 0, 'nothing of a refused batch is saved');
  assert.equal((await call('POST', '/batch', { batchKey: KEY, rows: [] })).status, 400);
});

test('a manual entry can be edited (versioned) and deleted as a void with a reason', async t => {
  const { call, rows, audits } = await api(t);
  const [entry] = (await call('POST', '/batch', { batchKey: KEY, rows: [row()] })).body.transactions;
  const edited = await call('PUT', `/${entry.id}`, { ...row({ amount: '350000', notes: 'Listrik November' }), version: 1, reason: 'Salah nominal' });
  assert.equal(edited.status, 200); assert.deepEqual([edited.body.transaction.amount, edited.body.transaction.version], ['350000.000000', 2]);
  assert.equal((await call('PUT', `/${entry.id}`, { ...row(), version: 1 })).status, 400, 'stale version is refused');
  assert.equal((await call('DELETE', `/${entry.id}`, { version: 2, reason: '' })).status, 400, 'delete needs a reason');
  assert.equal((await call('DELETE', `/${entry.id}`, { version: 2, reason: 'Dobel input' })).status, 200);
  assert.equal(rows.get(entry.id)!.status, 'void', 'soft delete: the row stays');
  assert.equal((await call('PUT', `/${entry.id}`, { ...row(), version: 3 })).status, 400, 'a deleted entry cannot be edited');
  assert.deepEqual(audits.map(a => a.action), ['CREATE', 'UPDATE', 'VOID']);
});

test('entries synced from HD Outlet cannot be edited or deleted by hand', async t => {
  const { call, rows } = await api(t);
  rows.set('hdo', { id: 'hdo', date: '2026-11-17', unit: { type: 'OUTLET', outletId: 3 }, accountCode: 'SI', amount: '891500.000000', notes: 'HD Outlet', reference: 'HDO-5',
    status: 'posted', nature: 'EXTERNAL', counterparty: null, idempotencyKey: 'hdo:5:SI', legacyEntryId: null, version: 1, source: 'hdoutlet', sourceRef: 'hdo:5:SI', attachment: null });
  for (const [method, body] of [['PUT', { ...row(), version: 1 }], ['DELETE', { version: 1, reason: 'x' }]] as const) {
    const r = await call(method, '/hdo', body);
    assert.equal(r.status, 400); assert.match(r.body.error, /HD Outlet/);
  }
  assert.equal(rows.get('hdo')!.amount, '891500.000000');
});

test('only Finance writes, and only from the same origin', async t => {
  const ctx = await api(t);
  assert.equal((await ctx.call('POST', '/batch', { batchKey: KEY, rows: [row()] }, 'https://evil.example')).status, 403);
  for (const role of ['WAREHOUSE', 'ADMIN', 'OUTLET']) { ctx.who.role = role; assert.equal((await ctx.call('POST', '/batch', { batchKey: KEY, rows: [row()] })).status, 403, role); }
  ctx.who.role = 'NONE'; assert.equal((await ctx.call('POST', '/batch', { batchKey: KEY, rows: [row()] })).status, 401);
  assert.equal(ctx.rows.size, 0);
});

test('behind a proxy that rewrites Host (Vite dev, hosting gateway) the browser\'s Sec-Fetch-Site decides; cross-site is refused', async t => {
  const { rows } = await api(t);
  // Origin of the page (localhost:3000) differs from the Host the backend sees.
  const { sameOrigin } = await import('../src/finance/transactionApi.ts');
  const req = (headers: Record<string, string>) => ({ protocol: 'http', get: () => '127.0.0.1:5001', header: (n: string) => headers[n.toLowerCase()] }) as any;
  assert.equal(sameOrigin(req({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' })), true, 'Vite dev proxy');
  assert.equal(sameOrigin(req({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(sameOrigin(req({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site' })), false);
  assert.equal(sameOrigin(req({ origin: 'http://localhost:3000' })), false, 'without the browser header the origin must match');
  assert.equal(sameOrigin(req({ origin: 'https://hdhub.kii.lat' }), ['https://hdhub.kii.lat']), true, 'public URL from .env');
  assert.equal(sameOrigin(req({})), false);
  assert.equal(rows.size, 0);
});
