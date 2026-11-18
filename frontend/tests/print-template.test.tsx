import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TransactionDocument } from '../src/components/modals/PrintableTransactionA4.tsx';
import { isLogoFileAllowed, moveEntry } from '../src/components/admin/PrintTemplateSettings.tsx';
import { DEFAULT_DELIVERY_ORDER_TEMPLATE, SAMPLE_DELIVERY_ORDER, cloneTemplate, type DeliveryOrderTemplate } from '../src/lib/printTemplate.ts';

const render = (template: DeliveryOrderTemplate, data: any = SAMPLE_DELIVERY_ORDER) =>
  renderToStaticMarkup(<TransactionDocument type="outgoing" data={data} template={template} printTimestamp="14 November 2026 10.00" />)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const edit = (change: (template: DeliveryOrderTemplate) => void) => { const t = cloneTemplate(DEFAULT_DELIVERY_ORDER_TEMPLATE); change(t); return t; };

test('the default template prints the document exactly as it was before', () => {
  const html = render(DEFAULT_DELIVERY_ORDER_TEMPLATE);
  for (const text of ['HD FriedChicken', 'SUPPLY CHAIN', 'DIVISI LOGISTIK & PERGUDANGAN PUSAT (CENTRAL WAREHOUSE)',
    'Kawasan Pergudangan Logistik Mandiri Blok C-12 • Hotline: (021) 555-0192 • Email: warehouse@hdresto.co.id', 'FORM: WMS-A4-OUT',
    'SURAT JALAN & PENGELUARAN BARANG (DELIVERY ORDER)', 'Gudang Utama HD', 'Metode Pembayaran', 'Disetujui Oleh', 'Tanggal Approval',
    'Harga Katalog per Unit', 'Grand Total:', 'Terbilang:', 'Barang telah diverifikasi fisik', 'Diterima Oleh (Pemohon / Outlet)',
    'Staff Gudang HD', 'Kepala Logistik & Gudang']) assert.ok(html.includes(text), text);
});

test('Skenario 1: a changed address is what gets printed', () => {
  const html = render(edit((t) => { t.header.address = 'Jl. Raya Bogor KM 21, Jakarta Timur'; }));
  assert.ok(html.includes('Jl. Raya Bogor KM 21, Jakarta Timur'));
  assert.ok(!html.includes('Blok C-12'));
});

test('Skenario 2: hiding prices removes the price columns, the grand total and Terbilang', () => {
  const html = render(edit((t) => { t.table.showPrices = false; }));
  for (const text of ['Harga Katalog per Unit', 'Subtotal', 'Grand Total', 'Terbilang', 'Rp']) assert.ok(!html.includes(text), text);
  assert.ok(html.includes('35 pcs'), 'quantities stay');
  assert.ok(html.includes('Ayam Mentah (kg)'), 'item names stay');
});

