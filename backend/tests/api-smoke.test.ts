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

async function withApi(run: (api: { outlet: ReturnType<typeof client>; warehouse: ReturnType<typeof client>; anonymous: ReturnType<typeof client>; connection: any; base: string }) => Promise<void>) {
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
      await run({ outlet, warehouse, anonymous, connection, base });
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

// The scenario from the bug report: one outlet request, Barang A qty 3 and
// Barang B qty 3. Each test returns the two line ids and a reader for them.
async function requestAB(outlet: ReturnType<typeof client>, connection: any) {
  const request = (await outlet.call('POST', '/api/requests', {
    paymentMethod: 'Transfer', requestDate: todayJakarta(),
    items: [{ itemId: 1, quantity: 3, price: 45000 }, { itemId: 2, quantity: 3, price: 12000 }],
  })).body.request;
  const [lines]: any = await connection.query('SELECT id FROM request_items WHERE request_id = ? ORDER BY id', [request.id]);
  return { id: request.id as number, a: lines[0].id as number, b: lines[1].id as number };
}
const lineState = (detail: any, lineId: number) => {
  const line = detail.items.find((item: any) => item.id === lineId);
  return [line.status, Number(line.approvedQuantity || 0)];
};
const stockOf = async (connection: any) => {
  const [rows]: any = await connection.query('SELECT current_stock FROM items WHERE id IN (1, 2) ORDER BY id');
  return rows.map((row: any) => Number(row.current_stock));
};

test('Kasus 1: approving part of one line leaves the other line pending', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const r = await requestAB(outlet, connection);
    const detailOf = async () => (await warehouse.call('GET', `/api/requests/${r.id}`)).body.request;

    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/items/${r.a}/approve`, { staffName: 'Gudang', approvedQuantity: 2 })).status, 200);
    let detail = await detailOf();
    assert.deepEqual(lineState(detail, r.a), ['Approved', 2]);
    assert.deepEqual(lineState(detail, r.b), ['Pending', 0], 'Barang B is untouched');
    assert.equal(detail.status, 'Pending', 'a request with a pending line is still in progress');
    assert.deepEqual(await stockOf(connection), [98, 100], 'only the 2 approved units of A left the warehouse');

    // The cost of the sale is fixed at approval, from the purchase history.
    const [cost]: any = await connection.query('SELECT unit_cost, cogs_amount FROM inventory_cost_snapshots WHERE request_item_id = ?', [r.a]);
    assert.equal(Number(cost[0].unit_cost), 20000);
    assert.equal(Number(cost[0].cogs_amount), 40000);

    // A decided line cannot be decided again; the pending one still can.
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/items/${r.a}/approve`, {})).status, 400);
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/items/${r.a}/reject`, {})).status, 400);
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/items/${r.b}/approve`, { staffName: 'Gudang' })).status, 200);
    detail = await detailOf();
    assert.deepEqual(lineState(detail, r.b), ['Approved', 3]);
    assert.equal(detail.status, 'Partially Approved', 'A was only partly approved');
    assert.deepEqual(await stockOf(connection), [98, 97]);

    const outgoing = (await warehouse.call('GET', '/api/history/outgoing')).body.history;
    const soldLines = outgoing.flatMap((entry: any) => entry.items ?? []).filter((line: any) => line.status === 'Approved');
    assert.deepEqual(soldLines.map((line: any) => line.approvedQuantity).sort(), [2, 3]);
  });
});

test('Kasus 2: rejecting one line leaves the other line pending, and moves no stock', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const r = await requestAB(outlet, connection);
    const detailOf = async () => (await warehouse.call('GET', `/api/requests/${r.id}`)).body.request;

    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/items/${r.a}/reject`, { staffName: 'Gudang' })).status, 200);
    let detail = await detailOf();
    assert.deepEqual(lineState(detail, r.a), ['Rejected', 0]);
    assert.deepEqual(lineState(detail, r.b), ['Pending', 0], 'Barang B is neither approved nor rejected');
    assert.equal(detail.status, 'Pending');
    assert.deepEqual(await stockOf(connection), [100, 100]);
    const [booked]: any = await connection.query('SELECT COUNT(*) AS n FROM inventory_cost_snapshots WHERE request_item_id IN (?, ?)', [r.a, r.b]);
    assert.equal(Number(booked[0].n), 0, 'no sale is booked for either line');

    // Rejecting the other line too: every line rejected means the request is Rejected.
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/items/${r.b}/reject`, { staffName: 'Gudang' })).status, 200);
    detail = await detailOf();
    assert.equal(detail.status, 'Rejected');
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, {})).status, 400, 'nothing left to approve');
  });
});

