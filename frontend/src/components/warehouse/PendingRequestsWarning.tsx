import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatDateIndo } from '../../lib/format.ts';

// Requests the warehouse has not decided on yet. Their goods have not left the
// warehouse, so closing a period now counts them in the next one.
export type PendingRequestAtClosing = { id: number; requestCode: string; requesterName: string; outletName: string | null; requestDate: string; pendingItems: number; pendingQuantity: number };
export type PendingRequestsAtClosing = { count: number; requests: PendingRequestAtClosing[] };

export const NEXT_PERIOD_NOTE = 'Request ini belum keluar dari gudang, jadi akan masuk ke periode berikutnya, bukan periode yang ditutup sekarang.';

// Plain-text version for the confirmation dialog before closing.
export function pendingRequestsMessage(pending: PendingRequestsAtClosing | null | undefined): string {
  if (!pending?.count) return '';
  const lines = pending.requests.slice(0, 10).map((request) => `• ${request.requestCode} — ${request.outletName ?? request.requesterName} (${request.pendingItems} barang)`);
  const more = pending.count > lines.length ? `\n• … dan ${pending.count - lines.length} request lainnya` : '';
  return `Peringatan: ${pending.count} request belum di-approve.\n${lines.join('\n')}${more}\n\n${NEXT_PERIOD_NOTE}`;
}

export function PendingRequestsWarning({ pending }: { pending: PendingRequestsAtClosing | null | undefined }) {
  if (!pending?.count) return null;
  return <section role="status" aria-label="Request belum di-approve" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
    <h3 className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {pending.count} request belum di-approve
    </h3>
    <p className="mt-1 text-[11px] leading-relaxed text-amber-900">{NEXT_PERIOD_NOTE}</p>
    <ul className="mt-2 grid gap-1">
      {pending.requests.map((request) => <li key={request.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-amber-200 pt-1 text-[11px] text-amber-900 first:border-t-0 first:pt-0">
        <span><strong className="font-semibold">{request.requestCode}</strong> · {request.outletName ?? request.requesterName}</span>
        <span className="tabular-nums">{request.pendingItems} barang · {request.pendingQuantity.toLocaleString('id-ID')} pcs · {formatDateIndo(request.requestDate)}</span>
      </li>)}
    </ul>
  </section>;
}
