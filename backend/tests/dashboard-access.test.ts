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
