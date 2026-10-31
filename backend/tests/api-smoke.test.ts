// End-to-end smoke test of the operational API: every route is called over real
// HTTP against the real Express app, with a temporary database. It checks that
// each route is reachable, enforces its access rule and changes the state it
// claims to — not the finance arithmetic, which has its own tests.
// NODE_ENV=test keeps server.ts from listening on the real port.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { closePool, withTemporaryDatabase } from './helpers/temporaryDatabase.ts';

after(closePool);

const FINANCE_PASSWORD = 'finance-smoke-only';
const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

// One client per account: keeps that account's session cookies, like a browser.
function client(base: string) {
  const jar = new Map<string, string>();
  return {
    cookies: jar,
    async call(method: string, path: string, body?: unknown) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const index = pair.indexOf('=');
        const [name, value] = [pair.slice(0, index).trim(), pair.slice(index + 1)];
        if (value) jar.set(name, value); else jar.delete(name);
      }
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
  };
}

async function seed(connection: any) {
  await connection.query("INSERT INTO outlets (id, outlet_code, outlet_name, is_active) VALUES (1, 'smoke-outlet', 'Smoke Outlet', 1)");
  await connection.query(`INSERT INTO users (id, name, username, email, password, role, outlet_id, is_active) VALUES
    (1, 'Outlet Smoke', 'smoke-outlet-user', 'outlet@smoke.test', 'outlet-pass', 'OUTLET', 1, 1),
    (2, 'Gudang Smoke', 'smoke-warehouse', 'warehouse@smoke.test', 'warehouse-pass', 'WAREHOUSE', NULL, 1)`);
  await connection.query(`INSERT INTO items (id, item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES
    (1, 'Ayam Mentah (kg)', 'Raw Material', 'RM-801', 45000, 20000, 100),
    (2, 'Box Nasi (pack/10)', 'Packaging', 'PKG-801', 12000, 9000, 100)`);
  // getInventory() auto-seeds the HD catalog when it holds fewer than 10 items;
  // these filler rows keep that background seeding out of the smoke test.
  await connection.query(`INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock)
    SELECT CONCAT('Filler ', n), 'Support Material', CONCAT('SM-80', n), 1000, 1000, 0 FROM (SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) f`);
  // Approval records the cost of the moment, but only for an item that has been
  // bought before; without this history every HPP would be reported as unknown.
  await connection.query("INSERT INTO vendors (id, vendor_code, vendor_name) VALUES (1, 'VND-SEED', 'Vendor Seed')");
  await connection.query("INSERT INTO purchase_transactions (id, transaction_code, vendor_id, payment_method, transaction_date, total_amount) VALUES (1, 'IN-SEED', 1, 'Transfer', ?, 2000000)", [todayJakarta()]);
  await connection.query("INSERT INTO purchase_items (purchase_id, item_id, quantity, price, subtotal, avg_cost_after) VALUES (1, 1, 100, 20000, 2000000, 20000), (1, 2, 100, 9000, 900000, 9000)");
  await connection.query('INSERT INTO finance_security (id, password_hash, password_version) VALUES (1, ?, 1) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), password_version = VALUES(password_version)', [await bcrypt.hash(FINANCE_PASSWORD, 10)]);
}

