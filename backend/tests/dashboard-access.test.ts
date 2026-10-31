import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAccessDashboard, canReadFinanceDashboard } from '../src/dashboardAccess.ts';

test('dashboard access is exclusive to the assigned role', () => {
  assert.equal(canAccessDashboard('WAREHOUSE', 'WAREHOUSE'), true);
  assert.equal(canAccessDashboard('FINANCE', 'FINANCE'), true);
  assert.equal(canAccessDashboard('OUTLET', 'WAREHOUSE'), false);
  assert.equal(canAccessDashboard('OUTLET', 'FINANCE'), false);
  assert.equal(canAccessDashboard('WAREHOUSE', 'FINANCE'), false);
  assert.equal(canAccessDashboard('FINANCE', 'WAREHOUSE'), false);
  assert.equal(canAccessDashboard(undefined, 'FINANCE'), false);
});

test('Finance dashboard read access is shared with Warehouse but not Outlet', () => {
  assert.equal(canReadFinanceDashboard('WAREHOUSE'), true);
  assert.equal(canReadFinanceDashboard('FINANCE'), true);
  assert.equal(canReadFinanceDashboard('OUTLET'), false);
  assert.equal(canReadFinanceDashboard(undefined), false);
});

test('dashboard session middleware distinguishes expired session, role denial and Finance gate', async () => {
  const { dashboardSessionAccess } = await import('../src/finance/dashboardSessionAccess.ts');
  async function run(principal: any, finance = false, fail = false) {
    let status = 200, body: any, next = false;
    const handler = dashboardSessionAccess(async () => { if (fail) throw new Error('private'); return principal; }, finance);
    await handler({} as any, { setHeader() {}, status(n: number) { status = n; return this; }, json(value: any) { body = value; } } as any, () => { next = true; });
    return { status, body, next };
  }
  assert.equal((await run(null)).status, 401);
  assert.equal((await run({ role: 'WAREHOUSE', warehouseGateVerified: false })).next, true);
  assert.equal((await run({ role: 'FINANCE', warehouseGateVerified: false })).status, 403);
  assert.equal((await run({ role: 'OUTLET', warehouseGateVerified: true }, true)).status, 403);
  assert.equal((await run({ role: 'ADMIN', warehouseGateVerified: true }, true)).status, 403);
  assert.equal((await run({ role: 'WAREHOUSE', warehouseGateVerified: false }, true)).body.code, 'FINANCE_ACCESS_REQUIRED');
  assert.equal((await run({ role: 'WAREHOUSE', warehouseGateVerified: true }, true)).next, true);
  assert.equal((await run({ role: 'FINANCE', warehouseGateVerified: false }, true)).next, true);
  assert.equal((await run(null, true, true)).status, 503);
});

test('Admin endpoints use server session and reject missing, non-admin and unavailable identities', async () => {
  const { createAdminSessionAccess } = await import('../src/finance/adminSessionAccess.ts');
  for (const role of ['ADMIN', 'WAREHOUSE', 'FINANCE', 'OUTLET', null, 'FAIL']) {
    let status = 200, body: any;
    const check = createAdminSessionAccess(async () => { if (role === 'FAIL') throw new Error('private'); return role ? { id: 7, role } : null; });
    const result = await check({ header: () => 'spoofed-admin' } as any, { setHeader() {}, status(n: number) { status = n; return this; }, json(value: any) { body = value; } } as any);
    assert.equal(status, role === 'ADMIN' ? 200 : role === null ? 401 : role === 'FAIL' ? 503 : 403);
    assert.equal(result?.role ?? null, role === 'ADMIN' ? 'ADMIN' : null);
    assert.ok(!JSON.stringify(body ?? {}).includes('private'));
  }
});
