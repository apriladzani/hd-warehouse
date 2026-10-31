export function incomingStock(opening: number | null | undefined, purchased: number, allPeriods = false) {
  if (allPeriods) return { quantity: purchased, note: `Pembelian seluruh periode: ${purchased}; saldo antarperiode tidak dijumlahkan ulang.` };
  if (opening == null) return { quantity: null, note: `Stok lama belum diketahui + masuk baru ${purchased}` };
  return { quantity: opening + purchased, note: `Stok lama ${opening} + masuk baru ${purchased}` };
}
