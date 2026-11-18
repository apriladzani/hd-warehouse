import { formatDateIndo, formatRupiah } from './format.ts';
import { DEFAULT_DELIVERY_ORDER_TEMPLATE, type DeliveryOrderTemplate } from './printTemplate.ts';

// The struk as ESC/POS commands, the language of thermal receipt printers.
// The same content as the on-screen struk (ReceiptDocument), laid out in
// fixed-width characters: 32 per line on 58 mm paper, 48 on 80 mm.

export type ReceiptLine = { name: string; quantity: number; price: number; subtotal: number };

// Approved lines of a request as printed on the struk.
export const receiptLines = (data: any): ReceiptLine[] => (data.items || data.approvedItems || []).map((line: any) => {
  const quantity = Number(line.approvedQuantity ?? line.quantity ?? 0);
  const price = Number(line.price || 0);
  return { name: line.itemName || `Barang #${line.itemId}`, quantity, price, subtotal: Number(line.subtotal ?? quantity * price) };
});
export const receiptTotal = (data: any, lines: ReceiptLine[]) => Number(data.totalApprovedAmount ?? lines.reduce((sum, line) => sum + line.subtotal, 0));

export const receiptColumns = (paperWidth: number) => (paperWidth === 80 ? 48 : 32);

// Printers start in code page 437: anything outside plain ASCII is replaced by
// its unaccented letter, or dropped.
export const asciiText = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[  -​ ]/g, ' ').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[•]/g, '*').replace(/[^\x20-\x7e]/g, '');

// Splits text into lines of at most `width` characters, breaking at spaces
// where possible.
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of asciiText(text).split(/\s*\n\s*/)) {
    let line = '';
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, width)); word = word.slice(width);
      }
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Left text and right text on one line; the left side wraps when both do not fit.
export function columns(left: string, right: string, width: number): string[] {
  const l = asciiText(left), r = asciiText(right);
  if (l.length + 1 + r.length <= width) return [l + ' '.repeat(width - l.length - r.length) + r];
  const head = wrap(l, width);
  const last = head[head.length - 1] ?? '';
  if (last.length + 1 + r.length <= width) return [...head.slice(0, -1), last + ' '.repeat(width - last.length - r.length) + r];
  return [...head, ' '.repeat(Math.max(0, width - r.length)) + r];
}

const ESC = 0x1b, GS = 0x1d;
const CMD = {
  init: [ESC, 0x40],
  left: [ESC, 0x61, 0], center: [ESC, 0x61, 1],
  boldOn: [ESC, 0x45, 1], boldOff: [ESC, 0x45, 0],
  bigOn: [GS, 0x21, 0x11], bigOff: [GS, 0x21, 0x00],
  feed: (lines: number) => [ESC, 0x64, lines],
  cut: [GS, 0x56, 66, 0], // feed to the cutter and cut; printers without a cutter ignore it
};

export function receiptEscPos(data: any, template: DeliveryOrderTemplate, printedAt = new Date()): Uint8Array {
  const settings = template.receipt ?? DEFAULT_DELIVERY_ORDER_TEMPLATE.receipt;
  const width = receiptColumns(settings.paperWidth);
  const bytes: number[] = [];
  const raw = (command: number[]) => { bytes.push(...command); };
  const text = (line: string) => { for (const ch of asciiText(line)) bytes.push(ch.charCodeAt(0)); bytes.push(0x0a); };
  const divider = () => text('-'.repeat(width));
  const lines = receiptLines(data);
  const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);

  raw(CMD.init); raw(CMD.center);
  raw(CMD.boldOn); raw(CMD.bigOn);
  wrap(template.header.brandName, Math.floor(width / 2)).forEach(text);
  raw(CMD.bigOff); raw(CMD.boldOff);
  if (template.header.address) wrap(template.header.address, width).forEach(text);
  if (template.header.hotline) wrap(`Telp: ${template.header.hotline}`, width).forEach(text);
  raw(CMD.left); divider();

  const info: Array<[string, string]> = [
    ['No', data.requestCode || '-'],
    ['Tanggal', formatDateIndo(data.requestDate)],
    ['Outlet', data.requesterName || data.outletName || '-'],
  ];
  if (settings.showApprovedBy) info.push(['Disetujui', data.approvalInfo || 'Staff Gudang']);
  const labelWidth = Math.max(...info.map(([label]) => label.length));
  for (const [label, value] of info) {
    const prefix = `${label.padEnd(labelWidth)}: `;
    wrap(value, width - prefix.length).forEach((part, index) => text((index ? ' '.repeat(prefix.length) : prefix) + part));
  }
  divider();

  if (!lines.length) text('Tidak ada barang.');
  for (const line of lines) {
    wrap(line.name, width).forEach(text);
    if (settings.showPrices) columns(`  ${line.quantity} x ${formatRupiah(line.price)}`, formatRupiah(line.subtotal), width).forEach(text);
    else columns('', `${line.quantity} pcs`, width).forEach(text);
  }
  divider();
  columns(`Total qty (${lines.length} item)`, `${totalQty} pcs`, width).forEach(text);
  if (settings.showPrices) { raw(CMD.boldOn); columns('TOTAL', formatRupiah(receiptTotal(data, lines)), width).forEach(text); raw(CMD.boldOff); }
  divider();

  raw(CMD.center);
  if (settings.footer) wrap(settings.footer, width).forEach(text);
  text(`Dicetak ${printedAt.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
  raw(CMD.left); raw(CMD.feed(3)); raw(CMD.cut);
  return Uint8Array.from(bytes);
}