test('Kasus 3: Approve Semua approves every line in full', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const r = await requestAB(outlet, connection);
    // Quantities sent by an older client are ignored: Approve Semua is always the full request.
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, { staffName: 'Gudang', customQuantities: { [r.a]: 1, [r.b]: 0 } })).status, 200);
    const detail = (await warehouse.call('GET', `/api/requests/${r.id}`)).body.request;
    assert.deepEqual(lineState(detail, r.a), ['Approved', 3]);
    assert.deepEqual(lineState(detail, r.b), ['Approved', 3]);
    assert.equal(detail.status, 'Approved');
    assert.deepEqual(await stockOf(connection), [97, 97]);
    // HPP is captured at approval time by this route as well.
    const [cost]: any = await connection.query('SELECT request_item_id, unit_cost, approved_quantity FROM inventory_cost_snapshots WHERE request_item_id IN (?, ?) ORDER BY request_item_id', [r.a, r.b]);
    assert.deepEqual(cost.map((row: any) => [Number(row.unit_cost), Number(row.approved_quantity)]), [[20000, 3], [9000, 3]]);

    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, {})).status, 400, 'a finished request cannot be approved again');
    assert.equal((await warehouse.call('POST', '/api/requests/999999/approve-all', {})).status, 400);
  });
});

test('Approve Semua after a per-line decision never overwrites that decision', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    // A approved for 2 of 3, then Approve Semua: A keeps 2, B gets its full 3.
    const partly = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${partly.id}/items/${partly.a}/approve`, { approvedQuantity: 2 });
    assert.equal((await warehouse.call('POST', `/api/requests/${partly.id}/approve-all`, {})).status, 200);
    let detail = (await warehouse.call('GET', `/api/requests/${partly.id}`)).body.request;
    assert.deepEqual([lineState(detail, partly.a), lineState(detail, partly.b)], [['Approved', 2], ['Approved', 3]]);
    assert.equal(detail.status, 'Partially Approved');
    const [aSales]: any = await connection.query('SELECT COUNT(*) AS n FROM inventory_cost_snapshots WHERE request_item_id = ?', [partly.a]);
    assert.equal(Number(aSales[0].n), 1, 'A is not sold a second time');

    // A rejected, then Approve Semua: A stays rejected, B is approved.
    const rejected = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${rejected.id}/items/${rejected.a}/reject`, {});
    assert.equal((await warehouse.call('POST', `/api/requests/${rejected.id}/approve-all`, {})).status, 200);
    detail = (await warehouse.call('GET', `/api/requests/${rejected.id}`)).body.request;
    assert.deepEqual([lineState(detail, rejected.a), lineState(detail, rejected.b)], [['Rejected', 0], ['Approved', 3]]);
    assert.equal(detail.status, 'Partially Approved');
    // Stock: 2 + 3 from the first request, 3 from the second.
    assert.deepEqual(await stockOf(connection), [98, 94]);
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