test('Skenario 3: an added note is printed after the existing ones, in order', () => {
  const html = render(edit((t) => { t.notes.push('Barang wajib disimpan di chiller maksimal 2 jam setelah diterima.'); }));
  const positions = [...DEFAULT_DELIVERY_ORDER_TEMPLATE.notes, 'Barang wajib disimpan di chiller'].map((note) => html.indexOf(note.slice(0, 30)));
  assert.ok(positions.every((p) => p > 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('Skenario 4: a renamed signature label is printed and the outlet column keeps the outlet name', () => {
  const html = render(edit((t) => { t.signatures[2].label = 'Disetujui Oleh (Area Manager)'; t.signatures[2].name = 'Budi Santoso'; }));
  assert.ok(html.includes('Disetujui Oleh (Area Manager)'));
  assert.ok(html.includes('( Budi Santoso )'));
  assert.ok(!html.includes('Mengetahui & Verifikasi'));
  assert.ok(html.includes('( Outlet Contoh Sudirman )'));
});

test('one to four signature columns are laid out side by side', () => {
  for (const count of [1, 4]) {
    const html = render(edit((t) => { t.signatures = Array.from({ length: count }, (_, i) => ({ label: `Kolom ${i + 1}`, name: `Nama ${i + 1}`, useOutletName: false })); }));
    assert.ok(html.includes(`repeat(${count}, minmax(0, 1fr))`));
  }
});

test('the info toggles hide only their own row; transaction data always comes from the transaction', () => {
  const html = render(edit((t) => { t.info.showPaymentMethod = false; t.info.showApprovedBy = false; t.info.showApprovalDate = false; t.info.issuedFrom = 'Gudang Cabang Bekasi'; }));
  for (const text of ['Metode Pembayaran', 'Disetujui Oleh', 'Tanggal Approval']) assert.ok(!html.includes(text), text);
  for (const text of ['REQ-CONTOH-0001', 'Outlet Contoh Sudirman', 'Gudang Cabang Bekasi', 'Box Nasi (pack/10)']) assert.ok(html.includes(text), text);
});

test('a logo replaces the brand text; without one the brand name is printed', () => {
  const html = render(edit((t) => { t.header.logoUrl = '/uploads/branding/print-logo-abc.png'; }));
  assert.ok(html.includes('src="/uploads/branding/print-logo-abc.png"'));
  assert.ok(html.includes('alt="HD FriedChicken"'));
});

test('the incoming goods receipt keeps its own wording, whatever the delivery order template says', () => {
  const html = renderToStaticMarkup(<TransactionDocument type="incoming" data={{ transactionCode: 'IN-1', items: [] }} template={edit((t) => { t.title.title = 'JUDUL LAIN'; t.table.showPrices = false; })} />);
  assert.ok(html.includes('GOODS RECEIPT NOTE'));
  assert.ok(!html.includes('JUDUL LAIN'));
  assert.ok(html.includes('Harga Beli per Unit'));
});

test('the preview sheet carries no print id, so only the dialog sheet is ever printed', () => {
  const preview = renderToStaticMarkup(<TransactionDocument preview type="outgoing" data={SAMPLE_DELIVERY_ORDER} template={DEFAULT_DELIVERY_ORDER_TEMPLATE} />);
  assert.ok(!preview.includes('printable-a4-sheet'));
  assert.ok(render(DEFAULT_DELIVERY_ORDER_TEMPLATE).includes('id="printable-a4-sheet"'));
});

test('Skenario 7: print rules keep the document to one sheet without browser header and footer', () => {
  const source = fs.readFileSync(new URL('../src/components/modals/PrintableTransactionA4.tsx', import.meta.url), 'utf8');
  const css = source.slice(source.indexOf('const PRINT_CSS'), source.indexOf('const prepareItems'));
  assert.match(css, /@page \{ size: A4; margin: 0; \}/);
  assert.match(css, /body > \*:not\(\.hd-print-root\) \{ display: none !important; \}/, 'the rest of the app takes no room on paper');
  assert.match(css, /\.no-print \{ display: none !important; \}/, 'buttons are not printed');
  assert.match(css, /position: static !important/, 'no fixed element to repeat on a second page');
  assert.match(css, /min-height: 0 !important/, 'the on-screen 297 mm minimum does not overflow the printable area');
  assert.match(css, /padding: 12mm !important/);
  assert.match(source, /createPortal\(/);
});

test('notes and signatures move one step at a time and stay put at the ends', () => {
  assert.deepEqual(moveEntry(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveEntry(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  const list = ['a', 'b'];
  assert.equal(moveEntry(list, 0, -1), list);
  assert.equal(moveEntry(list, 1, 1), list);
});

test('a logo must be PNG or JPG of at most 1 MB', () => {
  assert.equal(isLogoFileAllowed({ type: 'image/png', size: 1024 * 1024 }), true);
  assert.equal(isLogoFileAllowed({ type: 'image/jpeg', size: 2000 }), true);
  assert.equal(isLogoFileAllowed({ type: 'image/png', size: 1024 * 1024 + 1 }), false);
  assert.equal(isLogoFileAllowed({ type: 'image/webp', size: 2000 }), false);
  assert.equal(isLogoFileAllowed({ type: 'image/svg+xml', size: 2000 }), false);
});

test('the frontend fallback equals the backend default, so a failed load prints the same text', async () => {
  const backend = await import('../../backend/src/printTemplate.ts');
  assert.deepEqual(DEFAULT_DELIVERY_ORDER_TEMPLATE, backend.DEFAULT_DELIVERY_ORDER_TEMPLATE);
});

// --- Struk belanja (receipt) ---------------------------------------------------
import { ReceiptDocument, receiptContentWidth } from '../src/components/modals/PrintableReceipt.tsx';
const receipt = (template: DeliveryOrderTemplate, data: any = SAMPLE_DELIVERY_ORDER) =>
  renderToStaticMarkup(<ReceiptDocument data={data} template={template} printTimestamp="14 Nov 2026 10.00" />).replace(/&amp;/g, '&');

test('struk: the default receipt is 58 mm with the header, the lines, the total and the closing text', () => {
  const html = receipt(DEFAULT_DELIVERY_ORDER_TEMPLATE);
  assert.ok(html.includes('data-paper-width="58"'));
  assert.ok(html.includes(`width:${receiptContentWidth(58)}mm`));
  for (const text of ['HD FriedChicken', 'Telp: (021) 555-0192', 'REQ-CONTOH-0001', 'Outlet Contoh Sudirman', 'Staff Gudang HD',
    'Ayam Mentah (kg)', '20 x ', 'TOTAL', '35 pcs', 'Terima kasih.', 'Dicetak 14 Nov 2026 10.00']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('id="printable-receipt"'));
});

test('struk: 80 mm paper, hidden prices and approver, and an empty closing text are respected', () => {
  const html = receipt(edit((t) => { t.receipt = { paperWidth: 80, showPrices: false, showApprovedBy: false, footer: '' }; }));
  assert.ok(html.includes('data-paper-width="80"'));
  for (const text of ['TOTAL', 'Rp', 'Disetujui', 'Terima kasih']) assert.ok(!html.includes(text), text);
  assert.ok(html.includes('20 pcs') && html.includes('Box Nasi (pack/10)'), 'quantities and items stay');
});

test('struk: a template saved before the receipt existed still prints with the default receipt', () => {
  const old: any = cloneTemplate(DEFAULT_DELIVERY_ORDER_TEMPLATE); delete old.receipt;
  assert.ok(receipt(old).includes('data-paper-width="58"'));
  assert.ok(!renderToStaticMarkup(<ReceiptDocument preview data={SAMPLE_DELIVERY_ORDER} template={old} />).includes('printable-receipt'), 'the preview is never printed');
});
