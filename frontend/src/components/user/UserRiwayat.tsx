import { Toolbar } from '../common/UI.tsx';
import { StateMessage } from '../common/UI.tsx';
import React, { useEffect, useState } from 'react';
import { User, RequestTransaction } from '../../types.ts';
import { SlidersHorizontal, X } from 'lucide-react';
import { DateFilter } from '../common/DateFilter.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatDateIndo, formatRupiah } from '../../lib/format.ts';
import { TransactionDetailModal } from '../modals/TransactionDetailModal.tsx';

interface UserRiwayatProps {
  currentUser: User;
}

export const UserRiwayat: React.FC<UserRiwayatProps> = ({ currentUser }) => {
  const [requests, setRequests] = useState<RequestTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('Semua Status');
  const [selectedTx, setSelectedTx] = useState<RequestTransaction | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const fetchRequests = async (start = startDate, end = endDate, status = statusFilter) => {
    try {
      setLoading(true);
      let url = `/api/requests?userId=${currentUser.id}`;
      if (start) url += `&startDate=${start}`;
      if (end) url += `&endDate=${end}`;
      if (status && status !== 'Semua Status') url += `&status=${encodeURIComponent(status)}`;

      const res = await fetch(url);
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (err) {
      console.error('Failed to fetch user requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests(startDate, endDate, statusFilter);
  }, [currentUser.id, statusFilter]);

  const handleFilter = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    fetchRequests(start, end, statusFilter);
    setFilterSheetOpen(false);
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    fetchRequests('', '', statusFilter);
    setFilterSheetOpen(false);
  };

  const activeFilterCount = Number(Boolean(startDate)) + Number(Boolean(endDate)) + Number(statusFilter !== 'Semua Status');

  return (
    <div className="hd-outlet-history space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-xl font-bold text-[#1E293B] tracking-tight">Riwayat Permintaan</h1>
        <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
          Arsip semua transaksi pengajuan barang yang pernah Anda buat.
        </p>
      </div>

      {/* Top Filter Bar */}
      <Toolbar className="hd-outlet-history-toolbar">
        <button type="button" className="hd-mobile-filter-trigger" aria-expanded={filterSheetOpen} onClick={() => setFilterSheetOpen(true)}>
          <SlidersHorizontal size={15} /> Filter{activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        </button>
        {filterSheetOpen && <button type="button" className="hd-filter-sheet-backdrop" aria-label="Tutup filter" onClick={() => setFilterSheetOpen(false)} />}
        <div className={`hd-outlet-history-controls${filterSheetOpen ? ' is-open' : ''}`} aria-label="Filter riwayat">
          <div className="hd-filter-sheet-heading"><strong>Filter Riwayat</strong><button type="button" aria-label="Tutup filter" onClick={() => setFilterSheetOpen(false)}><X size={18} /></button></div>
        <DateFilter
          startDate={startDate}
          endDate={endDate}
          onFilter={handleFilter}
          onReset={handleReset}
        />

        <div className="flex items-center space-x-1 sm:space-x-1.5 w-full sm:w-auto justify-end">
          <label className="hd-status-filter-label text-[10px] sm:text-xs text-[#64748B] font-semibold shrink-0">Status:</label>
          <select
            id="user-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 sm:flex-initial px-2 py-0.5 sm:px-3 sm:py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] sm:rounded-xl text-[10px] sm:text-xs text-[#1E293B] font-medium outline-none cursor-pointer focus:border-[#F0002B] min-h-[28px] sm:min-h-[36px]"
          >
            <option value="Semua Status">Semua Status</option>
            <option value="Pending">Pending</option>
            <option value="Partially Approved">Partially Approved</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
        </div>
      </Toolbar>

      {/* Transactions List */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden ">
        <div className="px-3 py-2 sm:p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]/50">
          <span className="text-[10px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider">
            Total Transaksi: {requests.length}
          </span>
        </div>

        {loading ? <StateMessage kind="loading">Memuat riwayat...</StateMessage> : requests.length > 0 ? (
          <>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead><tr><th>Nomor Request</th><th>Tanggal</th><th>Barang</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Aksi</th></tr></thead>
              <tbody>{requests.map((req) => <tr key={req.id}>
                <th scope="row" className="whitespace-nowrap font-semibold text-[#1E293B]">{req.requestCode}</th>
                <td className="whitespace-nowrap text-[#64748B]">{formatDateIndo(req.requestDate)}</td>
                <td className="max-w-[280px] truncate">{req.itemSummary || `${req.itemCount || 1} Barang`}</td>
                <td><StatusBadge status={req.status} /></td>
                <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatRupiah(req.totalAmount)}</td>
                <td className="text-right"><button onClick={() => setSelectedTx(req)} className="hd-button hd-button--secondary !min-h-[30px] !px-2.5">Detail</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="sm:hidden divide-y divide-[#E2E8F0]">
            {requests.map((req) => (
              <article key={req.id} className="hd-outlet-history-row">
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1E293B] truncate">{req.requestCode}</p>
                    <p className="mt-0.5 text-[11px] text-[#64748B]">{formatDateIndo(req.requestDate)} <span aria-hidden="true">·</span> {req.itemCount || req.items?.length || 1} barang</p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] text-[#64748B]">{req.itemSummary || `${req.itemCount || 1} Barang`}</span>
                  <button onClick={() => setSelectedTx(req)} className="hd-button hd-button--secondary hd-history-detail">Detail</button>
                </div>
              </article>
            ))}
          </div>
          </>
        ) : <StateMessage>Tidak ada transaksi permintaan yang sesuai dengan filter.</StateMessage>}
      </div>

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        isOpen={!!selectedTx}
        onClose={() => setSelectedTx(null)}
        type="outgoing"
        data={selectedTx}
      />
    </div>
  );
};
