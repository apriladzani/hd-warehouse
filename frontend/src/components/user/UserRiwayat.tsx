import React, { useEffect, useState } from 'react';
import { User, RequestTransaction } from '../../types.ts';
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
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    fetchRequests('', '', statusFilter);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-2xl font-bold text-[#17233D] tracking-tight">Riwayat Permintaan</h1>
        <p className="text-xs sm:text-sm text-[#60708C] mt-0.5">
          Arsip semua transaksi pengajuan barang yang pernah Anda buat.
        </p>
      </div>

      {/* Top Filter Bar */}
      <div className="bg-white p-2 sm:p-4 rounded-[14px] sm:rounded-[22px] border border-[#DDE5F0] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3">
        <DateFilter
          startDate={startDate}
          endDate={endDate}
          onFilter={handleFilter}
          onReset={handleReset}
        />

        <div className="flex items-center space-x-1 sm:space-x-1.5 w-full sm:w-auto justify-end">
          <label className="text-[10px] sm:text-xs text-[#60708C] font-semibold shrink-0">Status:</label>
          <select
            id="user-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 sm:flex-initial px-2 py-0.5 sm:px-3 sm:py-1.5 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[18px] text-[10px] sm:text-xs text-[#17233D] font-medium outline-none cursor-pointer focus:border-[#ED002B] min-h-[28px] sm:min-h-[36px]"
          >
            <option value="Semua Status">Semua Status</option>
            <option value="Pending">Pending</option>
            <option value="Partially Approved">Partially Approved</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-white rounded-[14px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
        <div className="px-3 py-2 sm:p-4 border-b border-[#DDE5F0] flex items-center justify-between bg-[#F8FAFC]/50">
          <span className="text-[10px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider">
            Total Transaksi: {requests.length}
          </span>
        </div>

        <div className="divide-y divide-[#DDE5F0]">
          {loading ? (
            <div className="py-6 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">Memuat riwayat...</div>
          ) : requests.length > 0 ? (
            requests.map((req) => (
              <div
                key={req.id}
                onClick={() => setSelectedTx(req)}
                className="p-2.5 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                <div className="space-y-0.5 sm:space-y-1">
                  <div className="flex items-center space-x-1.5 sm:space-x-3">
                    <span className="font-bold text-xs sm:text-base text-[#17233D] tracking-tight">
                      {req.requestCode}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-3 gap-y-0.5 text-[10px] sm:text-xs text-[#60708C]">
                    <span className="font-medium text-[#17233D]">
                      {formatDateIndo(req.requestDate)}
                    </span>
                    <span>•</span>
                    <span className="text-[#17233D] font-medium truncate max-w-[180px] sm:max-w-md">
                      {req.itemSummary || `${req.itemCount || 1} Barang`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end space-x-2.5 sm:space-x-4 border-t sm:border-t-0 pt-1.5 sm:pt-0 border-[#DDE5F0]">
                  <div className="text-left sm:text-right">
                    <span className="text-[9px] sm:text-[11px] text-[#60708C] block uppercase font-semibold">Total</span>
                    <span className="text-[11px] sm:text-sm font-bold text-[#17233D]">
                      {formatRupiah(req.totalAmount)}
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTx(req);
                    }}
                    className="px-2.5 py-0.5 sm:px-4 sm:py-1.5 bg-white hover:bg-[#F8FAFC] text-[#17233D] hover:text-[#ED002B] text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[18px] border border-[#DDE5F0] transition-colors"
                  >
                    Detail
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">
              Tidak ada transaksi permintaan yang sesuai dengan filter.
            </div>
          )}
        </div>
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
