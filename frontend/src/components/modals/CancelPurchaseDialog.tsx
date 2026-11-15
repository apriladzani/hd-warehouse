import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, PackageMinus } from 'lucide-react';
import type { PurchaseTransaction } from '../../types.ts';
import { formatDateIndo, formatRupiah } from '../../lib/format.ts';
import { PURCHASE_CANCEL_REASON_MAX, cancelPurchase, purchaseCancelImpact } from '../../lib/purchaseCancel.ts';

// Confirms cancelling a purchase (Barang Masuk). Shows what was bought and what
// it does to stock, asks for a reason, and leaves every rule to the server.
export function CancelPurchaseDialog({ purchase, onClose, onCancelled }: {
  purchase: PurchaseTransaction;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [stock, setStock] = useState<Map<number, number> | null>(null);
  const [stockError, setStockError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { keepRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Current stock, read when the dialog opens.
  useEffect(() => {
    let active = true;
    fetch('/api/inventory').then((response) => response.json()).then((data) => {
      if (active) setStock(new Map((data.items || []).map((item: any) => [Number(item.id), Number(item.currentStock)])));
    }).catch(() => { if (active) setStockError(true); });
    return () => { active = false; };
  }, []);

  const impact = purchaseCancelImpact(purchase, stock ?? new Map());
  const short = impact.filter((line) => line.short);
  const canConfirm = !busy && reason.trim().length > 0 && short.length === 0;

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true); setError(null);
    const result = await cancelPurchase(purchase.id, reason);
    setBusy(false);
    if (result.ok) onCancelled();
    else setError(result.error);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-purchase-title" aria-describedby="cancel-purchase-text"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-xl sm:p-5" onClick={(event) => event.stopPropagation()}>
        <h2 id="cancel-purchase-title" className="flex items-center gap-2 text-sm font-bold text-[#1E293B]">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#FDE8EC] text-[#F0002B]"><PackageMinus className="h-4 w-4" aria-hidden="true" /></span>
          Batalkan pembelian {purchase.transactionCode}?
        </h2>
        <p id="cancel-purchase-text" className="mt-2 text-xs leading-relaxed text-[#475569]">
          Stok barang di bawah akan dikurangi sebesar qty pembelian ini, harga rata-rata dihitung ulang, dan transaksi tidak lagi dihitung di total maupun laporan Finance. Data transaksi tetap tersimpan dengan status Dibatalkan.
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-[11px]">
          <dt className="text-[#64748B]">No. Transaksi</dt><dd className="font-semibold text-[#1E293B]">{purchase.transactionCode}</dd>
          <dt className="text-[#64748B]">Tanggal</dt><dd className="text-[#1E293B]">{formatDateIndo(purchase.transactionDate)}</dd>
          <dt className="text-[#64748B]">Vendor</dt><dd className="truncate text-[#1E293B]">{purchase.vendorName || purchase.vendorCode || '-'}</dd>
          <dt className="text-[#64748B]">Total nominal</dt><dd className="font-semibold tabular-nums text-[#1E293B]">{formatRupiah(purchase.totalAmount)}</dd>
        </dl>

        <div className="mt-3 overflow-x-auto rounded-lg border border-[#E2E8F0]">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-[#F8FAFC] text-[#64748B]">
              <tr><th className="px-2 py-1.5 font-semibold">Barang</th><th className="px-2 py-1.5 text-right font-semibold">Qty batal</th><th className="px-2 py-1.5 text-right font-semibold">Stok sekarang → setelah batal</th></tr>
            </thead>
            <tbody>
              {impact.map((line) => (
                <tr key={line.itemId} className={`border-t border-[#E2E8F0] ${line.short ? 'bg-[#FFF1F2]' : ''}`}>
                  <td className="px-2 py-1.5 text-[#1E293B]">{line.itemName}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[#BE123C]">−{line.quantity.toLocaleString('id-ID')}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#1E293B]">
                    {stock === null ? (stockError ? 'Stok tidak terbaca' : 'Memuat…') : <>{line.stockNow?.toLocaleString('id-ID') ?? '-'} → <strong className={line.short ? 'text-[#BE123C]' : ''}>{line.stockAfter?.toLocaleString('id-ID') ?? '-'}</strong></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {short.length > 0 && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] p-2 text-[11px] text-[#BE123C]">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Tidak bisa dibatalkan: stok {short[0].itemName} tinggal {short[0].stockNow}, sedangkan pembelian ini {short[0].quantity}. Sebagian barang sudah dikeluarkan.
          </p>
        )}

        <label htmlFor="cancel-purchase-reason" className="mt-3 block text-[11px] font-semibold text-[#334155]">
          Alasan pembatalan <span className="text-[#F0002B]">*</span>
        </label>
        <textarea id="cancel-purchase-reason" value={reason} onChange={(event) => setReason(event.target.value.slice(0, PURCHASE_CANCEL_REASON_MAX))}
          rows={3} maxLength={PURCHASE_CANCEL_REASON_MAX} disabled={busy} required aria-required="true"
          placeholder="Misalnya: salah input qty, seharusnya 5 bukan 50"
          className="mt-1 w-full resize-none rounded-lg border border-[#E2E8F0] px-2.5 py-2 text-xs text-[#1E293B] outline-none focus:border-[#F0002B] disabled:bg-[#F8FAFC]" />
        <p className="mt-0.5 flex justify-between text-[10px] text-[#94A3B8]">
          <span>{reason.trim() ? '' : 'Wajib diisi.'}</span>
          <span className="tabular-nums">{reason.length}/{PURCHASE_CANCEL_REASON_MAX}</span>
        </p>

        {error && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] p-2 text-[11px] text-[#BE123C]">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button ref={keepRef} type="button" onClick={onClose} disabled={busy}
            className="rounded-[9px] border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-slate-50 disabled:opacity-40">Kembali</button>
          <button type="button" onClick={() => void confirm()} disabled={!canConfirm} aria-busy={busy || undefined}
            className="rounded-[9px] bg-[#F0002B] px-3 py-2 text-xs font-bold text-white hover:bg-[#D80027] disabled:opacity-50">
            {busy ? 'Membatalkan…' : 'Ya, Batalkan Pembelian'}
          </button>
        </div>
      </div>
    </div>
  );
}