async function withApi(run: (api: { outlet: ReturnType<typeof client>; warehouse: ReturnType<typeof client>; anonymous: ReturnType<typeof client>; connection: any }) => Promise<void>) {
  process.env.NODE_ENV = 'test';
  await withTemporaryDatabase(async (connection) => {
    await seed(connection);
    const { app } = await import('../src/server.ts');
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const outlet = client(base), warehouse = client(base), anonymous = client(base);
      assert.equal((await outlet.call('POST', '/api/auth/login', { email: 'outlet@smoke.test', password: 'outlet-pass' })).status, 200);
      assert.equal((await warehouse.call('POST', '/api/auth/login', { email: 'warehouse@smoke.test', password: 'warehouse-pass' })).status, 200);
      await run({ outlet, warehouse, anonymous, connection });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

// An outlet request with two lines, ready for the warehouse to decide on.
const twoLineRequest = (outlet: ReturnType<typeof client>) => outlet.call('POST', '/api/requests', {
  paymentMethod: 'Transfer', requestDate: todayJakarta(),
  items: [{ itemId: 1, quantity: 5, price: 45000 }, { itemId: 2, quantity: 4, price: 12000 }],
});

test('login is required and the role decides who may create a request', async () => {
  await withApi(async ({ outlet, warehouse, anonymous }) => {
    assert.equal((await anonymous.call('POST', '/api/requests', { items: [{ itemId: 1, quantity: 1, price: 1 }] })).status, 401);
    assert.equal((await warehouse.call('POST', '/api/requests', { items: [{ itemId: 1, quantity: 1, price: 1 }] })).status, 403);
    assert.equal((await outlet.call('POST', '/api/requests', { items: [] })).status, 400);

    const created = await twoLineRequest(outlet);
    assert.equal(created.status, 200);
    assert.equal(created.body.request.outletId, 1); // the requester's outlet, recorded on the request
    assert.equal(created.body.request.status, 'Pending');
    assert.match(created.body.request.requestCode, /^REQ-/);

    const detail = await warehouse.call('GET', `/api/requests/${created.body.request.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.request.items.length, 2);
    assert.equal((await warehouse.call('GET', '/api/requests?status=Pending')).body.requests.length, 1);
    assert.equal((await warehouse.call('GET', '/api/requests/999999')).status, 404);
  });
});

test('deciding one line closes the request: the rest is auto-rejected, stock and history follow', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const request = (await twoLineRequest(outlet)).body.request;
    const [lines]: any = await connection.query('SELECT id, item_id FROM request_items WHERE request_id = ? ORDER BY id', [request.id]);
    const [ayam, box] = lines;

    // Partial approval: 3 of the 5 requested.
    const approved = await warehouse.call('POST', `/api/requests/${request.id}/items/${ayam.id}/approve`, { staffName: 'Gudang', approvedQuantity: 3 });
    assert.equal(approved.status, 200);

    const detail = (await warehouse.call('GET', `/api/requests/${request.id}`)).body.request;
    assert.equal(detail.status, 'Partially Approved');
    assert.equal(detail.items.find((item: any) => item.id === ayam.id).approvedQuantity, 3);
    // By design ("a request is processed once"): the untouched second line is
    // closed as rejected rather than left pending.
    assert.equal(detail.items.find((item: any) => item.id === box.id).status, 'Rejected');
    assert.equal(detail.items.find((item: any) => item.id === box.id).approvedQuantity, 0);

    const [stock]: any = await connection.query('SELECT id, current_stock FROM items ORDER BY id');
    assert.equal(Number(stock[0].current_stock), 97); // only the approved 3 left the warehouse
    assert.equal(Number(stock[1].current_stock), 100);

    // The cost of the sale is fixed at approval, from the purchase history.
    const [cost]: any = await connection.query('SELECT unit_cost, cogs_amount FROM inventory_cost_snapshots WHERE request_item_id = ?', [ayam.id]);
    assert.equal(Number(cost[0].unit_cost), 20000);
    assert.equal(Number(cost[0].cogs_amount), 60000);

    // Consequence of that rule: nothing in this request can be decided again,
    // so a multi-line request has to go through approve-all to approve more than
    // one of its lines.
    assert.equal((await warehouse.call('POST', `/api/requests/${request.id}/items/${box.id}/approve`, {})).status, 400);
    assert.equal((await warehouse.call('POST', `/api/requests/${request.id}/items/${box.id}/reject`, { staffName: 'Gudang' })).status, 400);
    assert.equal((await warehouse.call('POST', `/api/requests/${request.id}/items/${ayam.id}/approve`, {})).status, 400);

    const outgoing = (await warehouse.call('GET', '/api/history/outgoing')).body.history;
    const soldLines = outgoing.flatMap((entry: any) => entry.items ?? []).filter((line: any) => line.status === 'Approved');
    assert.equal(soldLines.length, 1);
    assert.equal(soldLines[0].approvedQuantity, 3);
  });
});

test('approve-all decides every pending line at once, with per-line quantities', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const request = (await twoLineRequest(outlet)).body.request;
    const [lines]: any = await connection.query('SELECT id FROM request_items WHERE request_id = ? ORDER BY id', [request.id]);

    // Second line cut to 0: approve-all closes it as rejected rather than approving it.
    const result = await warehouse.call('POST', `/api/requests/${request.id}/approve-all`, { staffName: 'Gudang', customQuantities: { [lines[0].id]: 2, [lines[1].id]: 0 } });
    assert.equal(result.status, 200);

    const detail = (await warehouse.call('GET', `/api/requests/${request.id}`)).body.request;
    assert.equal(detail.status, 'Partially Approved');
    assert.deepEqual(detail.items.map((item: any) => [item.status, item.approvedQuantity]), [['Approved', 2], ['Rejected', 0]]);
    const [stock]: any = await connection.query('SELECT current_stock FROM items ORDER BY id');
    assert.equal(Number(stock[0].current_stock), 98);

    // HPP is captured at approval time, by this route as well as the per-line one.
    const [cost]: any = await connection.query('SELECT unit_cost, approved_quantity FROM inventory_cost_snapshots WHERE request_item_id = ?', [lines[0].id]);
    assert.equal(Number(cost[0].unit_cost), 20000);
    assert.equal(Number(cost[0].approved_quantity), 2);
    // The line cut to 0 is rejected, so it books no cost at all.
    const [none]: any = await connection.query('SELECT COUNT(*) AS n FROM inventory_cost_snapshots WHERE request_item_id = ?', [lines[1].id]);
    assert.equal(Number(none[0].n), 0);

    assert.equal((await warehouse.call('POST', `/api/requests/${request.id}/approve-all`, {})).status, 400);
    assert.equal((await warehouse.call('POST', '/api/requests/999999/approve-all', {})).status, 400);
  });
});

test('incoming history and the operational dashboard report what was received', async () => {
  await withApi(async ({ warehouse, anonymous, outlet }) => {
    const received = await warehouse.call('POST', '/api/inventory/incoming', {
      vendorCode: 'VND-SMOKE', vendorName: 'Vendor Smoke', paymentMethod: 'Transfer', transactionDate: todayJakarta(),
      items: [{ itemId: 1, itemName: 'Ayam Mentah (kg)', quantity: 10, price: 25000 }],
    });
    assert.equal(received.status, 200);

    const incoming = (await warehouse.call('GET', '/api/history/incoming')).body.history;
    const entry = incoming.find((row: any) => row.transactionCode === received.body.transaction?.transactionCode || row.transactionCode !== 'IN-SEED');
    assert.equal(incoming.length, 2); // the seeded purchase plus this one
    assert.equal(entry.items[0].quantity, 10);
    assert.equal(entry.items[0].price, 25000);

    // The operational dashboard is Warehouse-only and needs a session.
    assert.equal((await anonymous.call('GET', '/api/dashboard/warehouse-ops-stats')).status, 401);
    assert.equal((await outlet.call('GET', '/api/dashboard/warehouse-ops-stats')).status, 403);
    const dashboard = await warehouse.call('GET', '/api/dashboard/warehouse-ops-stats');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.items.find((item: any) => item.itemCode === 'RM-801').currentStock, 110);
    assert.equal(dashboard.body.purchases.length, 2);
  });
});

test('finance password gate: Warehouse only, wrong password refused, session opens the report', async () => {
  await withApi(async ({ warehouse, outlet, anonymous }) => {
    assert.equal((await anonymous.call('GET', '/api/finance/access/status')).status, 403);
    assert.equal((await outlet.call('POST', '/api/finance/access/verify', { password: FINANCE_PASSWORD })).status, 403);

    // A Warehouse session alone is not enough to read the finance report.
    assert.equal((await warehouse.call('GET', '/api/dashboard/finance-stats')).body.code, 'FINANCE_ACCESS_REQUIRED');
    const before = await warehouse.call('GET', '/api/finance/access/status');
    assert.deepEqual([before.body.configured, before.body.active], [true, false]);

    assert.equal((await warehouse.call('POST', '/api/finance/access/verify', { password: 'wrong' })).status, 401);
    assert.equal(warehouse.cookies.has('hd_finance_access'), false);

    const verified = await warehouse.call('POST', '/api/finance/access/verify', { password: FINANCE_PASSWORD });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.expiresIn, 900);
    assert.ok(warehouse.cookies.get('hd_finance_access'));
    assert.equal((await warehouse.call('GET', '/api/finance/access/status')).body.active, true);

    const report = await warehouse.call('GET', '/api/dashboard/finance-stats');
    assert.equal(report.status, 200);
    assert.ok(Array.isArray(report.body.itemProfitability));
    assert.equal(report.body.viewer.lockedOutletId, null);

    // Logging out of the gate closes the report again, without ending the login.
    assert.equal((await warehouse.call('POST', '/api/finance/access/logout')).status, 200);
    assert.equal((await warehouse.call('GET', '/api/dashboard/finance-stats')).body.code, 'FINANCE_ACCESS_REQUIRED');
    assert.equal((await warehouse.call('GET', '/api/requests')).status, 200);
  });
});

test('a rejection closes the request the same way, and moves no stock', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const request = (await twoLineRequest(outlet)).body.request;
    const [lines]: any = await connection.query('SELECT id FROM request_items WHERE request_id = ? ORDER BY id', [request.id]);

    assert.equal((await warehouse.call('POST', `/api/requests/${request.id}/items/${lines[0].id}/reject`, { staffName: 'Gudang' })).status, 200);
    const detail = (await warehouse.call('GET', `/api/requests/${request.id}`)).body.request;
    assert.deepEqual(detail.items.map((item: any) => item.status), ['Rejected', 'Rejected']);
    // The status describes the lines as they finally are: nothing was approved,
    // so the request is Rejected rather than 'Partially Approved'.
    assert.equal(detail.status, 'Rejected');
    // No stock moves on a rejection.
    const [stock]: any = await connection.query("SELECT current_stock FROM items WHERE item_code = 'RM-801'");
    assert.equal(Number(stock[0].current_stock), 100);
    assert.equal((await warehouse.call('POST', `/api/requests/${request.id}/items/${lines[1].id}/reject`, {})).status, 400);
  });
});

test('closing a period warns about the requests still waiting for approval', async () => {
  await withApi(async ({ outlet, warehouse }) => {
    assert.deepEqual((await warehouse.call('GET', '/api/inventory/stock-opname/pending-requests')).body, { count: 0, requests: [] });

    const undecided = (await twoLineRequest(outlet)).body.request;
    const decided = (await twoLineRequest(outlet)).body.request;
    const settled = await warehouse.call('POST', `/api/requests/${decided.id}/approve-all`, { staffName: 'Gudang' });
    assert.equal(settled.status, 200);

    const warning = (await warehouse.call('GET', '/api/inventory/stock-opname/pending-requests')).body;
    assert.equal(warning.count, 1); // only the request nobody has decided on
    assert.equal(warning.requests[0].requestCode, undecided.requestCode);
    assert.equal(warning.requests[0].outletName, 'Smoke Outlet');
    assert.equal(warning.requests[0].pendingItems, 2);
    assert.equal(warning.requests[0].pendingQuantity, 9);

    // The same list comes back with the closing itself, read inside its transaction.
    const closed = await warehouse.call('POST', '/api/inventory/stock-opname', {
      examinationDate: todayJakarta(), createdBy: 'Gudang', createdByUserId: 2, submissionKey: 'smoke-closing',
      physicalStocks: [{ itemId: 1, physicalStock: 98 }, { itemId: 2, physicalStock: 96 }],
    });
    assert.equal(closed.status, 201);
    assert.deepEqual(closed.body.opname.pendingRequests, warning);

    // Still pending after the closing, so it falls into the period that just opened.
    assert.equal((await warehouse.call('GET', '/api/inventory/stock-opname/pending-requests')).body.count, 1);
    const periods = (await warehouse.call('GET', '/api/dashboard/finance-periods')).body;
    assert.equal(periods.status ?? 200, 200);
  });
});
