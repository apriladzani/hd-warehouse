import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CANCEL_CONFIRM_TEXT, canCancelRequest, cancellationSummary, stockToReturn } from '../src/lib/requestCancel.ts';
import { CancelRequestDialog } from '../src/components/modals/CancelRequestDialog.tsx';

test('Batalkan is offered only for approved and partly approved requests', () => {
  assert.equal(canCancelRequest('Approved'), true);
  assert.equal(canCancelRequest('Partially Approved'), true);
  for (const status of ['Pending', 'Rejected', 'Cancelled', '', null, undefined]) assert.equal(canCancelRequest(status as any), false, String(status));
});

test('only approved lines give stock back, by their approved quantity', () => {
  const lines = [
    { itemName: 'Barang A', status: 'Approved', approvedQuantity: 2 },
    { itemName: 'Barang B', status: 'Rejected', approvedQuantity: 0 },
    { itemName: 'Barang C', status: 'Pending', approvedQuantity: 0 },
  ];
  assert.deepEqual(stockToReturn(lines), [{ itemName: 'Barang A', quantity: 2 }]);
  assert.deepEqual(stockToReturn(undefined), []);
});

test('the dialog asks first, lists what comes back, takes an optional reason, and names its buttons plainly', () => {
  const html = renderToStaticMarkup(<CancelRequestDialog
    request={{ id: 5, requestCode: 'REQ-0005', items: [{ itemName: 'Barang A', status: 'Approved', approvedQuantity: 2 }, { itemName: 'Barang B', status: 'Rejected', approvedQuantity: 0 }] }}
    onClose={() => {}} onCancelled={() => {}} />);
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /Batalkan REQ-0005\?/);
  assert.ok(html.includes(CANCEL_CONFIRM_TEXT));
  assert.match(html, /Barang A/);
  assert.match(html, /\+2 pcs/);
  assert.doesNotMatch(html, /Barang B/, 'a rejected line returns nothing, so it is not listed');
  assert.match(html, /Alasan pembatalan/);
  assert.match(html, /\(opsional\)/);
  assert.match(html, /maxLength="500"/);
  assert.match(html, />Kembali</);
  assert.match(html, />Ya, Batalkan Request</);
  assert.doesNotMatch(html, />Batal</, 'no ambiguous "Batal" button');
});

test('a cancellation is summarised with who, when and how much came back', () => {
  const text = cancellationSummary({ cancelledByName: 'Gudang Smoke', cancelledByRole: 'WAREHOUSE', reason: null, returnedQuantity: 6, cancelledAt: '2026-11-11T03:15:00.000Z' });
  assert.match(text, /Gudang Smoke \(Warehouse\)/);
  assert.match(text, /6 pcs dikembalikan/);
  assert.match(text, /10\.15/, 'shown in Jakarta time');
});