test('closing a period warns about the requests still waiting for approval', async () => {
  await withApi(async ({ outlet, warehouse }) => {
    assert.deepEqual((await warehouse.call('GET', '/api/inventory/stock-opname/pending-requests')).body, { count: 0, requests: [] });

    const undecided = (await twoLineRequest(outlet)).body.request;
    const decided = (await twoLineRequest(outlet)).body.request;
    const settled = await warehouse.call('POST', `/api/requests/${decided.id}/approve-all`, { staffName: 'Gudang' });
    assert.equal(settled.status, 200);

    // Half decided: one line approved, the other still waiting.
    const half = (await twoLineRequest(outlet)).body.request;
    const halfLines = (await warehouse.call('GET', `/api/requests/${half.id}`)).body.request.items;
    assert.equal((await warehouse.call('POST', `/api/requests/${half.id}/items/${halfLines[0].id}/approve`, {})).status, 200);

    const warning = (await warehouse.call('GET', '/api/inventory/stock-opname/pending-requests')).body;
    assert.equal(warning.count, 2); // the undecided request and the half-decided one, not the settled one
    const byCode = (code: string) => warning.requests.find((request: any) => request.requestCode === code);
    assert.equal(byCode(decided.requestCode), undefined);
    assert.equal(byCode(undecided.requestCode).outletName, 'Smoke Outlet');
    assert.deepEqual([byCode(undecided.requestCode).pendingItems, byCode(undecided.requestCode).pendingQuantity], [2, 9]);
    assert.deepEqual([byCode(half.requestCode).pendingItems, byCode(half.requestCode).pendingQuantity], [1, 4], 'only the line still waiting');

    // The same list comes back with the closing itself, read inside its transaction.
    const closed = await warehouse.call('POST', '/api/inventory/stock-opname', {
      examinationDate: todayJakarta(), createdBy: 'Gudang', createdByUserId: 2, submissionKey: 'smoke-closing',
      physicalStocks: [{ itemId: 1, physicalStock: 98 }, { itemId: 2, physicalStock: 96 }],
    });
    assert.equal(closed.status, 201);
    assert.deepEqual(closed.body.opname.pendingRequests, warning);

    // Still pending after the closing, so it falls into the period that just opened.
    assert.equal((await warehouse.call('GET', '/api/inventory/stock-opname/pending-requests')).body.count, 2);
    const periods = (await warehouse.call('GET', '/api/dashboard/finance-periods')).body;
    assert.equal(periods.status ?? 200, 200);
  });
});

