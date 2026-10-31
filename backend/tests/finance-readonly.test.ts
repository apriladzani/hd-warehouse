import { createOperationalSessions } from '../src/finance/operationalSession.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type Request } from 'express';
import { createHash, scryptSync } from 'node:crypto';
import { mountFinanceReadOnly } from '../src/finance/mount.ts';
import { createFinanceReadAuthenticator, verifyFinanceLoginPassword } from '../src/finance/authentication.ts';
import { assertSelectOnlyGrants, guardedFinanceExecutor, financePoolOptions, createFinanceReadDatabase, FinanceReadUnavailable } from '../src/finance/readOnlyConnection.ts';
import { WarehouseFinanceDataSource, type SelectExecutor } from '../src/finance/WarehouseFinanceDataSource.ts';
import { FinanceAggregationService } from '../src/finance/FinanceAggregationService.ts';
import { unavailable, type Filter } from '../src/finance/domain.ts';
import { createFinanceClient } from '../../frontend/src/finance/api.ts';
const filter: Filter = { mode: 'WAREHOUSE', startDate: '2026-10-01', endDate: '2026-10-23', outletIds: [7], timezone: 'Asia/Jakarta' };
const cookie = 'a'.repeat(43), password = 'fixture-password';
const headers = { 'x-auth-email': 'finance@fixture.invalid', 'x-auth-password': password };
function request(headers: Record<string, string>): Request { return { header: (name: string) => headers[name.toLowerCase()] } as Request; }
function dbFixture(role = 'FINANCE', gate = true) {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const db: SelectExecutor = { async select(sql, parameters) {
    calls.push({ sql, parameters });
    if (/FROM users/.test(sql)) return [{ id: 9, role, password, isActive: 1 }];
    if (/FROM finance_access_sessions/.test(sql)) return gate ? [{ expiresIn: 500 }] : [];
    if (/FROM finance_security/.test(sql)) return [{ configured: 1 }];
    if (/FROM outlets/.test(sql)) return [{ id: 7, code: 'HD-7', name: 'Verified fixture master', isActive: 1 }];
    if (/information_schema.COLUMNS/.test(sql)) return [{ tableName: 'request_items', columnName: 'unit_cost_snapshot' }];
    if (/FROM request_items/.test(sql)) return [{ id: '41', outletId: 7, reference: 'REQ-FIXTURE', quantity: '2', price: '130', unitCost: '100.000001' }];
    return [];
  } };
  return { db, calls };
}
// Real Express app + mounted production factory, but socket-free requests and
// mock SELECT executor. No operational server import, listener or DB connection.
function invoke(app: Express, url: string, hdrs = headers, method = 'GET') {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const req = { url, originalUrl: url, method, headers: hdrs };
    const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(body: any) { resolve({ status, body }); return this; }, end() { resolve({ status, body: null }); } };
    app.handle(req as any, res as any, error => error ? reject(error) : resolve({ status: 404, body: null }));
  });
}
const reportUrl = (mode = 'WAREHOUSE') => `/api/finance/v2/report?mode=${mode}&startDate=2026-10-01&endDate=2026-10-23&outletIds=7`;

