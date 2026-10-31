import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Approving one line of a request closes the whole request: the backend rejects
// every line left undecided. This dialog names those lines before that happens.
export type DecidableItem = { id: number; itemName: string; requestedQuantity: number; status: string };

export const AUTO_REJECT_NOTE = 'Menyetujui satu barang akan langsung menutup seluruh pengajuan ini. Barang di bawah ini otomatis ditolak dan tidak bisa disetujui lagi.';

// The still-undecided lines other than the one being approved.
export const linesAutoRejected = (items: DecidableItem[], approvingItemId: number) =>
  items.filter((item) => item.status === 'Pending' && item.id !== approvingItemId);

export function ApproveSubsetConfirm({ item, autoRejected, approvedQuantity, busy = false, onApproveAll, onApproveSelected, onCancel }: {
  item: DecidableItem;
  autoRejected: DecidableItem[];
  approvedQuantity: number;
  busy?: boolean;
  onApproveAll: () => void;
  onApproveSelected: () => void;
  onCancel: () => void;
}) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={onCancel}>
    <div role="alertdialog" aria-modal="true" aria-labelledby="approve-subset-title" className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
      <h2 id="approve-subset-title" className="flex items-center gap-1.5 text-sm font-bold text-[#1E293B]">
        <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
        {autoRejected.length} barang lain akan otomatis ditolak
      </h2>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#475569]">{AUTO_REJECT_NOTE}</p>

      <p className="mt-3 text-[11px] font-semibold text-[#1E293B]">Disetujui:</p>
      <p className="text-[11px] text-[#475569]">{item.itemName} — {approvedQuantity.toLocaleString('id-ID')} dari {item.requestedQuantity.toLocaleString('id-ID')} pcs</p>

      <p className="mt-2 text-[11px] font-semibold text-[#B45309]">Otomatis ditolak:</p>
      <ul className="mt-0.5 max-h-40 overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-2">
        {autoRejected.map((rejected) => <li key={rejected.id} className="flex justify-between gap-3 py-0.5 text-[11px] text-amber-900">
          <span>{rejected.itemName}</span><span className="tabular-nums">{rejected.requestedQuantity.toLocaleString('id-ID')} pcs</span>
        </li>)}
      </ul>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-[9px] border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-slate-50 disabled:opacity-40">Batal</button>
        <button type="button" onClick={onApproveSelected} disabled={busy} className="rounded-[9px] border border-[#F8B6C2] bg-white px-3 py-2 text-xs font-semibold text-[#F0002B] hover:bg-[#FDE8EC] disabled:opacity-40">Setujui yang dipilih saja</button>
        <button type="button" onClick={onApproveAll} disabled={busy} className="rounded-[9px] bg-[#20B26B] px-3 py-2 text-xs font-bold text-white hover:bg-[#1b9a5c] disabled:opacity-40">Setujui semua</button>
      </div>
    </div>
  </div>;
}
