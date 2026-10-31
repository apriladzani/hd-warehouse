import { decimal, money } from './decimal.ts';
export type InventoryEvent = { at: number; order: number } & (
  { kind: 'cutoff'; quantity: number; average: string | null } |
  { kind: 'purchase'; quantity: number; price: string } |
  { kind: 'sale'; quantity: number }
);
// Moving average starts from immutable physical stock/cost at a cut-off.
// A missing cut-off is unknown, never fabricated as a zero opening balance.
export function periodInventory(events: InventoryEvent[], start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid period');
  if (events.some(e => !Number.isFinite(e.at))) {
    const unknown = { quantity: null, average: null };
    return { opening: unknown, closing: unknown, openingReasons: ['Ada pergerakan tanpa timestamp valid; urutan terhadap cut-off tidak dapat dipastikan.'], closingReasons: ['Ada pergerakan tanpa timestamp valid; urutan terhadap cut-off tidak dapat dipastikan.'] };
  }
  let reasons = ['Snapshot stok awal/cut-off historis belum tersedia untuk barang ini.'];
  const sorted = [...events].sort((a,b) => a.at-b.at || a.order-b.order);
  let stock: number | null = null, average: bigint | null = null;
  let opening: { quantity: number | null; average: string | null } = { quantity: null, average: null };
  const state = () => ({ quantity: stock, average: average === null ? null : money(average) });
  const apply = (e: InventoryEvent) => {
    if (!Number.isSafeInteger(e.quantity) || e.quantity < 0) throw new Error('Invalid quantity');
    if (e.kind === 'cutoff') {
      stock = e.quantity; average = stock === 0 ? 0n : e.average === null ? null : decimal(e.average);
      reasons = average === null ? ['Harga rata-rata snapshot cut-off belum tersedia untuk stok yang tersisa.'] : [];
      if (average !== null && average < 0n) throw new Error('Invalid average');
    } else if (e.kind === 'sale') {
      if (stock !== null) { if (e.quantity > stock) { stock = null; average = null; reasons = ['Pengeluaran melebihi saldo historis; periksa kelengkapan dan waktu transaksi.']; } else stock -= e.quantity; }
    } else {
      const price = decimal(e.price); if (price < 0n) throw new Error('Invalid price');
      if (stock === null) return;
      if (stock === 0 && e.quantity > 0) { average = price; reasons = []; }
      else if (average !== null && e.quantity > 0) {
        const divisor = BigInt(stock + e.quantity);
        average = (BigInt(stock) * average + BigInt(e.quantity) * price + divisor / 2n) / divisor;
      }
      stock += e.quantity;
    }
  };
  // A cut-off exactly at start establishes the new period opening balance.
  for (const e of sorted) if (e.at < start || (e.at === start && e.kind === 'cutoff')) apply(e);
  opening = state();
  const openingReasons = [...reasons];
  for (const e of sorted) if (e.at < end && (e.at > start || (e.at === start && e.kind !== 'cutoff'))) apply(e);
  return { opening, closing: state(), openingReasons, closingReasons: [...reasons] };
}

// A receipt-only historic average is not a balance carried from stock opname.
export function weightedReceiptAverage(amount: string, quantity: number): string | null {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Invalid receipt quantity');
  if (!quantity) return null;
  const total = decimal(amount); if (total < 0n) throw new Error('Invalid receipt value');
  const divisor = BigInt(quantity);
  return money((total + divisor / 2n) / divisor);
}
