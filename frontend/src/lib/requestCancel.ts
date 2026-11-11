import { describeTransportFailure, requestJson } from './authRequest.ts';

// A request can be cancelled once it has been approved in full or in part.
// The server enforces the same rule; this only decides whether to offer it.
export const CANCELLABLE_STATUSES = ['Approved', 'Partially Approved'] as const;
export const canCancelRequest = (status: string | null | undefined) =>
  CANCELLABLE_STATUSES.includes(status as (typeof CANCELLABLE_STATUSES)[number]);

export const CANCEL_CONFIRM_TEXT = 'Yakin ingin membatalkan request ini? Stok akan dikembalikan ke warehouse.';
export const CANCEL_REASON_MAX = 500;

export type CancellationInfo = {
  cancelledByName: string;
  cancelledByRole: string;
  reason: string | null;
  returnedQuantity: number;
  cancelledAt: string;
};

// What will come back: only lines that were approved took stock out.
export function stockToReturn(items: { itemName?: string; status: string; approvedQuantity?: number | null }[] | undefined) {
  return (items ?? [])
    .filter((line) => line.status === 'Approved' && Number(line.approvedQuantity) > 0)
    .map((line) => ({ itemName: line.itemName || 'Barang', quantity: Number(line.approvedQuantity) }));
}

export async function cancelRequest(requestId: number, reason: string) {
  const result = await requestJson(`/api/requests/${requestId}/cancel`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() || null }),
  });
  if (result.ok) return { ok: true as const };
  return { ok: false as const, error: describeTransportFailure(result) || result.data?.error || 'Request gagal dibatalkan. Coba lagi.' };
}

export const cancellationSummary = (info: CancellationInfo) => {
  const when = new Date(info.cancelledAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
  const who = info.cancelledByRole === 'WAREHOUSE' ? `${info.cancelledByName} (Warehouse)` : info.cancelledByName;
  return `Dibatalkan oleh ${who} pada ${when}. ${info.returnedQuantity} pcs dikembalikan ke warehouse.`;
};