test('actual server registers v2 paths before fallbacks without listening or touching DB in test mode', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const { app } = await import('../src/server.ts');
    // Missing credentials are rejected before acquiring either database pool.
    for (const url of ['/api/finance/v2/accounts', reportUrl()]) assert.equal((await invoke(app, url, {})).status, 401);
    assert.equal((await invoke(app, '/api/finance/access/status', {})).status, 403);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('mounted production router serves both exact v2 paths and not unprefixed paths', async () => {
  const app = express(), fixture = dbFixture(); mountFinanceReadOnly(app, fixture.db);
  const accounts = await invoke(app, '/api/finance/v2/accounts');
  assert.equal(accounts.status, 200); assert.equal(accounts.body.accounts.length, 27); assert.equal(accounts.body.persistenceEnabled, false);
  const report = await invoke(app, reportUrl()); assert.equal(report.status, 200); assert.equal(report.body.reconciliation.distributions[0].reference, 'REQ-FIXTURE');
  assert.equal((await invoke(app, '/accounts')).status, 404);
  assert.equal((await invoke(app, '/api/finance/v2/report', headers, 'POST')).status, 405);
  assert.ok(fixture.calls.every(call => /^SELECT\s/.test(call.sql)));
});
test('mounted report passes date/outlet filters, master, exact reconciliation cost and Missing external metrics', async () => {
  const app = express(), { db, calls } = dbFixture(); mountFinanceReadOnly(app, db);
  const { body } = await invoke(app, reportUrl());
  assert.deepEqual(body.filter, filter); assert.equal(body.outlets[0].name, 'Verified fixture master');
  assert.equal(body.reconciliation.distributions[0].cost, '200.000002');
  assert.equal(body.metrics.SI.amount, null); assert.equal(body.metrics.COGS.amount, null); assert.equal(body.metrics.CI.amount, null);
  assert.equal(body.metrics.SI.status, 'Missing'); assert.equal(body.complete, false);
  const query = calls.find(c => c.sql.includes('FROM request_items'))!;
  assert.deepEqual(query.parameters, ['2026-10-01', '2026-10-23', 7]); assert.ok(query.sql.includes('r.outlet_id IN (?)'));
});
test('mounted role matrix and gate prevent unauthorized report reads', async () => {
  for (const [role, gate, expected] of [['FINANCE', false, 200], ['WAREHOUSE', true, 200], ['WAREHOUSE', false, 403], ['ADMIN', true, 403], ['OUTLET', true, 403]] as const) {
    const app = express(), fixture = dbFixture(role, gate); mountFinanceReadOnly(app, fixture.db);
    const result = await invoke(app, reportUrl(), { ...headers, cookie: `hd_finance_access=${cookie}` });
    assert.equal(result.status, expected, role);
    if (expected === 403) assert.ok(!fixture.calls.some(c => c.sql.includes('FROM request_items')));
  }
});
test('missing/wrong credentials, inactive and ambiguous user fail without fallback/seed', async () => {
  const app = express(), fixture = dbFixture(); mountFinanceReadOnly(app, fixture.db);
  assert.equal((await invoke(app, '/api/finance/v2/accounts', {})).status, 401); assert.equal(fixture.calls.length, 0);
  assert.equal((await invoke(app, reportUrl(), { ...headers, 'x-auth-password': 'wrong' })).status, 401);
  for (const rows of [[], [{ id: 1, role: 'FINANCE', password, isActive: 0 }], [{ id: 1 }, { id: 2 }]]) {
    const auth = createFinanceReadAuthenticator({ select: async () => rows }); assert.equal(await auth.authenticate(request(headers)), null);
  }
});
test('read-only password verification matches existing scrypt and legacy newline semantics', async () => {
  const salt = Buffer.alloc(16, 3), digest = scryptSync(password, salt, 64);
  const stored = `scrypt$${salt.toString('hex')}$${digest.toString('hex')}`;
  assert.equal(await verifyFinanceLoginPassword(password, stored), true);
  assert.equal(await verifyFinanceLoginPassword('wrong', stored), false);
  assert.equal(await verifyFinanceLoginPassword(password, password + '\r\n'), true);
  assert.equal(await verifyFinanceLoginPassword(password, null), false);
});
test('gate reads enforce user/token hash/version/expiry and never refresh or create sessions', async () => {
  const fixture = dbFixture('WAREHOUSE'), auth = createFinanceReadAuthenticator(fixture.db);
  const principal = await auth.authenticate(request({ ...headers, cookie: `hd_finance_access=${cookie}` }));
  assert.equal(principal?.warehouseGateVerified, true);
  const query = fixture.calls.find(c => c.sql.includes('FROM finance_access_sessions'))!;
  assert.deepEqual(query.parameters, [createHash('sha256').update(cookie).digest('hex'), 9]);
  assert.ok(query.sql.includes('s.password_version = f.password_version')); assert.ok(query.sql.includes('s.expires_at > UTC_TIMESTAMP()'));
  assert.ok(!JSON.stringify(query.parameters).includes(cookie));
  const before = fixture.calls.length;
  assert.equal((await auth.authenticate(request({ ...headers, cookie: 'hd_finance_access=%broken' })))?.warehouseGateVerified, false);
  assert.equal(fixture.calls.length, before + 1);
  assert.deepEqual(await auth.status(request({ ...headers, cookie: `hd_finance_access=${cookie}` })), { configured: true, active: true, expiresIn: 500 });
  assert.ok(fixture.calls.every(c => /^SELECT\s/.test(c.sql)));
});
test('invalid date/outlet filters rejected before Warehouse queries', async () => {
  const app = express(), fixture = dbFixture(); mountFinanceReadOnly(app, fixture.db);
  for (const url of ['/api/finance/v2/report?mode=WAREHOUSE&startDate=2026-02-30&endDate=2026-10-23', reportUrl().replace('outletIds=7', 'outletIds=7%20OR%201=1')]) assert.equal((await invoke(app, url)).status, 400);
  assert.ok(fixture.calls.every(c => c.sql.includes('FROM users')));
});
test('Outlet and All modes keep Outlet API disabled and totals incomplete', async () => {
  const app = express(), fixture = dbFixture(); mountFinanceReadOnly(app, fixture.db);
  for (const mode of ['OUTLET', 'ALL']) {
    const response = await invoke(app, reportUrl(mode)); assert.equal(response.status, 200);
    assert.equal(response.body.complete, false); assert.equal(response.body.metrics.SI.amount, null);
    assert.ok(response.body.issues.some((i: any) => i.reason.includes('integration disabled')));
  }
});
test('database failure during authentication is 503; data failure is explicit Error/null', async () => {
  const app = express(); mountFinanceReadOnly(app, { select: async () => { throw new FinanceReadUnavailable(); } });
  assert.equal((await invoke(app, '/api/finance/v2/accounts')).status, 503);
  const dataApp = express(), fixture = dbFixture();
  mountFinanceReadOnly(dataApp, { select: async (sql, args) => { if (sql.includes('FROM users')) return fixture.db.select(sql, args); throw new Error('database down secret'); } });
  const response = await invoke(dataApp, reportUrl()); assert.equal(response.status, 200); assert.equal(response.body.metrics.CI.status, 'Error'); assert.equal(response.body.metrics.CI.amount, null);
  assert.ok(!JSON.stringify(response.body).includes('database down secret'));
});
test('Outlet mode with no readable units preserves Error rather than silently becoming Missing', () => {
  const result = new FinanceAggregationService().aggregate({ ...filter, mode: 'OUTLET', outletIds: null }, [unavailable('WAREHOUSE', 'Error', 'DB unavailable'), unavailable('OUTLET', 'Missing', 'Disabled')]);
  assert.equal(result.metrics.SI.status, 'Error'); assert.equal(result.metrics.EBIT.amount, null);
});
test('missing historical snapshot schema uses NULL cost, never triggers migration', async () => {
  const queries: string[] = [];
  const result = await new WarehouseFinanceDataSource({ async select(sql) {
    queries.push(sql);
    if (sql.includes('FROM request_items')) { assert.ok(sql.includes('CAST(NULL AS CHAR) AS unitCost')); assert.ok(!sql.includes('JOIN inventory_cost_snapshots')); return [{ id: '2', outletId: null, reference: 'REQ-2', quantity: '1', price: '1', unitCost: null }]; }
    return [];
  } }).read({ ...filter, outletIds: null });
  assert.equal(result.distributions[0].cost, null); assert.ok(queries.every(sql => /^SELECT\s/.test(sql)));
});
test('SELECT-only grants accepted; write/admin/FILE/EXECUTE/roles/grant option rejected', () => {
  const grant = (text: string) => ({ Grant: text });
  assert.doesNotThrow(() => assertSelectOnlyGrants([grant("GRANT USAGE ON *.* TO 'ro'@'%'"), grant("GRANT SELECT ON `hd_warehouse`.* TO 'ro'@'%'")]));
  for (const text of ["GRANT ALL PRIVILEGES ON *.* TO 'ro'@'%'", "GRANT SELECT, INSERT ON `hd_warehouse`.* TO 'ro'@'%'", "GRANT FILE ON *.* TO 'ro'@'%'", "GRANT EXECUTE ON *.* TO 'ro'@'%'", "GRANT 'read_role'@'%' TO 'ro'@'%'", "GRANT SELECT ON *.* TO 'ro'@'%' WITH GRANT OPTION", "GRANT USAGE ON *.* TO 'ro'@'%'"]) assert.throws(() => assertSelectOnlyGrants([grant(text)]), FinanceReadUnavailable);
});
test('guard checks privileges on same connection, rejects write before acquire and always releases', async () => {
  const calls: string[] = []; let releases = 0, acquisitions = 0;
  const connection = { query: async (sql: string) => { calls.push(sql); return [[{ Grant: "GRANT SELECT ON `hd_warehouse`.* TO 'ro'@'%'" }], []]; }, execute: async ({ sql }: any) => { calls.push(sql); return [[{ id: 1 }], []]; }, release() { releases++; } };
  const db = guardedFinanceExecutor(async () => { acquisitions++; return connection as any; });
  await assert.rejects(() => db.select('UPDATE items SET current_stock = 0', [])); assert.equal(acquisitions, 0);
  await db.select('SELECT id FROM outlets', []); assert.deepEqual(calls, ['SHOW GRANTS FOR CURRENT_USER', 'SELECT id FROM outlets']); assert.equal(releases, 1);
  connection.query = async sql => { calls.push(sql); return [[{ Grant: "GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost'" }], []]; };
  await assert.rejects(() => db.select('SELECT id FROM outlets', [])); assert.equal(releases, 2); assert.equal(calls.filter(s => s === 'SELECT id FROM outlets').length, 1);
});
test('dedicated config is mandatory, lazy and never falls back to operational credentials', async () => {
  assert.throws(() => financePoolOptions({ DB_USER: 'root', DB_PASSWORD: 'fixture' }), FinanceReadUnavailable);
  const options = financePoolOptions({ FINANCE_DB_HOST: 'test.invalid', FINANCE_DB_NAME: 'isolated_test', FINANCE_DB_USER: 'test_select', FINANCE_DB_PASSWORD: 'fixture' });
  assert.equal(options.multipleStatements, false); assert.equal(options.decimalNumbers, false);
  const db = createFinanceReadDatabase({}); await assert.rejects(() => db.executor.select('SELECT 1', []), FinanceReadUnavailable); await db.close();
});
test('frontend typed client consumes actual mounted mock-backed report contract including master', async () => {
  const app = express(), fixture = dbFixture(); const sessions = createOperationalSessions(fixture.db);
  let sessionCookie = '';
  await sessions.login(request({}), { append: (_key: string, value: string) => { sessionCookie = value.split(';')[0]; }, setHeader: () => {} } as any, headers['x-auth-email'], password);
  mountFinanceReadOnly(app, fixture.db, sessions);
  const client = createFinanceClient({ id: 9, name: 'Fixture', email: headers['x-auth-email'], role: 'FINANCE' }, async (url, init) => {
    const h = Object.fromEntries(Object.entries(init!.headers as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    h.cookie = sessionCookie;
    const result = await invoke(app, String(url), h);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
  });
  const report = await client.report(filter); assert.equal(report.outlets[0].id, 7); assert.equal(report.metrics.SI.amount, null);
  const accounts = await client.accounts(); assert.equal(accounts.persistenceEnabled, false);
});

test('Finance env loader uses backend file independently of cwd, preserves exported values and never loads example', async () => {
  const { loadFinanceEnvironment, FINANCE_ENV_FILE } = await import('../src/finance/environment.ts');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'hd-finance-env-'));
  try {
    const file = join(directory, '.env');
    writeFileSync(file, 'FINANCE_DB_HOST=localhost\nFINANCE_DB_NAME=isolated_test\nFINANCE_DB_USER=fixture_reader\nFINANCE_DB_PASSWORD="fixture#password"\nDB_USER=should_not_change_operational\n');
    const inherited = { FINANCE_DB_HOST: '127.0.0.1', DB_USER: 'unchanged' };
    const result = loadFinanceEnvironment(inherited, file);
    assert.equal(result.FINANCE_DB_HOST, '127.0.0.1'); assert.equal(result.FINANCE_DB_PASSWORD, 'fixture#password');
    assert.equal(result.DB_USER, 'unchanged'); assert.equal(inherited.FINANCE_DB_NAME, undefined);
    assert.equal(FINANCE_ENV_FILE, resolve(import.meta.dirname, '../.env').replace('/tests/.env', '/.env'));
    assert.equal(loadFinanceEnvironment({}, join(directory, 'absent.env')).FINANCE_DB_USER, undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('configuration failure survives both executor and authentication wrappers with missing names only', async () => {
  const db = createFinanceReadDatabase({});
  try {
    const auth = createFinanceReadAuthenticator(db.executor);
    await assert.rejects(() => auth.authenticate(request(headers)), (e: FinanceReadUnavailable) => {
      assert.equal(e.category, 'configuration');
      assert.deepEqual(e.missingVariables, ['FINANCE_DB_HOST', 'FINANCE_DB_NAME', 'FINANCE_DB_USER', 'FINANCE_DB_PASSWORD']);
      return true;
    });
  } finally { await db.close(); }
});

test('safe diagnostics retain only stage and MySQL error code, never driver message/sql/credentials', async () => {
  const { financeFailure, logFinanceFailure } = await import('../src/finance/readOnlyConnection.ts');
  const lines: unknown[][] = [], previous = console.error;
  console.error = (...args) => { lines.push(args); };
  try {
    const failure = financeFailure({ code: 'ER_ACCESS_DENIED_ERROR', message: 'private-password', sql: 'private-hash', connectionString: 'private-token' }, 'connection');
    logFinanceFailure(failure);
    const output = JSON.stringify(lines);
    assert.ok(output.includes('ER_ACCESS_DENIED_ERROR')); assert.ok(output.includes('connection'));
    for (const secret of ['private-password', 'private-hash', 'private-token', 'connectionString']) assert.ok(!output.includes(secret));
    assert.equal(financeFailure({ code: 'private-password' }, 'query').mysqlCode, undefined);
  } finally { console.error = previous; }
});

test('driver connection, metadata and query failures preserve distinct sanitized categories', async () => {
  const failure = { code: 'ER_BAD_FIELD_ERROR', message: 'private-sql-secret' };
  for (const stage of ['connection', 'grants_metadata', 'query'] as const) {
    const db = guardedFinanceExecutor(async () => {
      if (stage === 'connection') throw failure;
      return { query: async () => { if (stage === 'grants_metadata') throw failure; return [[{ Grant: "GRANT SELECT ON `test`.* TO 'ro'@'localhost'" }], []]; }, execute: async () => { throw failure; }, release() {} } as any;
    });
    await assert.rejects(() => db.select('SELECT id FROM users', []), (e: FinanceReadUnavailable) => e.category === stage && e.mysqlCode === 'ER_BAD_FIELD_ERROR' && !e.message.includes('private-sql-secret'));
  }
});

test('MySQL 9.7 quoted/escaped SHOW GRANTS samples accepted without widening privilege policy', () => {
  assert.doesNotThrow(() => assertSelectOnlyGrants([
    { Grant: 'GRANT USAGE ON *.* TO `finance_reader`@`localhost`' },
    { Grant: 'GRANT SELECT ON `hd\\_warehouse\\_finance\\_test`.* TO `finance_reader`@`localhost`' },
  ]));
  assert.throws(() => assertSelectOnlyGrants([{ Grant: 'GRANT SELECT, INSERT ON `hd_warehouse_finance_test`.* TO `finance_reader`@`localhost`' }]), (e: FinanceReadUnavailable) => e.category === 'grants_policy');
});

test('missing Finance config reproduces exact 503 body and safe diagnostic without any DB access', async () => {
  const { createFinanceRouter } = await import('../src/finance/router.ts');
  const db = createFinanceReadDatabase({}), app = express();
  const lines: unknown[][] = [], previous = console.error;
  console.error = (...args) => { lines.push(args); };
  try {
    app.use('/api/finance/v2', createFinanceRouter({ warehouse: { read: async () => { throw new Error('must not reach Warehouse'); } }, outlet: { read: async () => { throw new Error('must not reach Outlet'); } }, authenticateReadOnly: createFinanceReadAuthenticator(db.executor).authenticate }));
    const response = await invoke(app, reportUrl());
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Finance read-only authentication unavailable' });
    assert.ok(JSON.stringify(lines).includes('configuration'));
    assert.ok(JSON.stringify(lines).includes('FINANCE_DB_PASSWORD'));
    assert.ok(!JSON.stringify(lines).includes(password));
  } finally { console.error = previous; await db.close(); }
});
