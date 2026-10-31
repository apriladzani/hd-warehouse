import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceScope, isDenied, outletView, parseOutletIds, resolveOutletScope, type FinanceViewer } from '../src/finance/outletScope.ts';
import { outletFromRequesterName } from '../src/finance/requestOutlet.ts';
import { buildLedger, forOutlets, outletTotalsMismatch, rollPeriod, type LedgerEvent } from '../src/finance/periodLedger.ts';

const BANTAR_MALAM = 10, CISALAK = 1, ABOH = 5;
const viewer = (role: string, outletId: number | null = null, warehouseGateVerified = true): FinanceViewer => ({ id: 1, role, outletId, warehouseGateVerified });
const sale = (at: number, quantity: number, outletId: number, unitCost = '1000.000000'): LedgerEvent => ({ at, order: at, kind: 'sale', quantity, outletId, sellPrice: '1500', unitCost });

test('outlet filter query: list, empty, invalid', () => {
  assert.deepEqual(parseOutletIds('7,1,4,1'), [1, 4, 7]);
  assert.equal(parseOutletIds(undefined), undefined);
  assert.equal(parseOutletIds(''), undefined);
  assert.equal(parseOutletIds('1,x'), null);
  assert.equal(parseOutletIds('-2'), null);
});

test('f. Finance, Admin and verified Warehouse see every outlet; Outlet account is locked to its own', () => {
  for (const role of ['FINANCE', 'ADMIN', 'WAREHOUSE']) {
    const scope = resolveOutletScope(viewer(role), [CISALAK, ABOH], false);
    assert.ok(!isDenied(scope)); assert.deepEqual(scope.outletIds, [CISALAK, ABOH]); assert.equal(scope.showCost, true);
  }
  const own = resolveOutletScope(viewer('OUTLET', BANTAR_MALAM), undefined, false);
  assert.ok(!isDenied(own)); assert.deepEqual(own.outletIds, [BANTAR_MALAM]); assert.equal(own.lockedOutletId, BANTAR_MALAM); assert.equal(own.showCost, false);
  assert.deepEqual(resolveOutletScope(viewer('OUTLET', BANTAR_MALAM), [BANTAR_MALAM], false), own);
  for (const requested of [[CISALAK], [BANTAR_MALAM, CISALAK]]) {
    const denied = resolveOutletScope(viewer('OUTLET', BANTAR_MALAM), requested, false);
    assert.ok(isDenied(denied)); assert.equal(denied.status, 403);
  }
  assert.equal((resolveOutletScope(viewer('OUTLET', null), undefined, false) as any).status, 403);
  assert.equal((resolveOutletScope(null, undefined, false) as any).status, 401);
  assert.equal((resolveOutletScope(viewer('WAREHOUSE', null, false), undefined, false) as any).code, 'FINANCE_ACCESS_REQUIRED');
  assert.equal((resolveOutletScope(viewer('FINANCE'), null, false) as any).status, 400);
  const allowed = resolveOutletScope(viewer('OUTLET', BANTAR_MALAM), undefined, true);
  assert.ok(!isDenied(allowed) && allowed.showCost);
});

test('Outlet accounts receive sales only: no HPP, profit, averages, purchases or warehouse stock', () => {
  const stats = { financePeriods: [], itemProfitability: [{ itemId: 1, itemName: 'Ayam', quantity: 5, totalSellingAmountExact: '7500.000000', totalCogsAmountExact: '5000.000000', totalProfitExact: '2500.000000', periodAverage: '1000.000000', openingStock: 9, totalPurchaseAmount: 99, outletBreakdown: [{ outletId: 10, soldQuantity: 5, sales: '7500.000000', cogs: '5000.000000', profit: '2500.000000' }] }], manualEntries: [{ amount: 1 }], categoryPurchaseTotals: [{}], totalCogsAmount: 5000 };
  const scope = resolveOutletScope(viewer('OUTLET', BANTAR_MALAM), undefined, false);
  assert.ok(!isDenied(scope));
  const view = JSON.stringify(outletView(stats, scope));
  for (const hidden of ['totalCogsAmount', 'totalProfit', 'periodAverage', 'openingStock', 'totalPurchaseAmount', 'manualEntries', 'categoryPurchaseTotals', '"cogs"', '"profit"']) assert.ok(!view.includes(hidden), hidden);
  assert.ok(view.includes('7500.000000'));
  const withCost = JSON.stringify(outletView(stats, { ...scope, showCost: true }));
  assert.ok(withCost.includes('totalCogsAmountExact') && withCost.includes('totalProfitExact') && !withCost.includes('periodAverage'));
});

test('backfill resolves the outlet from what the request recorded', () => {
  const master = [{ id: 10, name: 'Bantar Malam', code: 'bantar-malam' }, { id: 13, name: 'Central Kitchen (CK)', code: 'central-kitchen-ck' }, { id: 14, name: 'Central', code: 'central' }];
  assert.equal(outletFromRequesterName('Bantar Malam (user1)', master)?.id, 10);
  assert.equal(outletFromRequesterName('central kitchen (ck) (Budi)', master)?.id, 13);
  assert.equal(outletFromRequesterName('bantar-malam', master)?.id, 10);
  assert.equal(outletFromRequesterName('Budi', master), null);
});

