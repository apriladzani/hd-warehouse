import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterPurchasesByStatus, incomingTotals, purchaseCancelImpact } from '../src/lib/purchaseCancel.ts';
import { TransactionDocument } from '../src/components/modals/PrintableTransactionA4.tsx';
import { DEFAULT_DELIVERY_ORDER_TEMPLATE } from '../src/lib/printTemplate.ts';
import type { PurchaseTransaction } from '../src/types.ts';

const purchase = (id: number, lines: Array<[number, number, number]>, status: 'active' | 'cancelled' = 'active'): PurchaseTransaction => ({
  id, transactionCode: `IN-${String(id).padStart(3, '0')}`, vendorId: 1, vendorName: 'Vendor', paymentMethod: 'Transfer', transactionDate: '2026-11-10',
  totalAmount: lines.reduce((sum, [, quantity, price]) => sum + quantity * price, 0), createdBy: 'Gudang', status,
  items: lines.map(([itemId, quantity, price], index) => ({ id: id * 10 + index, purchaseId: id, itemId, itemName: itemId === 1 ? 'Ayam Mentah' : 'Tepung', quantity, price, subtotal: quantity * price })),
});

test('Barang Masuk card and Subtotal leave a cancelled purchase out: Rp, Trx and unit all drop', () => {
  const list = [purchase(1, [[1, 100, 20000]]), purchase(9, [[1, 50, 25000]]), purchase(3, [[2, 75, 10000]])];
  assert.deepEqual(incomingTotals(list), { amount: 2_000_000 + 1_250_000 + 750_000, quantity: 225, count: 3 });
  list[1] = { ...list[1], status: 'cancelled' };
  assert.deepEqual(incomingTotals(list), { amount: 2_750_000, quantity: 175, count: 2 }, 'Rp1.250.000, 1 Trx and 50 unit less');
  assert.deepEqual(incomingTotals(list, [1]), { amount: 2_000_000, quantity: 100, count: 2 }, 'item filter still applies');
});

test('the status filter shows all, only active or only cancelled purchases', () => {
  const list = [purchase(1, []), purchase(2, [], 'cancelled'), purchase(3, [])];
  assert.deepEqual(filterPurchasesByStatus(list, 'all').map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(filterPurchasesByStatus(list, 'active').map((p) => p.id), [1, 3]);
  assert.deepEqual(filterPurchasesByStatus(list, 'cancelled').map((p) => p.id), [2]);
});

test('the confirmation shows stock now → after, per item, and flags an item that would go negative', () => {
  const tx = purchase(9, [[1, 50, 25000], [2, 10, 9000], [1, 5, 25000]]);
  const impact = purchaseCancelImpact(tx, new Map([[1, 150], [2, 8]]));
  assert.deepEqual(impact.map(({ itemName, quantity, stockNow, stockAfter, short }) => ({ itemName, quantity, stockNow, stockAfter, short })), [
    { itemName: 'Ayam Mentah', quantity: 55, stockNow: 150, stockAfter: 95, short: false },
    { itemName: 'Tepung', quantity: 10, stockNow: 8, stockAfter: -2, short: true },
  ]);
});

test('a cancelled purchase prints with the DIBATALKAN watermark and its reason; an active one does not', () => {
  const render = (data: any) => renderToStaticMarkup(<TransactionDocument type="incoming" data={data} template={DEFAULT_DELIVERY_ORDER_TEMPLATE} />);
  const cancelled = render({ ...purchase(9, [[1, 50, 25000]], 'cancelled'), cancelReason: 'Salah input qty', cancelledByName: 'Gudang Smoke', cancelledAt: '2026-11-14T03:00:00.000Z' });
  assert.match(cancelled, />DIBATALKAN</);
  assert.match(cancelled, /tidak berlaku sebagai bukti penerimaan/);
  assert.match(cancelled, /Alasan: Salah input qty/);
  assert.match(cancelled, /Dibatalkan oleh Gudang Smoke/);
  const active = render(purchase(9, [[1, 50, 25000]]));
  assert.doesNotMatch(active, /DIBATALKAN/);
});
