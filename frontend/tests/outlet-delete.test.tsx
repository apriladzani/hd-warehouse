import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteOutletPlan } from '../src/components/admin/AdminWorkspace.tsx';

const outlet = (requestCount: number, assignedUsers: number, isActive = true) => ({ name: 'Bantar Malam', requestCount, assignedUsers, isActive });

test('an outlet with requests is offered deactivation, not deletion', () => {
  const plan = deleteOutletPlan(outlet(12, 2));
  assert.equal(plan.kind, 'deactivate');
  assert.equal(plan.confirm, 'Nonaktifkan outlet');
  assert.match(plan.text, /12 request/);
  assert.match(plan.text, /tidak dihapus permanen/);
});

test('an unused outlet with accounts placed in it cannot be deleted yet', () => {
  const plan = deleteOutletPlan(outlet(0, 3));
  assert.equal(plan.kind, 'blocked');
  assert.match(plan.text, /3 akun/);
  assert.match(plan.text, /User Management/);
});

test('an unused, empty outlet is deleted for good, and says so', () => {
  const plan = deleteOutletPlan(outlet(0, 0));
  assert.equal(plan.kind, 'delete');
  assert.match(plan.text, /dihapus permanen/);
});
