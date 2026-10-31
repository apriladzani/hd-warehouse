export type StockMovement = { at: number; kind: string; quantity: number; reference: string; before?: number | null; after?: number | null };
export function reconcileWarehouseStock(opening: number | null, incoming: number, movements: StockMovement[], start: number, end: number, current: number | null, cutoffReferences: Set<string> = new Set()) {
  const active = movements.filter(m => m.at >= start && m.at < end && !(m.kind === 'STOCK_OPNAME_ADJUSTMENT' && cutoffReferences.has(m.reference)));
  const outgoing = active.filter(m => m.kind === 'OUT').reduce((sum,m) => sum + m.quantity,0);
  const adjustment = active.filter(m => m.kind === 'STOCK_OPNAME_ADJUSTMENT').reduce((sum,m) => sum + m.quantity,0);
  const movementIncoming = active.filter(m => m.kind === 'IN').reduce((sum,m) => sum + m.quantity,0);
  const reasons: string[] = [];
  if (opening === null) reasons.push('Saldo awal tidak memiliki bukti cut-off.');
  if (movements.some(m => !Number.isFinite(m.at))) reasons.push('Timestamp pergerakan stok tidak lengkap.');
  if (active.some(m => !['IN','OUT','STOCK_OPNAME_ADJUSTMENT'].includes(m.kind))) reasons.push('Jenis pergerakan belum dipetakan.');
  if (movementIncoming !== incoming) reasons.push('Jumlah penerimaan ledger stok berbeda dari baris pembelian.');
  const calculated = opening === null ? null : opening + incoming - outgoing + adjustment;
  if (calculated !== null && calculated < 0) reasons.push('Saldo hasil rekonsiliasi negatif.');
  const closing = reasons.length ? null : calculated;
  const matchesInventory = closing !== null && current !== null ? closing === current : null;
  if (matchesInventory === false) reasons.push('Saldo akhir periode berbeda dari master Inventory saat ini.');
  return { outgoing, adjustment, closing: matchesInventory === false ? null : closing, calculated, matchesInventory, reasons };
}