test('Google sign-in: hidden until configured, state is enforced, and every outcome lands on /login', async () => {
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, redirect: process.env.GOOGLE_REDIRECT_URI };
  const raw = (base: string, path: string, cookie?: string) => fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  try {
    await withApi(async ({ anonymous, warehouse, base }) => {
      delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REDIRECT_URI;
      assert.deepEqual((await anonymous.call('GET', '/api/auth/providers')).body, { google: false });
      const off = await raw(base, '/api/auth/google');
      assert.equal(off.status, 303);
      assert.equal(off.headers.get('location'), '/login?oauth_error=unconfigured');

      process.env.GOOGLE_CLIENT_ID = 'smoke-client';
      process.env.GOOGLE_CLIENT_SECRET = 'smoke-secret';
      process.env.GOOGLE_REDIRECT_URI = `${base}/api/auth/google/callback`;
      assert.deepEqual((await anonymous.call('GET', '/api/auth/providers')).body, { google: true });

      const start = await raw(base, '/api/auth/google');
      assert.equal(start.status, 302);
      const google = new URL(start.headers.get('location')!);
      assert.equal(google.origin, 'https://accounts.google.com');
      const stateCookie = start.headers.getSetCookie().find((header) => header.startsWith('hd_google_oauth='))!;
      assert.match(stateCookie, /HttpOnly/);
      assert.match(stateCookie, /SameSite=Lax/);
      assert.match(stateCookie, /Path=\/api\/auth\/google/);
      const cookie = stateCookie.split(';')[0];
      const state = google.searchParams.get('state');

      const landing = async (path: string, withCookie = true) => {
        const reply = await raw(base, path, withCookie ? cookie : undefined);
        assert.equal(reply.status, 303, path);
        assert.ok(!reply.headers.getSetCookie().some((header) => header.startsWith('hd_operational_session=') && !/Max-Age=0/.test(header)), `${path} must not open a session`);
        return reply.headers.get('location');
      };
      // A forged or replayed callback: the state does not match the cookie.
      assert.equal(await landing('/api/auth/google/callback?code=x&state=forged'), '/login?oauth_error=state');
      // No cookie at all, as when the callback is opened in another browser.
      assert.equal(await landing(`/api/auth/google/callback?code=x&state=${state}`, false), '/login?oauth_error=state');
      // The user pressed cancel on Google's screen.
      assert.equal(await landing('/api/auth/google/callback?error=access_denied'), '/login?oauth_error=cancelled');

      // The page asks who it is after a redirect; only a real session answers.
      assert.equal((await anonymous.call('GET', '/api/auth/session')).status, 401);
      const me = await warehouse.call('GET', '/api/auth/session');
      assert.equal(me.status, 200);
      assert.equal(me.body.user.email, 'warehouse@smoke.test');
      assert.equal(me.body.user.password, undefined);
    });
  } finally {
    for (const [key, value] of [['GOOGLE_CLIENT_ID', saved.id], ['GOOGLE_CLIENT_SECRET', saved.secret], ['GOOGLE_REDIRECT_URI', saved.redirect]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

// ---- Cancelling an approved request -------------------------------------
const cancel = (who: ReturnType<typeof client>, requestId: number, reason?: string) =>
  who.call('POST', `/api/requests/${requestId}/cancel`, reason === undefined ? {} : { reason });
const returnMovements = async (connection: any, requestCode: string) => {
  const [rows]: any = await connection.query("SELECT item_id, quantity, stock_before, stock_after, notes, created_by, created_by_user_id FROM stock_movements WHERE movement_type = 'CANCEL_RETURN' AND reference_id = ? ORDER BY item_id", [requestCode]);
  return rows;
};
// The ledger and the warehouse must move together. The smoke seed records a
// purchase with no matching IN movement, so the open period already ends 100
// above the real stock before any request; what matters is that approving and
// cancelling never change that gap, and that a cancelled sale is not sold.
const ledgerGap = async (connection: any) => {
  const { loadLedger, ledgerRows } = await import('../src/db/periodClosing.ts');
  const open = ledgerRows(await loadLedger(), null);
  const [stock]: any = await connection.query('SELECT id, current_stock FROM items WHERE id IN (1, 2) ORDER BY id');
  return stock.map((row: any) => ({ gap: Number(open.get(row.id)?.closingStock) - Number(row.current_stock), sold: open.get(row.id)?.soldQuantity }));
};

test('Batal 1: a fully approved request returns every approved unit and becomes Cancelled', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const before = await ledgerGap(connection);
    const r = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, {});
    assert.deepEqual(await stockOf(connection), [97, 97]);
    assert.deepEqual((await ledgerGap(connection)).map((row: any) => row.sold), [3, 3]);
    const code = (await warehouse.call('GET', `/api/requests/${r.id}`)).body.request.requestCode;

    const result = await cancel(outlet, r.id, '  Tidak jadi dipakai  ');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'Cancelled');
    assert.deepEqual(await stockOf(connection), [100, 100]);

    const detail = (await outlet.call('GET', `/api/requests/${r.id}`)).body.request;
    assert.equal(detail.status, 'Cancelled');
    // Approved lines become Cancelled and keep the quantity that was returned.
    assert.deepEqual([lineState(detail, r.a), lineState(detail, r.b)], [['Cancelled', 3], ['Cancelled', 3]]);
    assert.equal(detail.cancellation.cancelledByName, 'Outlet Smoke');
    assert.equal(detail.cancellation.cancelledByRole, 'OUTLET');
    assert.equal(detail.cancellation.reason, 'Tidak jadi dipakai');
    assert.equal(detail.cancellation.returnedQuantity, 6);
    assert.ok(!Number.isNaN(Date.parse(detail.cancellation.cancelledAt)));

    const moves = await returnMovements(connection, code);
    assert.deepEqual(moves.map((m: any) => [m.item_id, m.quantity, m.stock_before, m.stock_after]), [[1, 3, 97, 100], [2, 3, 97, 100]]);
    assert.equal(moves[0].created_by, 'Outlet Smoke');
    assert.equal(moves[0].created_by_user_id, 1);
    assert.match(moves[0].notes, /Tidak jadi dipakai/);

    // Not a sale any more: nothing sold, and the ledger moved with the stock.
    assert.deepEqual(await ledgerGap(connection), before);
  });
});

