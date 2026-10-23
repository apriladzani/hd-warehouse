import { StateMessage } from '../common/UI.tsx';
import React, { useState, useEffect, useMemo } from 'react';
import { DateFilter } from '../common/DateFilter.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatDateIndo } from '../../lib/format.ts';
import { RequestTransaction } from '../../types.ts';
import { WarehouseRequestDetailModal } from '../modals/WarehouseRequestDetailModal.tsx';
import { Store, Check, Printer } from 'lucide-react';
import { PrintableTransactionA4 } from '../modals/PrintableTransactionA4.tsx';
import { buildApprovedRequestPrintData, canPrintApprovedRequest } from '../../lib/requestPrint.ts';

interface WarehouseRequestsProps {
  requestDetailId?: number | null;
  onRequestDetailChange?: (id: number | null) => void;
}

export const WarehouseRequests: React.FC<WarehouseRequestsProps> = ({ requestDetailId = null, onRequestDetailChange }) => {
  const [requests, setRequests] = useState<RequestTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(requestDetailId);
  const [quickLoadingId, setQuickLoadingId] = useState<number | null>(null);
  const [printData, setPrintData] = useState<any | null>(null);

  const fetchRequests = async (start = startDate, end = endDate) => {
    try {
      setLoading(true);
      let url = '/api/requests';
      const params = new URLSearchParams();
      if (start) params.append('startDate', start);
      if (end) params.append('endDate', end);
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (err) {
      console.error('Failed to load requests:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickApproveAll = async (reqId: number) => {
    try {
      setQuickLoadingId(reqId);
      const res = await fetch(`/api/requests/${reqId}/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffName: 'Staff Gudang' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Gagal menyetujui semua barang');
      } else {
        await fetchRequests();
      }
    } catch (err: any) {
      alert(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setQuickLoadingId(null);
    }
  };

  const handlePrintRequest = async (reqId: number) => {
    try {
      const response = await fetch(`/api/requests/${reqId}`);
      const data = await response.json();
      if (!response.ok || !canPrintApprovedRequest(data.request)) {
        alert('Request hanya dapat dicetak setelah seluruh item selesai diproses dan ada barang yang disetujui.');
        return;
      }
      setPrintData(buildApprovedRequestPrintData(data.request));
    } catch (err: any) {
      alert(err.message || 'Gagal memuat data cetak request.');
    }
  };

  useEffect(() => {
    fetchRequests(startDate, endDate);
    fetch('/api/outlets').then((res) => res.json()).then((data) => setOutlets(data.outlets || [])).catch((err) => console.error('Failed to load outlets:', err));
  }, []);

  useEffect(() => {
    setSelectedRequestId(requestDetailId);
  }, [requestDetailId]);

  const openRequestDetail = (id: number) => {
    setSelectedRequestId(id);
    onRequestDetailChange?.(id);
  };

  const closeRequestDetail = () => {
    setSelectedRequestId(null);
    onRequestDetailChange?.(null);
  };

  const handleFilter = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    fetchRequests(start, end);
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    fetchRequests('', '');
  };

  const displayedRequests = useMemo(() => {
    if (!selectedOutlets.length) return requests;
    return requests.filter((r) =>
      selectedOutlets.some((outlet) => (r.requesterName || '').toLowerCase().includes(outlet.toLowerCase()))
    );
  }, [requests, selectedOutlets]);

  return (
    <div className="hd-warehouse-requests space-y-3">
      {/* Header & Date Filter */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div className="shrink-0">
          <h1 className="text-lg sm:text-xl font-bold text-[#1E293B] tracking-tight">
            Daftar Permintaan Outlet
          </h1>
        </div>

        <div className="hd-request-toolbar flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
          {/* Outlet Selector */}
          <details className="relative">
            <summary id="filter-req-outlet" className="hd-request-filter-trigger list-none flex items-center gap-1.5 bg-white px-2.5 rounded-[10px] border border-[#E2E8F0] min-h-[34px] cursor-pointer text-[11px] font-semibold text-[#1E293B]">
              <Store className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
              {selectedOutlets.length ? `${selectedOutlets.length} outlet dipilih` : `Semua Outlet (${outlets.length})`}
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 max-h-72 overflow-auto rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-lg">
              <div className="flex justify-between gap-2 border-b border-[#E2E8F0] pb-2 mb-1 text-xs">
                <button type="button" onClick={() => setSelectedOutlets(outlets.map((outlet) => outlet.name))} className="font-bold text-[#1D63D8]">Select All</button>
                <button type="button" onClick={() => setSelectedOutlets([])} className="font-semibold text-[#64748B]">Clear Selection</button>
              </div>
              {outlets.map((outlet) => (
                <label key={outlet.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-[#1E293B] hover:bg-[#F8FAFC] cursor-pointer">
                  <input type="checkbox" checked={selectedOutlets.includes(outlet.name)} onChange={() => setSelectedOutlets((current) => current.includes(outlet.name) ? current.filter((entry) => entry !== outlet.name) : [...current, outlet.name])} />
                  {outlet.name}
                </label>
              ))}
            </div>
          </details>

          <DateFilter
            startDate={startDate}
            endDate={endDate}
            onFilter={handleFilter}
            onReset={handleReset}
            className="hd-request-date-filter"
          />
        </div>
      </div>

      {/* Requests List */}
      <div className="hd-request-list bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]/50">
          <span className="text-[11px] font-semibold text-[#64748B]">
            Total Pengajuan: {displayedRequests.length} {selectedOutlets.length ? `(${selectedOutlets.length} outlet)` : ''}
          </span>
        </div>

          <div className="divide-y divide-[#E2E8F0]">
          {loading ? (
            <StateMessage kind="loading">Memuat permintaan...</StateMessage>
          ) : displayedRequests.length > 0 ? (
            displayedRequests.map((req) => (
              <div
                key={req.id}
                onClick={() => openRequestDetail(req.id)}
                className="hd-request-row flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-3 py-2 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="font-bold text-xs sm:text-sm text-[#1E293B] tracking-tight">
                      {req.requestCode}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-0 text-[10px] sm:text-xs text-[#64748B]">
                    <span className="font-medium text-[#1E293B]">{req.requesterName}</span>
                    <span>•</span>
                    <span>{formatDateIndo(req.requestDate)}</span>
                    <span>•</span>
                    <span className="text-[#1E293B] font-medium">
                      {req.itemCount || req.items?.length || 1} Barang
                    </span>
                    {req.itemSummary && (
                      <>
                        <span>•</span>
                        <span className="text-[#64748B] truncate max-w-[200px] sm:max-w-sm">{req.itemSummary}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2">
                  {canPrintApprovedRequest(req) && (
                    <button
                      id={`btn-print-request-${req.id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrintRequest(req.id);
                      }}
                      className="hd-button hd-button--secondary !min-h-[30px] !px-2.5 !py-1 !text-[11px]"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>Cetak A4</span>
                    </button>
                  )}
                  {req.status === 'Pending' && (
                    <button
                      id={`btn-quick-approve-${req.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickApproveAll(req.id);
                      }}
                      disabled={quickLoadingId === req.id}
                      className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-[#16A34A] hover:bg-[#15803D] text-white text-[10px] sm:text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1 disabled:opacity-50 min-h-[32px]"
                      title="Setujui seluruh barang dalam permintaan ini langsung"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{quickLoadingId === req.id ? 'Memproses...' : 'Approve Semua'}</span>
                    </button>
                  )}
                  <button
                    id={`btn-lihat-request-${req.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openRequestDetail(req.id);
                    }}
                    className="hd-button hd-button--secondary !min-h-[30px] !px-2.5 !py-1 !text-[11px]"
                  >
                    Detail
                  </button>
                </div>
              </div>
            ))
          ) : (
            <StateMessage>Tidak ada permintaan barang pada filter tanggal yang dipilih.</StateMessage>
          )}
        </div>
      </div>

      {/* Warehouse Request Detail Modal (Per-item approval/rejection) */}
      <WarehouseRequestDetailModal
        isOpen={!!selectedRequestId}
        requestId={selectedRequestId}
        onClose={closeRequestDetail}
        onUpdated={() => fetchRequests(startDate, endDate)}
      />

      {printData && (
        <PrintableTransactionA4
          isOpen={!!printData}
          onClose={() => setPrintData(null)}
          type="outgoing"
          data={printData}
        />
      )}
    </div>
  );
};
