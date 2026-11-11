import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, PackageX } from 'lucide-react';
import { CANCEL_CONFIRM_TEXT, CANCEL_REASON_MAX, cancelRequest, stockToReturn, type CancellationInfo } from '../../lib/requestCancel.ts';

type CancellableRequest = {
  id: number;
  requestCode: string;
  items?: { itemName?: string; status: string; approvedQuantity?: number | null }[];
};

// Confirms cancelling an approved request. The buttons say what they do -
// "Kembali" and "Ya, Batalkan Request" - because a plain "Batal" on a
// cancellation dialog reads both ways.
export function CancelRequestDialog({ request, onClose, onCancelled }: {
  request: CancellableRequest;
  onClose: () => void;
  onCancelled: (info?: CancellationInfo) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const returning = stockToReturn(request.items);

  // Start on the safe choice, and let Escape back out unless a call is running.
  useEffect(() => { keepRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await cancelRequest(request.id, reason);
    setBusy(false);
    if (result.ok) onCancelled();
    else setError(result.error);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-request-title" aria-describedby="cancel-request-text"
        className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-xl sm:p-5" onClick={(event) => event.stopPropagation()}>
        <h2 id="cancel-request-title" className="flex items-center gap-2 text-sm font-bold text-[#1E293B]">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#FDE8EC] text-[#F0002B]"><PackageX className="h-4 w-4" aria-hidden="true" /></span>
          Batalkan {request.requestCode}?
        </h2>
        <p id="cancel-request-text" className="mt-2 text-xs leading-relaxed text-[#475569]">{CANCEL_CONFIRM_TEXT}</p>

        {returning.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
            <p className="text-[11px] font-semibold text-[#334155]">Dikembalikan ke warehouse:</p>
            <ul className="mt-1 space-y-0.5">
              {returning.map((line, index) => (
                <li key={index} className="flex justify-between gap-3 text-[11px] text-[#475569]">
                  <span className="min-w-0 truncate">{line.itemName}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-[#1E293B]">+{line.quantity.toLocaleString('id-ID')} pcs</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-[#64748B]">Barang yang ditolak tidak mengubah stok.</p>
          </div>
        )}

        <label htmlFor="cancel-request-reason" className="mt-3 block text-[11px] font-semibold text-[#334155]">
          Alasan pembatalan <span className="font-normal text-[#64748B]">(opsional)</span>
        </label>
        <textarea id="cancel-request-reason" value={reason} onChange={(event) => setReason(event.target.value.slice(0, CANCEL_REASON_MAX))}
          rows={3} maxLength={CANCEL_REASON_MAX} disabled={busy} placeholder="Misalnya: outlet tidak jadi memakai barang ini"
          className="mt-1 w-full resize-none rounded-lg border border-[#E2E8F0] px-2.5 py-2 text-xs text-[#1E293B] outline-none focus:border-[#F0002B] disabled:bg-[#F8FAFC]" />
        <p className="mt-0.5 text-right text-[10px] tabular-nums text-[#94A3B8]">{reason.length}/{CANCEL_REASON_MAX}</p>

        {error && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] p-2 text-[11px] text-[#BE123C]">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button ref={keepRef} type="button" onClick={onClose} disabled={busy}
            className="rounded-[9px] border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-slate-50 disabled:opacity-40">Kembali</button>
          <button type="button" onClick={() => void confirm()} disabled={busy} aria-busy={busy || undefined}
            className="rounded-[9px] bg-[#F0002B] px-3 py-2 text-xs font-bold text-white hover:bg-[#D80027] disabled:opacity-50">
            {busy ? 'Membatalkan…' : 'Ya, Batalkan Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