test('Batal 2: a partly approved request returns only what was approved; the rejected line returns nothing', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const before = await ledgerGap(connection);
    const r = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${r.id}/items/${r.a}/approve`, { approvedQuantity: 2 });
    await warehouse.call('POST', `/api/requests/${r.id}/items/${r.b}/reject`, {});
    assert.equal((await warehouse.call('GET', `/api/requests/${r.id}`)).body.request.status, 'Partially Approved');
    assert.deepEqual(await stockOf(connection), [98, 100]);

    // The warehouse may cancel on the outlet's behalf.
    const result = await cancel(warehouse, r.id);
    assert.equal(result.status, 200);
    assert.deepEqual(await stockOf(connection), [100, 100], 'A gets its 2 back (not the 3 requested); B was never cut');
    const detail = (await warehouse.call('GET', `/api/requests/${r.id}`)).body.request;
    assert.equal(detail.status, 'Cancelled');
    assert.deepEqual([lineState(detail, r.a), lineState(detail, r.b)], [['Cancelled', 2], ['Rejected', 0]]);
    assert.equal(detail.cancellation.cancelledByRole, 'WAREHOUSE');
    assert.equal(detail.cancellation.reason, null);
    const moves = await returnMovements(connection, detail.requestCode);
    assert.deepEqual(moves.map((m: any) => [m.item_id, m.quantity]), [[1, 2]]);
    assert.deepEqual(await ledgerGap(connection), before);
  });
});

test('Batal 3: a request cannot be cancelled twice, so stock never comes back twice', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const r = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, {});
    assert.equal((await cancel(outlet, r.id)).status, 200);
    const again = await cancel(outlet, r.id);
    assert.equal(again.status, 409);
    assert.match(again.body.error, /sudah dibatalkan/);
    assert.equal((await cancel(warehouse, r.id)).status, 409);
    assert.deepEqual(await stockOf(connection), [100, 100]);
    assert.equal((await returnMovements(connection, (await outlet.call('GET', `/api/requests/${r.id}`)).body.request.requestCode)).length, 2);
    // Simultaneous cancellations are serialised by the FOR UPDATE lock on the
    // request row. This harness runs every query on one connection, so it
    // cannot reproduce true concurrency; the sequential repeat above is the
    // same check the second transaction makes once the first commits.
    // A cancelled request cannot be decided again either.
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, {})).status, 400);
  });
});

test('Batal 4: rejected and pending requests cannot be cancelled', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const rejected = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${rejected.id}/items/${rejected.a}/reject`, {});
    await warehouse.call('POST', `/api/requests/${rejected.id}/items/${rejected.b}/reject`, {});
    const refused = await cancel(outlet, rejected.id);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /ditolak/);

    const pending = await requestAB(outlet, connection);
    const notYet = await cancel(outlet, pending.id);
    assert.equal(notYet.status, 409);
    assert.match(notYet.body.error, /menunggu persetujuan/);
    assert.equal((await outlet.call('GET', `/api/requests/${pending.id}`)).body.request.status, 'Pending');
    assert.deepEqual(await stockOf(connection), [100, 100]);
  });
});

test('Batal: only the owning outlet or the warehouse may cancel', async () => {
  await withApi(async ({ outlet, warehouse, anonymous, connection, base }) => {
    await connection.query("INSERT INTO users (id, name, username, email, password, role, outlet_id, is_active) VALUES (3, 'Outlet Lain', 'other-outlet', 'other@smoke.test', 'other-pass', 'OUTLET', 1, 1)");
    const other = client(base);
    assert.equal((await other.call('POST', '/api/auth/login', { email: 'other@smoke.test', password: 'other-pass' })).status, 200);
    const r = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, {});

    assert.equal((await cancel(anonymous, r.id)).status, 401);
    assert.equal((await cancel(other, r.id)).status, 403, 'another outlet');
    assert.equal((await cancel(outlet, 999999)).status, 404);
    assert.deepEqual(await stockOf(connection), [97, 97], 'refusals change nothing');
    assert.equal((await cancel(outlet, r.id)).status, 200);
  });
});

