import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NEXT_PERIOD_NOTE, PendingRequestsWarning, pendingRequestsMessage, type PendingRequestsAtClosing } from '../src/components/warehouse/PendingRequestsWarning.tsx';

const request = (id: number, requestCode: string, outletName: string | null, pendingItems = 2, pendingQuantity = 9) =>
  ({ id, requestCode, requesterName: `${outletName ?? 'Outlet'} (user)`, outletName, requestDate: '2026-10-31', pendingItems, pendingQuantity });
const pending: PendingRequestsAtClosing = { count: 2, requests: [request(1, 'REQ-010', 'Bantar Malam'), request(2, 'REQ-011', 'Cisalak', 1, 4)] };

test('the closing warning lists every undecided request and says where they will land', () => {
  const html = renderToStaticMarkup(<PendingRequestsWarning pending={pending} />);
  assert.ok(html.includes('2 request belum di-approve'));
  assert.ok(html.includes(NEXT_PERIOD_NOTE));
  assert.ok(html.includes('periode berikutnya'));
  for (const value of ['REQ-010', 'Bantar Malam', 'REQ-011', 'Cisalak', '2 barang', '1 barang', '31 Okt 2026']) assert.ok(html.includes(value), value);
});

test('nothing is shown when every request has been decided', () => {
  assert.equal(renderToStaticMarkup(<PendingRequestsWarning pending={{ count: 0, requests: [] }} />), '');
  assert.equal(renderToStaticMarkup(<PendingRequestsWarning pending={null} />), '');
});

test('a request without an outlet falls back to the requester name', () => {
  const html = renderToStaticMarkup(<PendingRequestsWarning pending={{ count: 1, requests: [request(3, 'REQ-012', null)] }} />);
  assert.ok(html.includes('Outlet (user)'));
});

test('the confirmation message repeats the count, the codes and the consequence', () => {
  const message = pendingRequestsMessage(pending);
  assert.ok(message.startsWith('Peringatan: 2 request belum di-approve.'));
  assert.ok(message.includes('• REQ-010 — Bantar Malam (2 barang)'));
  assert.ok(message.includes('• REQ-011 — Cisalak (1 barang)'));
  assert.ok(message.endsWith(NEXT_PERIOD_NOTE));
  assert.equal(pendingRequestsMessage({ count: 0, requests: [] }), '');
  assert.equal(pendingRequestsMessage(null), '');
});

test('a long list is cut off so the dialog stays readable', () => {
  const many = Array.from({ length: 14 }, (_, index) => request(index + 1, `REQ-${index + 1}`, 'Outlet'));
  const message = pendingRequestsMessage({ count: many.length, requests: many });
  assert.equal(message.split('\n').filter((line) => line.startsWith('• ')).length, 11); // 10 listed plus the summary line
  assert.ok(message.includes('• … dan 4 request lainnya'));
});
