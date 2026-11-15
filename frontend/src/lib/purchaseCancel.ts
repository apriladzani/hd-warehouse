import { describeTransportFailure, requestJson } from './authRequest.ts';
import type { PurchaseTransaction } from '../types.ts';

// Cancelling a purchase (Barang Masuk) entered by mistake. The server decides
// and enforces everything (role, reason, stock, closed period); these helpers
// only shape what the Riwayat page shows and sends.

export const PURCHASE_CANCEL_REASON_MAX = 500;
export type PurchaseStatusFilter = 'all' | 'active' | 'cancelled';

export const isPurchaseCancelled = (tx: Pick<PurchaseTransaction, 'status'>) => tx.status === 'cancelled';

export const filterPurchasesByStatus = <T extends Pick<PurchaseTransaction, 'status'>>(list: T[], filter: PurchaseStatusFilter) =>
  filter === 'all' ? list : list.filter((tx) => (filter === 'cancelled') === isPurchaseCancelled(tx));

// Totals of Barang Masuk: cancelled purchases are listed but never counted.
export function incomingTotals(list: PurchaseTransaction[], itemIds: number[] = []) {
  let amount = 0, quantity = 0, count = 0;
  for (const tx of list) {
    if (isPurchaseCancelled(tx)) continue;
    count += 1;
    for (const line of tx.items || []) {
      if (!(Number(line.quantity) > 0 && Number(line.price) >= 0) || (itemIds.length && !itemIds.includes(line.itemId))) continue;
      amount += Number(line.quantity) * Number(line.price);
      quantity += Number(line.quantity);
    }
  }
  return { amount, quantity, count };
}

export type CancelImpactLine = { itemId: number; itemName: string; quantity: number; stockNow: number | null; stockAfter: number | null; short: boolean };

// What cancelling does to stock, per item: stock now → stock after. `short`
// marks an item without enough stock left, which the server will refuse.
export function purchaseCancelImpact(tx: PurchaseTransaction, stockByItem: Map<number, number>): CancelImpactLine[] {
  const byItem = new Map<number, CancelImpactLine>();
  for (const line of tx.items || []) {
    const quantity = Number(line.quantity);
    if (!(quantity > 0)) continue;
    const entry = byItem.get(line.itemId) ?? { itemId: line.itemId, itemName: line.itemName || `Barang #${line.itemId}`, quantity: 0, stockNow: null, stockAfter: null, short: false };
    entry.quantity += quantity;
    byItem.set(line.itemId, entry);
  }
  return [...byItem.values()].map((entry) => {
    const stockNow = stockByItem.has(entry.itemId) ? stockByItem.get(entry.itemId)! : null;
    const stockAfter = stockNow === null ? null : stockNow - entry.quantity;
    return { ...entry, stockNow, stockAfter, short: stockAfter !== null && stockAfter < 0 };
  });
}

export async function cancelPurchase(purchaseId: number, reason: string) {
  const result = await requestJson(`/api/purchases/${purchaseId}/cancel`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() }),
  });
  if (result.ok) return { ok: true as const };
  return { ok: false as const, error: describeTransportFailure(result) || result.data?.error || 'Pembelian gagal dibatalkan. Coba lagi.' };
}

export const purchaseCancellationSummary = (tx: Pick<PurchaseTransaction, 'cancelledAt' | 'cancelledByName' | 'cancelReason'>) => {
  const when = tx.cancelledAt ? new Date(tx.cancelledAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '';
  return `Dibatalkan${tx.cancelledByName ? ` oleh ${tx.cancelledByName}` : ''}${when ? ` pada ${when}` : ''}. Alasan: ${tx.cancelReason || '-'}`;
};