test('Batal: a sale inside a closed period is not undone', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const r = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${r.id}/approve-all`, {});
    const closed = await warehouse.call('POST', '/api/inventory/stock-opname', {
      examinationDate: todayJakarta(), createdBy: 'Gudang', createdByUserId: 2, submissionKey: 'cancel-closing',
      physicalStocks: [{ itemId: 1, physicalStock: 97 }, { itemId: 2, physicalStock: 97 }],
    });
    assert.equal(closed.status, 201);
    const refused = await cancel(outlet, r.id);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /sudah ditutup\. Gunakan form koreksi\./);
    assert.equal((await outlet.call('GET', `/api/requests/${r.id}`)).body.request.status, 'Approved');
    assert.deepEqual(await stockOf(connection), [97, 97], 'the whole cancellation rolled back');
    const [rows]: any = await connection.query('SELECT COUNT(*) AS n FROM request_cancellations');
    assert.equal(Number(rows[0].n), 0);
  });
});

// ---- Stock value on the current-stock page -------------------------------
test('Nilai stok: a second purchase moves the average; approving and cancelling move only the stock', async () => {
  await withApi(async ({ outlet, warehouse, connection }) => {
    const row = async (itemId: number) => (await warehouse.call('GET', '/api/dashboard/warehouse-ops-stats')).body.items.find((item: any) => item.id === itemId);
    // The shared seed records its purchase without the IN movement a real
    // receipt writes, so the ledger would count those 100 pcs twice when a new
    // receipt reprices the period. Give it the movement a real receipt has.
    await connection.query("INSERT INTO stock_movements (item_id, movement_type, quantity, reference_id, created_by) VALUES (1, 'IN', 100, 'IN-SEED', 'seed')");

    // Seeded: 100 pcs bought at Rp20.000.
    let a = await row(1);
    assert.deepEqual([a.currentStock, a.avgCost, a.stockValue], [100, 20000, 2000000]);

    // Second purchase: 50 at Rp30.000 → (100 × 20.000 + 50 × 30.000) ÷ 150.
    const bought = await warehouse.call('POST', '/api/inventory/incoming', {
      vendorCode: 'VND-SMOKE', vendorName: 'Vendor Smoke', paymentMethod: 'Transfer', transactionDate: todayJakarta(),
      items: [{ itemId: 1, itemName: 'Ayam Mentah (kg)', quantity: 50, price: 30000 }],
    });
    assert.equal(bought.status, 200);
    a = await row(1);
    assert.deepEqual([a.currentStock, a.avgCost, a.stockValue], [150, 23333.333333, 3500000]);

    // Approving 3 takes stock out at the average; the average itself stays.
    const r = await requestAB(outlet, connection);
    await warehouse.call('POST', `/api/requests/${r.id}/items/${r.a}/approve`, {});
    a = await row(1);
    assert.deepEqual([a.currentStock, a.avgCost, a.stockValue], [147, 23333.333333, 3430000]);

    // Cancelling brings the 3 back: value returns, average unchanged.
    await warehouse.call('POST', `/api/requests/${r.id}/items/${r.b}/reject`, {});
    assert.equal((await warehouse.call('POST', `/api/requests/${r.id}/cancel`, {})).status, 200);
    a = await row(1);
    assert.deepEqual([a.currentStock, a.avgCost, a.stockValue], [150, 23333.333333, 3500000]);
  });
});

test('Nilai stok: an item never bought has no price, and an empty one is worth Rp0', async () => {
  await withApi(async ({ warehouse, connection }) => {
    const items = (await warehouse.call('GET', '/api/dashboard/warehouse-ops-stats')).body.items;
    // The filler items in the seed have no purchase at all.
    const unbought = items.filter((item: any) => item.id > 2);
    assert.ok(unbought.length > 0);
    for (const item of unbought) assert.deepEqual([item.avgCost, item.stockValue], [null, null], item.itemCode);

    // An item that was bought but is now empty: Rp0, with its average still there.
    await connection.query('UPDATE items SET current_stock = 0 WHERE id = 2');
    const empty = (await warehouse.call('GET', '/api/dashboard/warehouse-ops-stats')).body.items.find((item: any) => item.id === 2);
    assert.deepEqual([empty.currentStock, empty.avgCost, empty.stockValue], [0, 9000, 0]);
  });
});

test('Total Nilai Stok: the date range never changes stock values, only the purchase list', async () => {
  await withApi(async ({ warehouse }) => {
    const all = (await warehouse.call('GET', '/api/dashboard/warehouse-ops-stats')).body;
    const ranged = (await warehouse.call('GET', '/api/dashboard/warehouse-ops-stats?startDate=2020-01-01&endDate=2020-01-31')).body;
    const values = (body: any) => body.items.map((item: any) => [item.id, item.currentStock, item.avgCost, item.stockValue]);
    assert.deepEqual(values(ranged), values(all), 'stock position is the same whatever period is picked');
    assert.equal(ranged.purchases.length, 0, 'while the purchases in that empty period do follow the dates');
    assert.ok(all.purchases.length > 0);
  });
});
