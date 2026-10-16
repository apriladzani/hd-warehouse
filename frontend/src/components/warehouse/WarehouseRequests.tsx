import React, { useState, useEffect, useMemo } from 'react';
import { DateFilter } from '../common/DateFilter.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatDateIndo } from '../../lib/format.ts';
import { RequestTransaction } from '../../types.ts';
import { WarehouseRequestDetailModal } from '../modals/WarehouseRequestDetailModal.tsx';
import { OUTLETS } from '../../constants/outlets.ts';
import { Store, Check, Printer } from 'lucide-react';
import { PrintableTransactionA4 } from '../modals/PrintableTransactionA4.tsx';
import { buildApprovedRequestPrintData, canPrintApprovedRequest } from '../../lib/requestPrint.ts';

export const WarehouseRequests: React.FC = () => {
  const [requests, setRequests] = useState<RequestTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
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
  }, []);

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
    <div className="space-y-6">
      {/* Header & Date Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17233D] tracking-tight">
            Daftar Permintaan Outlet
          </h1>
          <p className="text-sm text-[#60708C] mt-0.5">
            Tinjau dan setujui pengeluaran barang per item untuk setiap pengajuan outlet.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5">
          {/* Outlet Selector */}
          <details className="relative">
            <summary id="filter-req-outlet" className="list-none flex items-center gap-1.5 bg-white px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-[12px] sm:rounded-[18px] border border-[#DDE5F0] shadow-2xs min-h-[32px] cursor-pointer text-[10px] sm:text-xs font-semibold text-[#17233D]">
              <Store className="w-3.5 h-3.5 text-[#ED002B] shrink-0" />
              {selectedOutlets.length ? `${selectedOutlets.length} outlet dipilih` : `Semua Outlet (${OUTLETS.length})`}
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 max-h-72 overflow-auto rounded-xl border border-[#DDE5F0] bg-white p-2 shadow-lg">
              <div className="flex justify-between gap-2 border-b border-[#DDE5F0] pb-2 mb-1 text-xs">
                <button type="button" onClick={() => setSelectedOutlets([...OUTLETS])} className="font-bold text-[#1D63D8]">Select All</button>
                <button type="button" onClick={() => setSelectedOutlets([])} className="font-semibold text-[#60708C]">Clear Selection</button>
              </div>
              {OUTLETS.map((outlet) => (
                <label key={outlet} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-[#17233D] hover:bg-[#F8FAFC] cursor-pointer">
                  <input type="checkbox" checked={selectedOutlets.includes(outlet)} onChange={() => setSelectedOutlets((current) => current.includes(outlet) ? current.filter((entry) => entry !== outlet) : [...current, outlet])} />
                  {outlet}
                </label>
              ))}
            </div>
          </details>

          <DateFilter
            startDate={startDate}
            endDate={endDate}
            onFilter={handleFilter}
            onReset={handleReset}
          />
        </div>
      </div>

      {/* Requests List */}
      <div className="bg-white rounded-[14px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
        <div className="p-2.5 sm:p-4 border-b border-[#DDE5F0] flex items-center justify-between bg-[#F8FAFC]/50">
          <span className="text-[10px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider">
            Total Pengajuan: {displayedRequests.length} {selectedOutlets.length ? `(${selectedOutlets.length} outlet)` : ''}
          </span>
        </div>

        <div className="divide-y divide-[#DDE5F0]">
          {loading ? (
            <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">Memuat permintaan...</div>
          ) : displayedRequests.length > 0 ? (
            displayedRequests.map((req) => (
              <div
                key={req.id}
                onClick={() => setSelectedRequestId(req.id)}
                className="p-2.5 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                <div className="space-y-0.5 sm:space-y-1">
                  <div className="flex items-center space-x-2 sm:space-x-3">
                    <span className="font-bold text-xs sm:text-base text-[#17233D] tracking-tight">
                      {req.requestCode}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-3 gap-y-0.5 text-[10px] sm:text-xs text-[#60708C]">
                    <span className="font-semibold text-[#17233D]">{req.requesterName}</span>
                    <span>•</span>
                    <span>{formatDateIndo(req.requestDate)}</span>
                    <span>•</span>
                    <span className="text-[#17233D] font-medium">
                      {req.itemCount || req.items?.length || 1} Barang
                    </span>
                    {req.itemSummary && (
                      <>
                        <span>•</span>
                        <span className="text-[#60708C] truncate max-w-[200px] sm:max-w-sm">{req.itemSummary}</span>
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
                      className="inline-flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 bg-[#17233D] hover:bg-[#263653] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[18px] transition-colors"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>Cetak A4</span>
                    </button>
                  )}
                  {req.status !== 'Approved' && req.status !== 'Rejected' && (
                    <button
                      id={`btn-quick-approve-${req.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickApproveAll(req.id);
                      }}
                      disabled={quickLoadingId === req.id}
                      className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-[#20B26B] hover:bg-[#1b9a5c] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[18px] transition-colors shadow-2xs flex items-center space-x-1 disabled:opacity-50"
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
                      setSelectedRequestId(req.id);
                    }}
                    className="px-2.5 py-1 sm:px-4 sm:py-1.5 bg-white hover:bg-[#F8FAFC] text-[#17233D] hover:text-[#ED002B] text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[18px] border border-[#DDE5F0] transition-colors"
                  >
                    [ Lihat ]
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">
              Tidak ada permintaan barang pada filter tanggal yang dipilih.
            </div>
          )}
        </div>
      </div>

      {/* Warehouse Request Detail Modal (Per-item approval/rejection) */}
      <WarehouseRequestDetailModal
        isOpen={!!selectedRequestId}
        requestId={selectedRequestId}
        onClose={() => setSelectedRequestId(null)}
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
