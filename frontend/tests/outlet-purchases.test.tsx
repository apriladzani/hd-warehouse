import test from 'node:test';
import assert from 'node:assert/strict';
import { itemOutletMatrix, purchaseRecap } from '../src/lib/outletPurchases.ts';

const line = (itemId: number, itemName: string, status: string, approvedQuantity: number, price: number) => ({ itemId, itemName, status, approvedQuantity, price });
const requests = [
  { id: 1, outletId: 10, outletName: 'Bantar Malam', items: [line(1, 'Ayam Mentah', 'Approved', 5, 40000), line(2, 'Tepung', 'Approved', 2, 18000)] },
  { id: 2, outletId: 20, outletName: 'Cibubur', items: [line(1, 'Ayam Mentah', 'Approved', 3, 40000), line(2, 'Tepung', 'Rejected', 0, 18000)] },
  { id: 3, outletId: 10, outletName: 'Bantar Malam', items: [line(1, 'Ayam Mentah', 'Pending', 0, 40000)] },
  { id: 4, outletId: 20, outletName: 'Cibubur', items: [line(2, 'Tepung', 'Cancelled', 4, 18000)] },
];

test('total purchases count approved lines only: approved qty × price', () => {
  const recap = purchaseRecap(requests);
  assert.equal(recap.amount, 5 * 40000 + 2 * 18000 + 3 * 40000);
  assert.equal(recap.quantity, 10);
  assert.equal(recap.requests, 2, 'pending-only and cancelled requests bought nothing');
});

test('per outlet: amount, units and requests of each outlet, largest first', () => {
  assert.deepEqual(purchaseRecap(requests).byOutlet.map((o) => [o.name, o.requests, o.quantity, o.amount]), [
    ['Bantar Malam', 1, 7, 236000],
    ['Cibubur', 1, 3, 120000],
  ]);
});

test('per item: totals across outlets, and each item per outlet without opening a request', () => {
  assert.deepEqual(purchaseRecap(requests).byItem.map((i) => [i.name, i.quantity, i.amount]), [
    ['Ayam Mentah', 8, 320000],
    ['Tepung', 2, 36000],
  ]);
  const matrix = itemOutletMatrix(requests);
  assert.deepEqual(matrix.get('1')?.get('10'), { quantity: 5, amount: 200000 });
  assert.deepEqual(matrix.get('1')?.get('20'), { quantity: 3, amount: 120000 });
  assert.equal(matrix.get('2')?.get('20'), undefined, 'rejected and cancelled lines are not purchases');
});

test('no purchases: zero, empty lists', () => {
  assert.deepEqual(purchaseRecap([]), { amount: 0, quantity: 0, requests: 0, byOutlet: [], byItem: [] });
});
