import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTransactionRouter, type TransactionRepository } from '../src/finance/transactionApi.ts';
import type { TransactionRecord } from '../src/finance/transactionPlan.ts';
import { FinanceAggregationService } from '../src/finance/FinanceAggregationService.ts';
const input = { date: '2026-10-24', unit: { type: 'WAREHOUSE' }, accountCode: 'LC01', amount: '123.456789', notes: 'isolated test', reference: 'mock evidence', status: 'draft', nature: 'EXTERNAL', idempotencyKey: 'isolated-test-key-0001' };
test('mock API lifecycle, refresh, permissions, decimal, version and posted-only facts', async t => {
  const rows = new Map<string, TransactionRecord>(), audit: unknown[] = [];
  const repo: TransactionRepository = {
    list: async f => [...rows.values()].filter(r => r.date >= f.startDate && r.date <= f.endDate),
    change: async (id, version, plan) => {
      const before = rows.get(id) ?? null;
      if (version !== null && before?.version !== version) throw new Error();
      const result = plan(before);
      if (result.record.unit.type === 'OUTLET' && result.record.unit.outletId !== 7) throw new Error('Unknown outlet');
      if (version === null && [...rows.values()].some(r => r.idempotencyKey === result.record.idempotencyKey)) throw new Error();
      rows.set(id, result.record); audit.push(result.audit); return result.record;
    },
  };
  let role = 'FINANCE';
  const app = express(); app.use(express.json()); app.use('/transactions', createTransactionRouter(repo, async () => role === 'NONE' ? null : { id: 7, role }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (path: string, body: unknown, origin = base) => fetch(`${base}/transactions${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  assert.equal((await post('', input, 'http://wrong.invalid')).status, 403);
  for (role of ['WAREHOUSE','ADMIN','OUTLET']) assert.equal((await post('', input)).status, 403);
  role = 'NONE'; assert.equal((await post('', input)).status, 401); role = 'FINANCE';
  for (const change of [{ amount: 10 }, { amount: '0' }, { amount: '1e3' }, { accountCode: 'OI' }, { nature: 'INTERNAL' }, { status: 'posted' }]) assert.equal((await post('', { ...input, ...change })).status, 400);
  assert.equal((await post('', { ...input, unit: { type: 'OUTLET', outletId: 999 } })).status, 400);
  const da = await post('', { ...input, accountCode: 'DA02', unit: { type: 'OUTLET', outletId: 7 }, idempotencyKey: 'isolated-da-test-0001' });
  assert.equal(da.status, 201); const daRow = (await da.json()).transaction; assert.equal(daRow.accountCode, 'DA02');
  const response = await post('', input); assert.equal(response.status, 201);
  const row = (await response.json()).transaction; assert.equal(row.amount, '123.456789');
  assert.equal((await post('', input)).status, 400); assert.equal(rows.size, 2);
  const filter = { mode: 'WAREHOUSE' as const, startDate: '2026-10-01', endDate: '2026-10-24', outletIds: null, timezone: 'Asia/Jakarta' as const };
  const known = () => new FinanceAggregationService().aggregate(filter, [{ source: 'WAREHOUSE', units: [{ type: 'WAREHOUSE' }], facts: [...rows.values()].filter(r => r.status === 'posted').map(r => ({ source: 'WAREHOUSE' as const, id: r.id, metric: 'LC' as const, amount: r.amount, date: r.date, nature: 'EXTERNAL' as const, unit: r.unit, reference: r.reference })), coverage: [], distributions: [], issues: [], fetchedAt: '' }]).byUnit[0].knownAmounts.LC;
  assert.equal(known(), '0.000000');
  assert.equal((await post(`/${row.id}/post`, { version: 1, reason: 'test approval' })).status, 200);
  assert.equal(known(), '123.456789');
  assert.equal((await post(`/${row.id}/post`, { version: 1, reason: 'stale' })).status, 409);
  const list = await fetch(`${base}/transactions?mode=WAREHOUSE&startDate=2026-10-01&endDate=2026-10-24`);
  assert.equal((await list.json()).transactions.find((r: any) => r.id === row.id).status, 'posted'); // new GET, not browser state
  assert.equal((await post(`/${row.id}/void`, { version: 2, reason: '' })).status, 409);
  assert.equal((await post(`/${row.id}/void`, { version: 2, reason: 'test reversal' })).status, 200);
  assert.equal(known(), '0.000000'); assert.equal(audit.length, 4);
});