test('c/d. one, several and all outlets add up; all outlets equal the unfiltered total (open and closed)', () => {
  const events = new Map([[1, [sale(1, 3, BANTAR_MALAM), sale(2, 4, CISALAK), sale(3, 5, ABOH), sale(150, 2, BANTAR_MALAM), sale(160, 6, ABOH)]]]);
  const { closed, open } = buildLedger([1], new Map([[1, { stock: 100, average: '1000.000000' }]]), events, [{ end: 100, physical: new Map([[1, 88]]) }]);
  for (const row of [closed[0].get(1)!, open.get(1)!]) {
    assert.equal(outletTotalsMismatch(row), null);
    const ids = row.outlets.map(o => o.outletId);
    const parts = ids.map(id => forOutlets(row, [id]));
    const all = forOutlets(row, ids);
    assert.equal(parts.reduce((n, p) => n + p.soldQuantity, 0), row.soldQuantity);
    assert.equal(all.soldQuantity, row.soldQuantity); assert.equal(all.sales, row.sales); assert.equal(all.cogs, row.cogs); assert.equal(all.profit, row.profit);
  }
  const p1 = closed[0].get(1)!;
  assert.deepEqual([forOutlets(p1, [BANTAR_MALAM]).soldQuantity, forOutlets(p1, [CISALAK, ABOH]).soldQuantity, forOutlets(p1).soldQuantity], [3, 9, 12]);
  assert.equal(forOutlets(p1, [BANTAR_MALAM]).sales, '4500.000000');
  assert.deepEqual([forOutlets(open.get(1)!, [BANTAR_MALAM]).soldQuantity, forOutlets(open.get(1)!, [ABOH]).soldQuantity], [2, 6]);
  assert.equal(forOutlets(p1, [999]).soldQuantity, 0);
});

test('e. closed per-outlet numbers are read from the lock and do not move with later transactions', () => {
  const base = [sale(1, 3, BANTAR_MALAM), sale(2, 4, CISALAK)];
  const opening = new Map([[1, { stock: 100, average: '1000.000000' }]]);
  const first = buildLedger([1], opening, new Map([[1, base]]), [{ end: 100, physical: new Map([[1, 93]]) }]).closed[0];
  const later = [...base, sale(150, 50, BANTAR_MALAM, '9999.000000'), { at: 140, order: 140, kind: 'purchase' as const, quantity: 10, price: '5000' }];
  const { closed } = buildLedger([1], opening, new Map([[1, later]]), [{ end: 100, physical: new Map([[1, 93]]), locked: first }]);
  assert.deepEqual(closed[0].get(1)!.outlets, first.get(1)!.outlets);
  assert.deepEqual(forOutlets(closed[0].get(1)!, [BANTAR_MALAM]), forOutlets(first.get(1)!, [BANTAR_MALAM]));
});

test('closing check catches an outlet breakdown that does not add up', () => {
  const row = rollPeriod({ stock: 10, average: '1000.000000' }, [sale(1, 3, BANTAR_MALAM), sale(2, 2, CISALAK)], null);
  assert.equal(outletTotalsMismatch(row), null);
  assert.match(outletTotalsMismatch({ ...row, outlets: row.outlets.slice(1) })!, /qty terjual/);
  assert.match(outletTotalsMismatch({ ...row, outlets: [{ ...row.outlets[0], sales: '1.000000' }, row.outlets[1]] })!, /penjualan/);
  const missingCost = rollPeriod({ stock: 10, average: null }, [sale(1, 3, BANTAR_MALAM, null as any)], null);
  assert.equal(outletTotalsMismatch(missingCost), null);
});

test('f. API guard answers 403 when an Outlet account asks for another outlet', async () => {
  const users: Record<string, { id: number; role: string; outletId: number | null }> = {
    bantar: { id: 5, role: 'OUTLET', outletId: BANTAR_MALAM }, finance: { id: 7, role: 'FINANCE', outletId: null }, admin: { id: 8, role: 'ADMIN', outletId: null },
  };
  const guard = createFinanceScope({
    identity: async (req: any) => users[req.user] ?? null,
    authenticate: async () => ({ warehouseGateVerified: false }),
    outletOf: async (id) => Object.values(users).find(u => u.id === id)?.outletId ?? null,
    outletCanViewCost: async () => false,
  });
  async function call(user: string | null, query: Record<string, string> = {}) {
    let status = 200, body: any;
    const scope = await guard({ user, query } as any, { setHeader() {}, status(n: number) { status = n; return this; }, json(v: any) { body = v; } } as any);
    return { status, body, scope };
  }
  assert.equal((await call('bantar', { outletIds: String(CISALAK) })).status, 403);
  assert.equal((await call('bantar', { outlet: `${BANTAR_MALAM},${CISALAK}` })).status, 403);
  assert.deepEqual((await call('bantar', { outletIds: String(BANTAR_MALAM) })).scope?.outletIds, [BANTAR_MALAM]);
  assert.deepEqual((await call('bantar')).scope?.outletIds, [BANTAR_MALAM]);
  assert.equal((await call('bantar')).scope?.showCost, false);
  assert.deepEqual((await call('finance', { outletIds: '1,4,7' })).scope?.outletIds, [1, 4, 7]);
  assert.equal((await call('admin')).scope?.outletIds, undefined);
  assert.equal((await call(null)).status, 401);
  assert.equal((await call('finance', { outletIds: 'abc' })).status, 400);
});
