import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_METRICS, type Filter, type SourceResult, type Unit, type Fact } from '../src/finance/domain.ts';
import { FinanceCalculationService } from '../src/finance/FinanceCalculationService.ts';
import { FinanceAggregationService } from '../src/finance/FinanceAggregationService.ts';
import { decimal, money, quantityCost } from '../src/finance/decimal.ts';
import { parseFilter, validateTransaction, ACCOUNTS } from '../src/finance/validation.ts';
import { WarehouseFinanceDataSource, mysqlSelectExecutor } from '../src/finance/WarehouseFinanceDataSource.ts';
import { OutletFinanceDataSource, resolveOutletMapping, type OutletPage, type VerifiedOutletTransport } from '../src/finance/OutletFinanceDataSource.ts';
import { transitionLegacy } from '../src/finance/transition.ts';
import { canManageFinance, canReadMultiSourceFinance } from '../src/finance/access.ts';
import { createFinanceRouter } from '../src/finance/router.ts';
import { planTransactionChange } from '../src/finance/transactionPlan.ts';

const filter: Filter = { mode: 'ALL', startDate: '2026-10-01', endDate: '2026-10-23', outletIds: null, timezone: 'Asia/Jakarta' };
const warehouse: Unit = { type: 'WAREHOUSE' }, outlet: Unit = { type: 'OUTLET', outletId: 1 };
const calculator = new FinanceCalculationService(), aggregator = new FinanceAggregationService();
function source(kind: 'WAREHOUSE' | 'OUTLET', units: Unit[], facts: Fact[] = []): SourceResult {
  return { source: kind, units, facts, coverage: units.flatMap(unit => BASE_METRICS.filter(metric => (unit.type === 'OUTLET' && ['SI', 'CRW', 'CSM', 'CPM'].includes(metric) ? 'OUTLET' : 'WAREHOUSE') === kind).map(metric => ({ unit, metric, status: 'Available' as const, reason: 'Certified fixture only' }))), issues: [], distributions: [], fetchedAt: '2026-10-23T00:00:00Z' };
}
function fact(metric: Fact['metric'], amount: string, unit = warehouse, nature: Fact['nature'] = 'EXTERNAL', id = metric): Fact {
  return { source: unit.type === 'OUTLET' && ['SI', 'CRW', 'CSM', 'CPM'].includes(metric) ? 'OUTLET' : 'WAREHOUSE', id, metric, amount, unit, nature, date: '2026-10-10', reference: 'fixture' };
}
const available = (amount: string) => ({ amount, status: 'Available' as const, reasons: [] });
test('every Finance formula including DA exclusion from DC', () => {
  const input = Object.fromEntries(BASE_METRICS.map(k => [k, available('1')]));
  Object.assign(input, { SI: available('1000'), OI: available('50'), SH: available('10'), CRW: available('100'), CSM: available('20'), CPM: available('30'), DA01: available('5'), DA02: available('2') });
  const result = calculator.calculate(input);
  for (const [key, expected] of Object.entries({ CM: '1040.000000', COGS: '150.000000', CI: '890.000000', DC: '7.000000', DA: '7.000000', EBITDA: '883.000000', EBIT: '876.000000' })) assert.equal(result[key].amount, expected, key);
});
test('exact arithmetic above JS safe integer and fractional costs', () => {
  assert.equal(money(decimal('9007199254740993.000001') + decimal('0.000009')), '9007199254740993.000010');
  assert.equal(quantityCost('3', '0.100001'), '0.300003');
  assert.equal(money(decimal('-0.000001')), '-0.000001');
  assert.throws(() => decimal('0.0000001'));
  assert.throws(() => decimal(0.1 as any));
  assert.throws(() => quantityCost('1', '-1'));
  assert.throws(() => money(decimal('999999999999999999.999999') + 1n));
});
test('null propagation preserves independent metrics and Error/Unmapped', () => {
  const input = Object.fromEntries(BASE_METRICS.map(k => [k, available('0')]));
  input.SH = { amount: null, status: 'Missing', reasons: ['unverified shrinkage'] } as any;
  let result = calculator.calculate(input);
  for (const key of ['CM', 'CI', 'EBITDA', 'EBIT']) assert.equal(result[key].amount, null);
  assert.equal(result.COGS.amount, '0.000000');
  input.CRW = { amount: null, status: 'Unmapped', reasons: ['mapping'] } as any;
  result = calculator.calculate(input); assert.equal(result.COGS.status, 'Unmapped');
  input.CSM = { amount: null, status: 'Error', reasons: ['upstream'] } as any;
  assert.equal(calculator.calculate(input).CI.status, 'Error');
  assert.equal(calculator.calculate({}).SI.amount, null);
});
test('strict date, mode, outlet and timezone validation', () => {
  assert.deepEqual(parseFilter({ mode: 'OUTLET', startDate: '2026-10-01', endDate: '2026-10-23', outletIds: '2,1,2' }).outletIds, [2, 1]);
  for (const override of [{ startDate: '2026-02-30' }, { endDate: '2026-09-01' }, { mode: 'OTHER' }, { mode: ['WAREHOUSE'] }, { outletIds: '' }, { outletIds: '0' }, { outletIds: '1 OR 1=1' }, { timezone: 'UTC' }]) assert.throws(() => parseFilter({ ...filter, outletIds: undefined, ...override }));
});
test('transaction account manifest and draft validation', () => {
  assert.equal(Object.keys(ACCOUNTS).length, 27);
  const draft = { date: '2026-10-23', accountCode: 'SH', unit: outlet, amount: '1.123456', notes: 'loss', reference: 'opname-1', status: 'draft', nature: 'EXTERNAL', idempotencyKey: 'request-1', version: 1 };
  assert.equal(validateTransaction(draft).amount, '1.123456');
  for (const override of [{ accountCode: 'LC' }, { accountCode: '__proto__' }, { amount: 1 }, { amount: '0' }, { amount: '-1' }, { unit: { type: 'WAREHOUSE', outletId: 1 } }, { reference: '' }, { status: 'approved' }, { nature: 'UNKNOWN' }, { nature: 'INTERNAL' }, { version: 0 }]) assert.throws(() => validateTransaction({ ...draft, ...override }));
});
test('internal income/cost never added to external totals; duplicate facts counted once', () => {
  const sale = fact('SI', '200', outlet);
  const w = source('WAREHOUSE', [warehouse, outlet], [fact('SI', '130', warehouse, 'INTERNAL'), fact('CRW', '100', warehouse, 'INTERNAL')]);
  const o = source('OUTLET', [outlet], [sale, { ...sale }, fact('CRW', '60', outlet)]);
  const result = aggregator.aggregate(filter, [w, o], true);
  assert.equal(result.metrics.SI.amount, '200.000000');
  assert.equal(result.metrics.COGS.amount, '60.000000');
  assert.equal(result.metrics.CI.amount, '140.000000');
  assert.equal(result.reconciliation.internalFacts.length, 2);
});
test('unverified elimination blocks consolidated totals', () => {
  const result = aggregator.aggregate(filter, [source('WAREHOUSE', [warehouse, outlet]), source('OUTLET', [outlet])]);
  assert.equal(result.metrics.SI.amount, null); assert.equal(result.complete, false);
  assert.equal(result.byUnit[0].metrics.SI.amount, '0.000000');
});
test('conflicting duplicate and missing source/coverage cannot produce final values', () => {
  const sale = fact('SI', '200', outlet);
  const o = source('OUTLET', [outlet], [sale, { ...sale, amount: '201' }]);
  assert.equal(aggregator.aggregate(filter, [source('WAREHOUSE', [warehouse, outlet]), o], true).metrics.SI.status, 'Error');
  assert.equal(aggregator.aggregate(filter, [o], true).complete, false);
  const w = source('WAREHOUSE', [warehouse]); w.coverage = [];
  assert.equal(aggregator.aggregate({ ...filter, mode: 'WAREHOUSE' }, [w]).metrics.SI.amount, null);
});
test('canonical unit/date filter restricts known amounts and breakdown', () => {
  const second: Unit = { type: 'OUTLET', outletId: 2 };
  const o = source('OUTLET', [outlet, second], [fact('SI', '10', outlet), fact('SI', '20', second), { ...fact('SI', '50', outlet, 'EXTERNAL', 'old'), date: '2026-09-30' }]);
  const result = aggregator.aggregate({ ...filter, mode: 'OUTLET', outletIds: [1] }, [source('WAREHOUSE', [warehouse, outlet, second]), o]);
  assert.equal(result.byUnit.length, 1); assert.equal(result.metrics.SI.amount, '10.000000');
});
test('unknown Outlet population and source issues preserve null', () => {
  const o = source('OUTLET', []); o.issues.push({ status: 'Unmapped', reason: 'X' });
  const result = aggregator.aggregate(filter, [source('WAREHOUSE', [warehouse]), o], true);
  assert.equal(result.metrics.SI.status, 'Unmapped');
  assert.equal(result.complete, false);
});
const mapping = { externalOutletId: 'EXT-1', outletId: 1, status: 'validated' as const, validFrom: '2026-01-01', validTo: null };
const row = { id: 'sale-1', externalOutletId: 'EXT-1', date: '2026-10-10', metric: 'SI' as const, amount: '200', nature: 'EXTERNAL' as const, reference: 'receipt-1' };
const page: OutletPage = { rows: [row], outletIds: ['EXT-1'], complete: true, nextCursor: null };
function transport(read: VerifiedOutletTransport['page']): VerifiedOutletTransport { return { contractId: 'FIXTURE-NOT-LIVE', page: read }; }
test('Outlet disabled by default without making network calls', async () => {
  const result = await new OutletFinanceDataSource().read(filter);
  assert.equal(result.issues[0].status, 'Missing'); assert.deepEqual(result.facts, []);
});
test('mapping rejects overlap, unvalidated, expired and absent IDs', () => {
  assert.equal(resolveOutletMapping([mapping], 'EXT-1', '2026-10-10'), 1);
  assert.equal(resolveOutletMapping([mapping, mapping], 'EXT-1', '2026-10-10'), null);
  assert.equal(resolveOutletMapping([{ ...mapping, status: 'pending' }], 'EXT-1', '2026-10-10'), null);
  assert.equal(resolveOutletMapping([{ ...mapping, validTo: '2026-09-01' }], 'EXT-1', '2026-10-10'), null);
  assert.equal(resolveOutletMapping([mapping], 'OTHER', '2026-10-10'), null);
});
test('pagination forwards identical filters, deduplicates rows and retains Missing accounting coverage', async () => {
  const seen: (string | null)[] = [];
  const adapter = new OutletFinanceDataSource([mapping], transport(async (received, cursor) => {
    assert.deepEqual(received, filter); seen.push(cursor);
    return { ...page, nextCursor: cursor === null ? 'p2' : null };
  }));
  const result = await adapter.read(filter);
  assert.deepEqual(seen, [null, 'p2']); assert.equal(result.facts.length, 1);
  assert.equal(result.coverage.find(c => c.metric === 'SI')?.status, 'Missing');
});
test('pagination loop, conflicting duplicate and page limit return Error without partial data', async () => {
  for (const adapter of [
    new OutletFinanceDataSource([mapping], transport(async () => ({ ...page, nextCursor: 'same' }))),
    new OutletFinanceDataSource([mapping], transport(async (_, cursor) => cursor === null ? { ...page, nextCursor: 'p2' } : { ...page, rows: [{ ...row, amount: '201' }] })),
    new OutletFinanceDataSource([mapping], transport(async () => ({ ...page, nextCursor: 'p2' })), 100, 1),
  ]) { const result = await adapter.read(filter); assert.equal(result.issues[0].status, 'Error'); assert.equal(result.facts.length, 0); }
});
test('API rejection, timeout and malformed/unverified amounts become Error', async () => {
  for (const read of [async () => { throw new Error('token secret must not leak'); }, async () => new Promise<OutletPage>(() => {}), async () => ({ ...page, rows: [{ ...row, amount: 200 as any }] }), async () => ({ ...page, rows: [{ ...row, total_income: '200', amount: undefined as any }] })]) {
    const result = await new OutletFinanceDataSource([mapping], transport(read), 5).read(filter);
    assert.equal(result.issues[0].status, 'Error'); assert.ok(!JSON.stringify(result).includes('token secret'));
  }
});
test('unmapped outlet not silently excluded; incomplete and missing selected outlet detected', async () => {
  const result = await new OutletFinanceDataSource([], transport(async () => page)).read(filter);
  assert.equal(result.issues[0].status, 'Unmapped'); assert.equal(result.facts.length, 0);
  const incomplete = await new OutletFinanceDataSource([mapping], transport(async () => ({ ...page, complete: false }))).read({ ...filter, outletIds: [1, 2] });
  assert.ok(incomplete.issues.some(i => i.reason.includes('coverage incomplete')));
  assert.ok(incomplete.issues.some(i => i.reason.includes('Selected outlet')));
});
test('SELECT-only guard rejects mutation, multi statement and locking reads', async () => {
  const calls: string[] = [];
  const db = mysqlSelectExecutor({ execute: async sql => { calls.push(sql); return [[], []]; } });
  for (const sql of ['ALTER TABLE items ADD x INT', 'SELECT * FROM items; DROP TABLE items', 'SELECT * FROM items FOR UPDATE', "SELECT * INTO OUTFILE 'x' FROM items"]) await assert.rejects(() => db.select(sql, []));
  await db.select('SELECT id FROM items WHERE id = ?', [1]); assert.equal(calls.length, 1);
});
test('Warehouse adapter reads distribution exactly without treating it as SI', async () => {
  const queries: string[] = [];
  const result = await new WarehouseFinanceDataSource({ select: async (sql, parameters) => {
    queries.push(sql); assert.ok(sql.startsWith('SELECT'));
    if (sql.includes('FROM outlets')) return [{ id: 1, code: 'HD-1', name: 'Fixture Outlet', isActive: 1 }];
    if (sql.includes('information_schema.COLUMNS')) return [{ tableName: 'request_items', columnName: 'unit_cost_snapshot' }];
    if (sql.includes('request_items ri')) { assert.deepEqual(parameters, [filter.startDate, filter.endDate, 1]); return [{ id: '9', outletId: 1, reference: 'REQ-9', quantity: '3', price: '100', unitCost: '1.123456' }]; }
    return [];
  } }).read({ ...filter, outletIds: [1] });
  assert.ok(queries.every(query => /^SELECT\s/.test(query))); assert.equal(result.distributions[0].cost, '3.370368');
  assert.equal(result.distributions[0].amount, '300.000000'); assert.equal(result.facts.length, 0);
  assert.equal(result.coverage.find(c => c.metric === 'SI')?.status, 'Missing');
});
test('Warehouse new ledger reads only posted entries and costs stay unit-owned', async () => {
  const result = await new WarehouseFinanceDataSource({ select: async sql => {
    if (sql.includes('information_schema')) return [{ name: 'finance_accounts' }, { name: 'finance_transactions' }];
    if (sql.includes('FROM finance_transactions')) { assert.ok(sql.includes("t.status = 'posted'")); return [{ id: '1', accountCode: 'DA01', unitType: 'OUTLET', outletId: 1, amount: '0.123456', date: '2026-10-10', nature: 'EXTERNAL', reference: 'asset-1' }]; }
    return [];
  } }).read(filter);
  assert.equal(result.facts[0].metric, 'DA01'); assert.deepEqual(result.facts[0].unit, outlet);
  assert.equal(result.coverage.find(c => c.unit.type === 'OUTLET' && c.metric === 'DA01')?.status, 'Missing');
});
test('Warehouse schema/DB failure produces Error, never zero', async () => {
  const result = await new WarehouseFinanceDataSource({ select: async () => { throw new Error('DB unavailable'); } }).read(filter);
  assert.equal(result.issues[0].status, 'Error'); assert.equal(result.facts.length, 0);
});
test('legacy transition never doubles or resurrects a void replacement', () => {
  const legacy = [{ id: '1', accountCode: 'LC', amount: '100', isVoided: false }];
  assert.equal(transitionLegacy(legacy, [{ id: 'N1', legacyEntryId: '1', status: 'draft' }]).length, 1);
  for (const status of ['posted', 'void'] as const) assert.equal(transitionLegacy(legacy, [{ id: 'N1', legacyEntryId: '1', status }]).length, 0);
  assert.throws(() => transitionLegacy(legacy, [{ id: 'N1', legacyEntryId: '1', status: 'posted' }, { id: 'N2', legacyEntryId: '1', status: 'posted' }]));
});
test('transaction lifecycle requires audit, versions and Finance role; posted/void immutable', () => {
  const actor = { id: 1, role: 'FINANCE' };
  const draft = { id: 'T1', date: '2026-10-23', accountCode: 'OI', unit: warehouse, amount: '10', notes: 'other', reference: 'receipt-1', status: 'draft', nature: 'EXTERNAL', idempotencyKey: 'key-1', version: 1 };
  const created = planTransactionChange(actor, null, draft, 'create');
  assert.equal(created.audit.action, 'CREATE'); assert.equal(created.audit.before, null);
  const posted = planTransactionChange(actor, created.record, { ...created.record, status: 'posted', version: 2 }, 'post');
  assert.equal(posted.audit.action, 'POST'); assert.deepEqual(posted.audit.before, created.record);
  assert.throws(() => planTransactionChange(actor, posted.record, { ...posted.record, amount: '11', status: 'void', version: 3 }, 'change'));
  assert.throws(() => planTransactionChange(actor, posted.record, { ...posted.record, status: 'draft', version: 3 }, 'reopen'));
  const voided = planTransactionChange(actor, posted.record, { ...posted.record, status: 'void', version: 3 }, 'correction');
  assert.equal(voided.audit.action, 'VOID');
  assert.throws(() => planTransactionChange(actor, voided.record, { ...voided.record, status: 'posted', version: 4 }, 'reopen'));
  assert.throws(() => planTransactionChange(actor, created.record, { ...created.record }, 'stale'));
  assert.throws(() => planTransactionChange(actor, null, draft, ''));
  for (const role of ['ADMIN', 'WAREHOUSE', 'OUTLET']) assert.throws(() => planTransactionChange({ ...actor, role }, null, draft, 'create'));
});
test('role matrix preserves existing gate and denies ADMIN/OUTLET', () => {
  assert.equal(canReadMultiSourceFinance('FINANCE', false), true);
  assert.equal(canReadMultiSourceFinance('WAREHOUSE', true), true);
  for (const role of ['ADMIN', 'OUTLET', undefined]) { assert.equal(canReadMultiSourceFinance(role, true), false); assert.equal(canManageFinance(role), false); }
  assert.equal(canReadMultiSourceFinance('WAREHOUSE', false), false);
  assert.equal(canManageFinance('WAREHOUSE'), false); assert.equal(canManageFinance('FINANCE'), true);
});
async function requestRoute(role: string | null, gate: boolean, url: string, query: Record<string, unknown> = {}) {
  let reads = 0;
  const ds = { read: async () => { reads++; return source('WAREHOUSE', [warehouse]); } };
  const router = createFinanceRouter({ warehouse: ds, outlet: ds, authenticateReadOnly: async () => role === null ? null : { role, warehouseGateVerified: gate } });
  const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(body: any) { resolve({ status, body }); return this; } };
    router({ method: 'GET', url, headers: {}, query } as any, res as any, reject);
  });
  return { ...response, reads };
}
test('prepared router checks access and filters before source reads, without sockets/DB', async () => {
  for (const [role, gate, status] of [[null, false, 401], ['ADMIN', true, 403], ['OUTLET', true, 403], ['WAREHOUSE', false, 403]] as const) {
    const response = await requestRoute(role, gate, '/report', {}); assert.equal(response.status, status); assert.equal(response.reads, 0);
  }
  const invalid = await requestRoute('FINANCE', false, '/report', {}); assert.equal(invalid.status, 400); assert.equal(invalid.reads, 0);
  const report = await requestRoute('WAREHOUSE', true, '/report', { ...filter, mode: 'WAREHOUSE', outletIds: undefined });
  assert.equal(report.status, 200); assert.equal(report.reads, 1);
  const manifest = await requestRoute('FINANCE', false, '/accounts'); assert.equal(manifest.body.persistenceEnabled, false); assert.equal(manifest.reads, 0);
});
