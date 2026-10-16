import React, { useEffect, useState } from 'react';
import { Plus, ArrowRight, Package, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { User, RequestTransaction, UserStats } from '../../types.ts';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatDateIndo } from '../../lib/format.ts';
import { TransactionDetailModal } from '../modals/TransactionDetailModal.tsx';

interface UserDashboardProps {
  currentUser: User;
  onNavigateToRequest: () => void;
  onNavigateToHistory: () => void;
}

export const UserDashboard: React.FC<UserDashboardProps> = ({
  currentUser,
  onNavigateToRequest,
  onNavigateToHistory,
}) => {
  const [stats, setStats] = useState<UserStats>({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    recentRequests: [],
  });
  const [loading, setLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState<RequestTransaction | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/dashboard/user-stats?userId=${currentUser.id}`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to load user stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [currentUser.id]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Header with prominent CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-[#17233D] tracking-tight">HD Request Order Outlet</h1>
          <p className="text-xs sm:text-sm text-[#60708C] mt-0.5">
            Daftar pesanan barang outlet ke gudang pusat dengan input quantity instan.
          </p>
        </div>

        <button
          id="btn-ajukan-permintaan"
          onClick={onNavigateToRequest}
          className="w-full sm:w-auto inline-flex items-center justify-center space-x-1.5 px-4 py-2.5 sm:px-5 sm:py-2.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs sm:text-sm font-bold rounded-[16px] sm:rounded-[20px] shadow-sm transition-all min-h-[38px] sm:min-h-[44px]"
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>+ Ajukan HD Request Order</span>
        </button>
      </div>

      {/* Small Summary Blocks (Total, Pending, Approved, Rejected) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="bg-white p-3 sm:p-5 rounded-[16px] sm:rounded-[20px] border border-[#DDE5F0] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-[#60708C] uppercase tracking-wider">
              Total Permintaan
            </span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#F8FAFC] flex items-center justify-center text-[#60708C]">
              <Package className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 sm:mt-3 text-lg sm:text-2xl font-extrabold text-[#17233D]">
            {loading ? '...' : stats.total}
          </div>
        </div>

        <div className="bg-white p-3 sm:p-5 rounded-[16px] sm:rounded-[20px] border border-[#DDE5F0] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-[#60708C] uppercase tracking-wider">
              Pending
            </span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#FFF8E6] flex items-center justify-center text-[#B27B00]">
              <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 sm:mt-3 text-lg sm:text-2xl font-extrabold text-[#B27B00]">
            {loading ? '...' : stats.pending}
          </div>
        </div>

        <div className="bg-white p-3 sm:p-5 rounded-[16px] sm:rounded-[20px] border border-[#DDE5F0] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-[#60708C] uppercase tracking-wider">
              Disetujui
            </span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#EAF8F1] flex items-center justify-center text-[#1B9357]">
              <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 sm:mt-3 text-lg sm:text-2xl font-extrabold text-[#1B9357]">
            {loading ? '...' : stats.approved}
          </div>
        </div>

        <div className="bg-white p-3 sm:p-5 rounded-[16px] sm:rounded-[20px] border border-[#DDE5F0] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-[#60708C] uppercase tracking-wider">
              Ditolak
            </span>
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#FDE8EC] flex items-center justify-center text-[#ED002B]">
              <XCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 sm:mt-3 text-lg sm:text-2xl font-extrabold text-[#ED002B]">
            {loading ? '...' : stats.rejected}
          </div>
        </div>
      </div>

      {/* Simple List of Recent Requests */}
      <div className="bg-white rounded-[18px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
        <div className="p-3.5 sm:p-5 border-b border-[#DDE5F0] flex items-center justify-between">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#17233D]">Permintaan Terbaru</h3>
            <p className="text-[11px] sm:text-xs text-[#60708C]">Daftar pengajuan barang terkini</p>
          </div>
          <button
            onClick={onNavigateToHistory}
            className="flex items-center space-x-1 text-[11px] sm:text-xs font-semibold text-[#ED002B] hover:underline"
          >
            <span>Lihat Semua</span>
            <ArrowRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-[#DDE5F0]">
          {loading ? (
            <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">Memuat data...</div>
          ) : stats.recentRequests && stats.recentRequests.length > 0 ? (
            stats.recentRequests.map((req) => (
              <div
                key={req.id}
                onClick={() => setSelectedTx(req)}
                className="p-3 sm:p-5 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors cursor-pointer gap-2"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
                    <span className="font-bold text-xs sm:text-sm text-[#17233D]">
                      {req.requestCode}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 text-[10px] sm:text-xs text-[#60708C]">
                    <span>{formatDateIndo(req.requestDate)}</span>
                    <span>•</span>
                    <span>{req.itemCount || req.items?.length || 1} Barang</span>
                    {req.itemSummary && (
                      <>
                        <span>•</span>
                        <span className="text-[#17233D] truncate max-w-[150px] sm:max-w-xs">{req.itemSummary}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTx(req);
                  }}
                  className="px-2.5 py-1 sm:px-3.5 sm:py-1.5 bg-[#F8FAFC] hover:bg-white text-[#17233D] hover:text-[#ED002B] text-[11px] sm:text-xs font-semibold rounded-[12px] sm:rounded-[18px] border border-[#DDE5F0] transition-colors shrink-0"
                >
                  Detail
                </button>
              </div>
            ))
          ) : (
            <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">
              Belum ada permintaan barang yang diajukan.
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
