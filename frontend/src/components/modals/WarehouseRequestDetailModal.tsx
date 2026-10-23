import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  CheckCheck,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Plus,
  Minus,
  Printer,
} from 'lucide-react';
import { RequestTransaction, RequestItem } from '../../types.ts';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatDateIndo, formatRupiah } from '../../lib/format.ts';
import { PrintableTransactionA4 } from './PrintableTransactionA4.tsx';
import { buildApprovedRequestPrintData, canPrintApprovedRequest } from '../../lib/requestPrint.ts';

interface WarehouseRequestDetailModalProps {
  isOpen: boolean;
  requestId: number | null;
  onClose: () => void;
  onUpdated: () => void;
}

export const WarehouseRequestDetailModal: React.FC<WarehouseRequestDetailModalProps> = ({
  isOpen,
  requestId,
  onClose,
  onUpdated,
}) => {
  const [request, setRequest] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showPrintA4, setShowPrintA4] = useState(false);

  const fetchDetail = async () => {
    if (!requestId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/requests/${requestId}`);
      const data = await res.json();
      setRequest(data.request);

      // Initialize quantities map for editable approved amounts
      if (data.request?.items) {
        const initQ: Record<number, number> = {};
        data.request.items.forEach((it: any) => {
          initQ[it.id] =
            it.status === 'Approved' && it.approvedQuantity > 0
              ? it.approvedQuantity
              : it.requestedQuantity;
        });
        setQuantities(initQ);
      }
    } catch (err) {
      console.error('Failed to fetch request detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && requestId) {
      setError(null);
      setSuccessMsg(null);
      fetchDetail();
    }
  }, [isOpen, requestId]);

  const handleQtyChange = (itemId: number, newQty: number, maxQty: number) => {
    const val = Math.max(1, Math.min(newQty, maxQty));
    setQuantities((prev) => ({
      ...prev,
      [itemId]: val,
    }));
  };

  // Single Item Decision (Approve with quantity / Reject)
  const handleDecision = async (
    requestItemId: number,
    decision: 'Approve' | 'Reject'
  ) => {
    setError(null);
    setSuccessMsg(null);
    setActionLoadingId(requestItemId);

    try {
      const endpoint =
        decision === 'Approve'
          ? `/api/requests/${requestId}/items/${requestItemId}/approve`
          : `/api/requests/${requestId}/items/${requestItemId}/reject`;

      const payload: any = { staffName: 'Staff Gudang' };
      if (decision === 'Approve') {
        payload.approvedQuantity = quantities[requestItemId] || undefined;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Gagal memproses ${decision}`);
      }

      const itemQty = quantities[requestItemId];
      setSuccessMsg(
        decision === 'Approve'
          ? `Berhasil menyetujui barang (${itemQty ?? 'sesuai'} pcs)!`
          : 'Berhasil menolak barang!'
      );
      await fetchDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Batch Decision: Approve ALL Pending Items
  const handleApproveAll = async () => {
    if (!requestId) return;
    setError(null);
    setSuccessMsg(null);
    setBatchLoading(true);

    try {
      const res = await fetch(`/api/requests/${requestId}/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffName: 'Staff Gudang',
          customQuantities: quantities,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyetujui semua barang');
      }

      setSuccessMsg('Semua barang dalam pengajuan berhasil disetujui!');
      await fetchDetail();
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem saat approve semua.');
    } finally {
      setBatchLoading(false);
    }
  };

  if (!isOpen || !requestId) return null;

  const pendingItems = request?.items?.filter((it: any) => it.status === 'Pending') || [];
  const hasPending = request?.status === 'Pending' && pendingItems.length > 0;
  const approvedItems = request?.items?.filter((it: any) => Number(it.approvedQuantity) > 0) || [];
  const approvedQty = approvedItems.reduce((sum: number, it: any) => sum + Number(it.approvedQuantity || 0), 0);
  const notApprovedItems = request?.items?.filter((it: any) => Number(it.requestedQuantity) > Number(it.approvedQuantity || 0)) || [];
  const notApprovedQty = notApprovedItems.reduce((sum: number, it: any) => sum + Math.max(0, Number(it.requestedQuantity) - Number(it.approvedQuantity || 0)), 0);

  return (
    <div className="hd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-xs">
      <div
        className="hd-dialog bg-white w-full max-w-2xl rounded-xl border border-[#E2E8F0] overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-4 border-b border-[#E2E8F0]">
          <div>
            <div className="flex items-center space-x-1.5 sm:space-x-3">
              <span className="text-sm sm:text-xl font-bold text-[#1E293B] truncate">
                {request?.requestCode || 'REQ-xxx'}
              </span>
              {request && <StatusBadge status={request.status} />}
            </div>
            <p className="text-[10px] sm:text-xs text-[#64748B] mt-0.5">
              Review &amp; Persetujuan Barang Gudang
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 sm:p-1.5 text-[#64748B] hover:text-[#1E293B] rounded-full hover:bg-[#F8FAFC]"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {canPrintApprovedRequest(request) && (
          <div className="px-3 sm:px-6 pt-3">
            <button
              type="button"
              onClick={() => setShowPrintA4(true)}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#1E293B] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#263653]"
            >
              <Printer className="h-3.5 w-3.5" /> Cetak A4
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-3 sm:p-6 overflow-y-auto space-y-3 sm:space-y-5">
          {error && (
            <div className="p-2.5 sm:p-3 bg-[#FDE8EC] border border-[#F8B6C2] rounded-[12px] sm:rounded-xl text-[10px] sm:text-xs font-semibold text-[#F0002B] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-2.5 sm:p-3 bg-[#EAF8F1] border border-[#A7E4C4] rounded-[12px] sm:rounded-xl text-[10px] sm:text-xs font-semibold text-[#1B9357] flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Simple Top Request Metadata */}
          {request && (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-3 p-2.5 sm:p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs">
              <div>
                <span className="text-[#64748B] block font-semibold uppercase text-[10px] sm:text-[10px]">
                  Kode
                </span>
                <span className="font-bold text-[#1E293B] text-xs sm:text-sm mt-0.5 block truncate">
                  {request.requestCode}
                </span>
              </div>
              <div>
                <span className="text-[#64748B] block font-semibold uppercase text-[10px] sm:text-[10px]">
                  Pemohon
                </span>
                <span className="font-bold text-[#1E293B] text-xs sm:text-sm mt-0.5 block truncate">
                  {request.requesterName}
                </span>
              </div>
              <div>
                <span className="text-[#64748B] block font-semibold uppercase text-[10px] sm:text-[10px]">
                  Tanggal
                </span>
                <span className="font-bold text-[#1E293B] text-xs sm:text-sm mt-0.5 block truncate">
                  {formatDateIndo(request.requestDate)}
                </span>
              </div>
            </div>
          )}

          {request && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[11px]">
              <span className="font-semibold text-[#15803D]">Disetujui: {approvedItems.length} barang · {approvedQty} pcs</span>
              <span className="font-semibold text-[#64748B]">Tidak disetujui: {notApprovedItems.length} barang · {notApprovedQty} pcs</span>
            </div>
          )}

          {/* Tombol Batch Approve Semua Barang */}
          {hasPending && (
            <div className="p-3 sm:p-4 rounded-xl bg-[#EAF8F1] border border-[#A7E4C4] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <span className="font-bold text-xs sm:text-sm text-[#1B9357] flex items-center space-x-1.5">
                  <CheckCheck className="w-4 h-4 text-[#1B9357]" />
                  <span>Persetujuan Sekaligus</span>
                </span>
                <p className="text-[10px] sm:text-xs text-[#2D6A4F] mt-0.5">
                  Terdapat <strong>{pendingItems.length} barang</strong> yang menunggu persetujuan. Klik tombol di kanan untuk approve semua langsung.
                </p>
              </div>

              <button
                id="btn-approve-semua-barang-modal"
                type="button"
                onClick={handleApproveAll}
                disabled={batchLoading}
                className="px-4 py-2 sm:px-5 sm:py-2.5 bg-[#20B26B] hover:bg-[#1b9a5c] text-white text-xs font-bold rounded-[12px] sm:rounded-xl  flex items-center justify-center space-x-1.5 transition-all shrink-0 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>
                  {batchLoading
                    ? 'Memproses...'
                    : `Approve Semua Barang (${pendingItems.length})`}
                </span>
              </button>
            </div>
          )}

          {/* Items Approval List (Per item) */}
          <div className="space-y-2 sm:space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider">
                Daftar Barang &amp; Keputusan Stok
              </h4>
              <span className="text-[10px] sm:text-xs text-[#64748B]">
                Total: {request?.items?.length || 0} Barang
              </span>
            </div>

            {loading ? (
              <div className="py-6 text-center text-xs text-[#64748B]">Memuat detail barang...</div>
            ) : request?.items && request.items.length > 0 ? (
              request.items.map((item: any) => {
                const isItemLoading = actionLoadingId === item.id || batchLoading;
                const isItemPending = request?.status === 'Pending' && item.status === 'Pending';
                const currentQty =
                  quantities[item.id] !== undefined
                    ? quantities[item.id]
                    : item.requestedQuantity;
                const isPartial = isItemPending && currentQty < item.requestedQuantity;
                const isOutOfStock = (item.currentStock ?? 0) < currentQty;

                return (
                  <div
                    key={item.id}
                    className="p-3 sm:p-4 rounded-xl border border-[#E2E8F0] bg-white space-y-2.5"
                  >
                    {/* Top Row: Item Name, Request, Stock, Price & Status */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
                      <div>
                        <h4 className="font-bold text-xs sm:text-sm text-[#1E293B]">
                          {item.itemName}
                        </h4>
                        <div className="flex flex-wrap items-center gap-x-2 text-[10px] sm:text-xs text-[#64748B] mt-0.5">
                          <span>
                            Request: <strong className="text-[#1E293B]">{item.requestedQuantity} pcs</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Stok Gudang:{' '}
                            <strong
                              className={
                                (item.currentStock ?? 0) < item.requestedQuantity
                                  ? 'text-[#F0002B]'
                                  : 'text-[#1E293B]'
                              }
                            >
                              {item.currentStock ?? 0} pcs
                            </strong>
                          </span>
                          <span>•</span>
                          <span>{formatRupiah(item.price)}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <StatusBadge status={item.status} />
                      </div>
                    </div>

                    {/* Alert jika stok tidak mencukupi */}
                    {isItemPending && isOutOfStock && (
                      <div className="flex items-center space-x-1.5 text-[10px] sm:text-[11px] text-[#B27B00] bg-[#FFF8E6] px-2.5 py-1 rounded-[10px] border border-[#FFE699]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Stok gudang ({item.currentStock ?? 0} pcs) kurang dari jumlah disetujui ({currentQty} pcs)! Anda dapat menurunkan kuantitas ke jumlah stok yang tersedia.
                        </span>
                      </div>
                    )}

                    {/* Jika status Pending: Sediakan controller jumlah yang disetujui & tombol approve/reject */}
                    {isItemPending ? (
                      <div className="pt-2 border-t border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        {/* Stepper Kuantitas Disetujui */}
                        <div className="flex items-center flex-wrap gap-2">
                          <label className="text-[11px] font-semibold text-[#64748B]">
                            Qty Disetujui:
                          </label>
                          <div className="inline-flex items-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] p-0.5 ">
                            <button
                              type="button"
                              onClick={() =>
                                handleQtyChange(item.id, currentQty - 1, item.requestedQuantity)
                              }
                              disabled={currentQty <= 1 || isItemLoading}
                              className="w-7 h-7 rounded flex items-center justify-center text-[#64748B] disabled:opacity-30 hover:bg-white active:bg-gray-100"
                              title="Kurangi kuantitas disetujui"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={item.requestedQuantity}
                              value={currentQty}
                              onChange={(e) =>
                                handleQtyChange(
                                  item.id,
                                  parseInt(e.target.value) || 1,
                                  item.requestedQuantity
                                )
                              }
                              disabled={isItemLoading}
                              className="w-12 text-center text-xs font-bold text-[#1E293B] outline-none bg-transparent"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleQtyChange(item.id, currentQty + 1, item.requestedQuantity)
                              }
                              disabled={currentQty >= item.requestedQuantity || isItemLoading}
                              className="w-7 h-7 rounded flex items-center justify-center text-[#1E293B] disabled:opacity-30 hover:bg-white active:bg-gray-100"
                              title="Tambah kuantitas disetujui"
                            >
                              <Plus className="w-3.5 h-3.5 text-[#F0002B]" />
                            </button>
                          </div>
                          <span className="text-[10px] text-[#64748B]">
                            pcs (dari {item.requestedQuantity} pcs)
                          </span>
                          {isPartial && (
                            <span className="text-[10px] font-bold text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded-full border border-[#BFDBFE]">
                              Parsial ({currentQty}/{item.requestedQuantity} pcs)
                            </span>
                          )}
                        </div>

                        {/* Tombol Reject & Approve Satuan */}
                        <div className="flex items-center justify-end space-x-1.5 sm:space-x-2">
                          <button
                            id={`btn-reject-item-${item.id}`}
                            type="button"
                            onClick={() => handleDecision(item.id, 'Reject')}
                            disabled={isItemLoading}
                            className="px-2.5 py-1.5 sm:px-3.5 sm:py-1.5 rounded-[8px] sm:rounded-xl text-[10px] sm:text-xs font-semibold border transition-colors bg-white hover:bg-[#FDE8EC] text-[#F0002B] border-[#F8B6C2] disabled:opacity-40"
                          >
                            [ Reject ]
                          </button>

                          <button
                            id={`btn-approve-item-${item.id}`}
                            type="button"
                            onClick={() => handleDecision(item.id, 'Approve')}
                            disabled={isItemLoading || isOutOfStock}
                            className="px-3.5 py-1.5 sm:px-4 sm:py-1.5 rounded-[8px] sm:rounded-xl text-[10px] sm:text-xs font-bold transition-colors bg-[#20B26B] hover:bg-[#1b9a5c] text-white  disabled:opacity-40 flex items-center space-x-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>
                              {isItemLoading
                                ? 'Proses...'
                                : isPartial
                                ? `Approve (${currentQty} pcs)`
                                : 'Approve'}
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : item.status === 'Approved' ? (
                      /* Keterangan jika sudah Approved */
                      <div className="pt-2 border-t border-[#E2E8F0] text-[11px] text-[#1B9357] font-semibold flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#1B9357]" />
                          <span>
                            Disetujui:{' '}
                            <strong>{item.approvedQuantity} pcs</strong>
                            {item.approvedQuantity < item.requestedQuantity && (
                              <span className="text-[#64748B] font-normal ml-1">
                                (dari total {item.requestedQuantity} pcs diminta)
                              </span>
                            )}
                          </span>
                        </div>
                        {item.approvedBy && (
                          <span className="text-[10px] text-[#64748B]">
                            Oleh: {item.approvedBy}
                          </span>
                        )}
                      </div>
                    ) : (
                      /* Keterangan jika sudah Rejected */
                      <div className="pt-2 border-t border-[#E2E8F0] text-[11px] text-[#F0002B] font-semibold flex items-center space-x-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-[#F0002B]" />
                        <span>Permintaan barang ini telah ditolak.</span>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-xs text-[#64748B]">
                Tidak ada data barang dalam permintaan ini.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 sm:px-6 sm:py-4 bg-[#F8FAFC] border-t border-[#E2E8F0] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 sm:px-5 sm:py-2 bg-white hover:bg-gray-50 text-[#1E293B] font-bold text-[10px] sm:text-xs rounded-[10px] sm:rounded-xl border border-[#E2E8F0]"
          >
            Tutup
          </button>
        </div>
      </div>
      {showPrintA4 && canPrintApprovedRequest(request) && (
        <PrintableTransactionA4
          isOpen={showPrintA4}
          onClose={() => setShowPrintA4(false)}
          type="outgoing"
          data={buildApprovedRequestPrintData(request)}
        />
      )}
    </div>
  );
};
