import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTO_REJECT_NOTE, ApproveSubsetConfirm, linesAutoRejected, type DecidableItem } from '../src/components/modals/ApproveSubsetConfirm.tsx';

const item = (id: number, itemName: string, status = 'Pending', requestedQuantity = 5): DecidableItem => ({ id, itemName, requestedQuantity, status });
const items = [item(1, 'Ayam Mentah (kg)'), item(2, 'Box Nasi (pack/10)', 'Pending', 8), item(3, 'Sedotan (pcs)', 'Approved'), item(4, 'Plastic 24 (pack/100)', 'Rejected')];

test('only the still-undecided other lines would be auto-rejected', () => {
  assert.deepEqual(linesAutoRejected(items, 1).map((line) => line.id), [2]);
  assert.deepEqual(linesAutoRejected(items, 2).map((line) => line.id), [1]);
  // Nothing left to lose: a single pending line needs no confirmation.
  assert.deepEqual(linesAutoRejected([item(1, 'Ayam Mentah (kg)'), item(3, 'Sedotan (pcs)', 'Approved')], 1), []);
  assert.deepEqual(linesAutoRejected([], 1), []);
});

test('the dialog names what is approved, what is lost, and offers the three choices', () => {
  const html = renderToStaticMarkup(<ApproveSubsetConfirm
    item={items[0]} autoRejected={linesAutoRejected(items, 1)} approvedQuantity={3}
    onApproveAll={() => {}} onApproveSelected={() => {}} onCancel={() => {}} />);
  assert.ok(html.includes('1 barang lain akan otomatis ditolak'));
  assert.ok(html.includes(AUTO_REJECT_NOTE));
  assert.ok(html.includes('Ayam Mentah (kg)'));
  assert.ok(html.includes('3 dari 5 pcs')); // the reduced quantity, not the requested one
  assert.ok(html.includes('Box Nasi (pack/10)'));
  assert.ok(html.includes('8 pcs'));
  for (const label of ['Setujui semua', 'Setujui yang dipilih saja', 'Batal']) assert.ok(html.includes(`>${label}</button>`), label);
  assert.ok(html.includes('role="alertdialog"'));
});

test('each button is wired to its own action and all are disabled while a call is running', () => {
  const pressed: string[] = [];
  const dialog = <ApproveSubsetConfirm
    item={items[0]} autoRejected={linesAutoRejected(items, 1)} approvedQuantity={5}
    onApproveAll={() => pressed.push('all')} onApproveSelected={() => pressed.push('selected')} onCancel={() => pressed.push('cancel')} />;
  const handlers = (dialog.props as any);
  handlers.onApproveAll(); handlers.onApproveSelected(); handlers.onCancel();
  assert.deepEqual(pressed, ['all', 'selected', 'cancel']);

  const busy = renderToStaticMarkup(<ApproveSubsetConfirm
    item={items[0]} autoRejected={linesAutoRejected(items, 1)} approvedQuantity={5} busy
    onApproveAll={() => {}} onApproveSelected={() => {}} onCancel={() => {}} />);
  assert.equal(busy.match(/disabled=""/g)?.length, 3);
});
