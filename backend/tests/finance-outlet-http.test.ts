import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OutletHttpTransport, createConfiguredOutletSource, type OutletHttpContract } from '../src/finance/OutletHttpTransport.ts';
import { OutletFinanceDataSource, type OutletPage } from '../src/finance/OutletFinanceDataSource.ts';
import { FinanceAggregationService } from '../src/finance/FinanceAggregationService.ts';
import type { Filter } from '../src/finance/domain.ts';
const filter: Filter = { mode: 'OUTLET', startDate: '2026-10-01', endDate: '2026-10-31', outletIds: [1], timezone: 'Asia/Jakarta' };
const mapping = { externalOutletId: 'mock-A', outletId: 1, status: 'validated' as const, validFrom: '2026-01-01', validTo: null, displayName: 'Mock only', evidence: 'isolated test' };
const page: OutletPage = { outletIds: ['mock-A'], rows: [{ id: 'receipt', externalOutletId: 'mock-A', date: '2026-10-02', metric: 'SI', amount: '12.34', nature: 'EXTERNAL', reference: 'mock receipt' }], complete: true, nextCursor: null };
// Consumer test protocol ONLY: no claim about provider path/query/schema.
const contract: OutletHttpContract = { id: 'MOCK-ONLY', evidence: 'test protocol', reportRequest: (f, cursor) => ({ path: 'mock-reports', query: { start: f.startDate, end: f.endDate, timezone: f.timezone, cursor: cursor ?? '' } }), decodeReport: body => body as OutletPage };
test('real HTTP mock: auth, GET-only, failures, amounts, mappings, modes and no secret leakage', async t => {
  const token = 'isolated-test-token'; let status = 200; let body: unknown = page; let delay = 0;
  const logs: unknown[][] = [];
  for (const method of ['log', 'warn', 'error'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.method!); assert.equal(req.headers.authorization, `Bearer ${token}`);
    const url = new URL(req.url!, 'http://mock');
    assert.equal(url.pathname, '/api/mock-reports'); assert.equal(url.searchParams.get('start'), filter.startDate);
    assert.equal(url.searchParams.get('end'), filter.endDate); assert.equal(url.searchParams.get('timezone'), 'Asia/Jakarta');
    setTimeout(() => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }, delay);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const source = (mappings = [mapping], timeout = 500) => new OutletFinanceDataSource(mappings, new OutletHttpTransport(base, token, timeout, contract), timeout + 100);
  let result = await source().read(filter);
  assert.equal(result.facts[0].amount, '12.34'); assert.equal(result.coverage[0].status, 'Missing');
  for (status of [401, 403, 404, 429, 500, 503]) {
    result = await source().read(filter); assert.equal(result.issues[0].status, 'Error'); assert.deepEqual(result.facts, []);
    assert.ok(!JSON.stringify(result).includes(token));
  }
  status = 200;
  for (const amount of [12.34, 'NaN', '1e3', '12,34', '0.1234567']) {
    body = { ...page, rows: [{ ...page.rows[0], amount }] };
    assert.equal((await source().read(filter)).issues[0].status, 'Error');
  }
  body = { unexpected: true }; assert.equal((await source().read(filter)).issues[0].status, 'Error');
  body = page; delay = 100; assert.equal((await source([mapping], 10).read(filter)).issues[0].status, 'Error'); delay = 0;
  assert.equal((await source([]).read(filter)).issues[0].status, 'Unmapped');
  assert.equal((await source().read({ ...filter, outletIds: [2] })).facts.length, 0);
  body = { ...page, rows: [page.rows[0], page.rows[0]] }; assert.equal((await source().read(filter)).facts.length, 1);
  body = { ...page, rows: [{ ...page.rows[0], nature: 'INTERNAL' }] };
  result = await source().read(filter);
  for (const mode of ['WAREHOUSE', 'OUTLET', 'ALL'] as const) {
    const report = new FinanceAggregationService().aggregate({ ...filter, mode }, [result]);
    assert.equal(report.complete, false); assert.equal(report.metrics.EBIT.amount, null);
    assert.equal(report.byUnit.some(u => u.knownAmounts.SI !== '0.000000'), false);
    if (mode === 'ALL') assert.equal(report.eliminationVerified, false);
  }
  const count = calls.length;
  await createConfiguredOutletSource({}).read(filter);
  assert.equal((await createConfiguredOutletSource({ OUTLET_FINANCE_API_ENABLED: 'true' }).read(filter)).issues[0].status, 'Missing');
  assert.equal((await createConfiguredOutletSource({ OUTLET_FINANCE_API_ENABLED: 'true' }, contract).read(filter)).issues[0].status, 'Unmapped');
  assert.equal(calls.length, count); assert.ok(calls.every(method => method === 'GET'));
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  assert.equal((await source().read(filter)).issues[0].status, 'Error');
  assert.ok(!JSON.stringify(logs).includes(token));
});
test('unsafe configuration and redirect cannot forward bearer credentials', async () => {
  for (const url of ['http://example.com/api', 'https://user:pass@example.com/api', 'https://example.com/api?secret=x']) assert.throws(() => new OutletHttpTransport(url, 'test', 50, contract));
  const transport = new OutletHttpTransport('http://127.0.0.1/api', 'test', 50, { ...contract, reportRequest: () => ({ path: 'https://example.com/steal', query: {} }) });
  await assert.rejects(() => transport.page(filter, null), /UNSAFE_PATH/);
});
