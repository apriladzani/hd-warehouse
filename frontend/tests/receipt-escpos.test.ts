import test from 'node:test';
import assert from 'node:assert/strict';
import { asciiText, columns, receiptColumns, receiptEscPos, wrap } from '../src/lib/escpos.ts';
import { rawbtUrl, writeChunks } from '../src/lib/receiptPrinter.ts';
import { DEFAULT_DELIVERY_ORDER_TEMPLATE, SAMPLE_DELIVERY_ORDER, cloneTemplate } from '../src/lib/printTemplate.ts';

const printable = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');
// Text lines without the commands (ESC @, ESC a n, ESC E n, GS ! n, ESC d n, GS V m n).
const textLines = (bytes: Uint8Array) => printable(bytes).replace(/\x1b\x40|\x1b[\x61\x45\x64][\s\S]|\x1d\x21[\s\S]|\x1d\x56[\s\S]{2}/g, '').split('\n');

test('escpos: 32 characters per line on 58 mm, 48 on 80 mm', () => {
  assert.equal(receiptColumns(58), 32);
  assert.equal(receiptColumns(80), 48);
});

test('escpos: text is plain ASCII for the printer code page', () => {
  assert.equal(asciiText('Rp 38.000 · Café “Ayam” −5'), 'Rp 38.000  Cafe "Ayam" -5');
});

test('escpos: wrap keeps every line within the width and breaks words that are too long', () => {
  const lines = wrap('Ayam Goreng Tepung Spesial Bumbu Rahasia Kemasan Besar SUPERPANJANGTANPASPASI', 16);
  assert.ok(lines.every((line) => line.length <= 16), JSON.stringify(lines));
  assert.equal(lines.join(' ').replace(/\s+/g, ''), 'AyamGorengTepungSpesialBumbuRahasiaKemasanBesarSUPERPANJANGTANPASPASI');
});

test('escpos: columns put the amount at the right edge', () => {
  assert.deepEqual(columns('TOTAL', 'Rp1.080.000', 32), ['TOTAL' + ' '.repeat(16) + 'Rp1.080.000']);
  const long = columns('20 x Rp38.000 nama yang sangat panjang sekali', 'Rp760.000', 32);
  assert.ok(long.every((line) => line.length <= 32));
  assert.ok(long[long.length - 1].endsWith('Rp760.000'));
});

test('escpos: the struk starts with init, ends with feed and cut, and holds the request', () => {
  const bytes = receiptEscPos(SAMPLE_DELIVERY_ORDER, DEFAULT_DELIVERY_ORDER_TEMPLATE, new Date('2026-11-18T03:00:00Z'));
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...bytes.slice(-4)], [0x1d, 0x56, 66, 0]);
  const text = printable(bytes);
  for (const part of ['HD FriedChicken', 'Telp: (021) 555-0192', 'REQ-CONTOH-0001', 'Outlet Contoh', 'Sudirman', 'Disetujui', 'Ayam Mentah (kg)', '20 x Rp38.000', 'Rp760.000', 'TOTAL', 'Rp1.080.000', '35 pcs', 'Terima kasih.'])
    assert.ok(text.includes(part), part);
  assert.ok([...bytes].every((b) => b < 0x80), 'only ASCII and commands');
  for (const line of textLines(bytes)) assert.ok(line.length <= 32, `"${line}" is ${line.length} wide`);
});

test('escpos: 80 mm, hidden prices and approver follow the struk settings', () => {
  const template = cloneTemplate(DEFAULT_DELIVERY_ORDER_TEMPLATE);
  template.receipt = { paperWidth: 80, showPrices: false, showApprovedBy: false, footer: '' };
  const bytes = receiptEscPos(SAMPLE_DELIVERY_ORDER, template);
  const text = printable(bytes);
  for (const part of ['Rp', 'TOTAL', 'Disetujui', 'Terima kasih']) assert.ok(!text.includes(part), part);
  assert.ok(text.includes('-'.repeat(48)));
  assert.ok(text.includes('20 pcs'));
});

test('bluetooth: data is written in 20-byte pieces, in order', async () => {
  const data = Uint8Array.from({ length: 45 }, (_, i) => i);
  const pieces: number[][] = [];
  await writeChunks(async (chunk) => { pieces.push([...chunk]); }, data);
  assert.deepEqual(pieces.map((p) => p.length), [20, 20, 5]);
  assert.deepEqual(pieces.flat(), [...data]);
});

test('rawbt: the struk goes to the RawBT app as base64', () => {
  const url = rawbtUrl(Uint8Array.from([0x1b, 0x40, 0x41]));
  assert.equal(url, 'rawbt:base64,G0BB');
});
