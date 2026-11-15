import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedMessage, canCancelOwnRequest, initialOutletId, outletFieldMode, outletSummary, outletsOfRequests, type OutletProfile } from '../src/lib/outletPlacement.ts';
import { toggleFormOutlet } from '../src/components/admin/AdminWorkspace.tsx';

const profile = (status: OutletProfile['status'], ids: number[], defaultOutletId: number | null = ids[0] ?? null, message: string | null = null): OutletProfile =>
  ({ status, message, defaultOutletId, outlets: ids.map((id) => ({ id, name: `Outlet ${id}`, isDefault: id === defaultOutletId })) });

test('the user list shows outlets as "Bantar Malam, Cibubur +1"', () => {
  const outlets = ['Bantar Malam', 'Cibubur', 'Cisalak'].map((name, index) => ({ id: index + 1, name }));
  assert.equal(outletSummary(outlets), 'Bantar Malam, Cibubur +1');
  assert.equal(outletSummary(outlets.slice(0, 2)), 'Bantar Malam, Cibubur');
  assert.equal(outletSummary(outlets.slice(0, 1)), 'Bantar Malam');
  assert.equal(outletSummary([]), '—');
});

test('HD Request: one outlet is text, several are a choice with the default picked, none blocks ordering', () => {
  assert.equal(outletFieldMode(null), 'loading');
  assert.equal(outletFieldMode(profile('ok', [7])), 'single');
  const three = profile('ok', [3, 1, 2], 3);
  assert.equal(outletFieldMode(three), 'choice');
  assert.equal(initialOutletId(three), 3);
  const none = profile('none', [], null, 'Akun belum ditempatkan di outlet. Hubungi Admin.');
  assert.equal(outletFieldMode(none), 'blocked');
  assert.equal(blockedMessage(none), 'Akun belum ditempatkan di outlet. Hubungi Admin.');
  assert.equal(initialOutletId(none), null);
  const inactive = profile('inactive', [], null, 'Outlet penempatan sedang nonaktif. Hubungi Admin.');
  assert.equal(outletFieldMode(inactive), 'blocked');
  assert.equal(blockedMessage(inactive), 'Outlet penempatan sedang nonaktif. Hubungi Admin.');
});

test('Riwayat: outlet filter options come from the requests, including an outlet no longer held', () => {
  const requests = [{ outletId: 2, outletName: 'Cibubur' }, { outletId: 1, outletName: 'Bantar Malam' }, { outletId: 2, outletName: 'Cibubur' }, { outletId: null }];
  assert.deepEqual(outletsOfRequests(requests), [{ id: 1, name: 'Bantar Malam' }, { id: 2, name: 'Cibubur' }]);
});

test('Batalkan shows only for an approved request of an outlet the account still holds', () => {
  assert.equal(canCancelOwnRequest(true, 2, [1, 2]), true);
  assert.equal(canCancelOwnRequest(true, 3, [1, 2]), false, 'outlet taken away');
  assert.equal(canCancelOwnRequest(false, 2, [1, 2]), false, 'status not cancellable');
  assert.equal(canCancelOwnRequest(true, 3, null), true, 'outlets unknown: leave it to the server');
});

test('admin form: ticking outlets keeps one default; removing the default hands it on', () => {
  let form = { outletIds: [] as number[], defaultOutletId: null as number | null };
  form = toggleFormOutlet(form, 5);
  assert.deepEqual(form, { outletIds: [5], defaultOutletId: 5 }, 'the first outlet becomes default');
  form = toggleFormOutlet(form, 8);
  assert.deepEqual(form, { outletIds: [5, 8], defaultOutletId: 5 });
  form = toggleFormOutlet(form, 5);
  assert.deepEqual(form, { outletIds: [8], defaultOutletId: 8 });
  form = toggleFormOutlet(form, 8);
  assert.deepEqual(form, { outletIds: [], defaultOutletId: null });
});
