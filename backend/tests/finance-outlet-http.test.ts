import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HdOutletClient, HdOutletError } from '../src/finance/hdOutletClient.ts';

// HD Outlet API client against a real local HTTP server (the API documented at
// https://hdoutlett.kii.lat/api-docs/): X-API-Key auth, GET only, failures as
// readable HdOutletError, and the key never leaving for another host.
const KEY = 'hdfc_fixture_key_only_for_tests_000000000000000';
const report = (id: number, date: string, outlet: string, extra: Record<string, unknown> = {}) => ({
  id, report_date: date, outlet_name: outlet, staff_name: 'Budi', total_income: 891500, total_expense: 23000, total_loss: 0,
  final_total: 868500, promo: 0, expenses: { gas: 0, meal: 13000, bonus: 10000, lain_lain_keterangan: 'catatan', total_expense: 23000 },
  payments: { tunai: 500000, qr: 391500, tf: 0, total_payment: 891500 }, ...extra,
});

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (base: string, seen: IncomingMessage[]) => Promise<void>) {
  const seen: IncomingMessage[] = [];
  const server = createServer((req, res) => { seen.push(req); handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as any).port}/api-docs/`, seen); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

test('reads outlets, expense categories and reports with the API key header', async () => {
  await withServer((req, res) => {
    if (req.headers['x-api-key'] !== KEY) return json(res, 401, { error: 'API key tidak valid atau sudah dicabut' });
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/outlets') return json(res, 200, [{ id: 1, name: 'Cisalak', active: true }, { id: 2, name: 'Aboh', active: false }]);
    if (url.pathname === '/api/master/expense-categories') return json(res, 200, [{ key: 'meal', name: 'Uang Makan' }, { key: 'galon', name: 'Air Galon' }]);
    if (url.pathname === '/api/reports') {
      assert.deepEqual([url.searchParams.get('startDate'), url.searchParams.get('endDate')], ['2026-11-17', '2026-11-17']);
      return json(res, 200, [report(5, '2026-11-17', 'Cisalak'), report(5, '2026-11-17', 'Cisalak'), report(6, '2026-11-18', 'Cisalak'), { id: 'x' }]);
    }
    json(res, 404, { error: 'not found' });
  }, async (base, seen) => {
    const client = new HdOutletClient(base, KEY, 2000);
    assert.deepEqual(await client.outlets(), [{ id: 1, name: 'Cisalak', active: true }, { id: 2, name: 'Aboh', active: false }]);
    assert.deepEqual((await client.expenseCategories()).map(c => c.name), ['Uang Makan', 'Air Galon']);
    const { reports, errors } = await client.reports('2026-11-17', '2026-11-17');
    assert.equal(reports.length, 1, 'duplicate and out-of-range reports are dropped');
    assert.deepEqual([reports[0].totalIncome, reports[0].totalLoss, reports[0].expenses], ['891500.00', '0.00', { gas: '0.00', meal: '13000.00', bonus: '10000.00' }]);
    assert.equal(errors.length, 1, 'an unreadable report is reported, not fatal');
    assert.ok(seen.every(r => r.method === 'GET'));
    assert.ok(seen.every(r => r.url!.startsWith('/api/')), 'the docs URL is normalised to the API base');
  });
});

test('a rejected key, server error, non-JSON answer and timeout are readable errors', async () => {
  for (const [handler, code] of [
    [(_: IncomingMessage, res: ServerResponse) => json(res, 401, { error: 'API key tidak valid' }), 'HTTP_401'],
    [(_: IncomingMessage, res: ServerResponse) => json(res, 500, { error: 'boom' }), 'HTTP_500'],
    [(_: IncomingMessage, res: ServerResponse) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html>'); }, 'INVALID_RESPONSE'],
    [() => { /* never answers */ }, 'TIMEOUT'],
  ] as const) {
    await withServer(handler, async (base) => {
      await assert.rejects(() => new HdOutletClient(base, KEY, 300).outlets(), (e: unknown) => e instanceof HdOutletError && e.code === code && !e.message.includes(KEY));
    });
  }
});

test('the key is never sent to another host: redirects refused, https only, key required', async () => {
  await withServer((_req, res) => { res.writeHead(302, { location: 'http://127.0.0.2:1/steal' }); res.end(); }, async (base) => {
    await assert.rejects(() => new HdOutletClient(base, KEY, 1000).outlets(), HdOutletError);
  });
  assert.throws(() => new HdOutletClient('http://hdoutlett.kii.lat/api/', KEY), HdOutletError, 'plain http only for localhost');
  assert.throws(() => new HdOutletClient('https://user:pass@hdoutlett.kii.lat/api/', KEY), HdOutletError);
  assert.throws(() => new HdOutletClient('https://hdoutlett.kii.lat/api/', ''), /OUTLET_FINANCE_API_TOKEN/);
});
