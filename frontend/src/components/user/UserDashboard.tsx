import { KpiCard, StateMessage } from '../common/UI.tsx';
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
    <div className="hd-outlet-dashboard space-y-3">
      {/* Top Header with prominent CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#1E293B] tracking-tight">Dashboard Outlet</h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
            Pantau permintaan barang dan status persetujuan gudang.
          </p>
        </div>

        <button
          id="btn-ajukan-permintaan"
          onClick={onNavigateToRequest}
          className="hd-dashboard-cta w-full sm:w-auto inline-flex items-center justify-center space-x-1.5 px-3.5 py-2 bg-[#F0002B] hover:bg-[#D80027] text-white text-xs font-bold rounded-lg transition-all min-h-[34px]"
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Buat HD Request</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Ringkasan permintaan">
        <KpiCard label="Total Permintaan" value={loading ? '...' : stats.total} icon={Package} />
        <KpiCard label="Pending" value={loading ? '...' : stats.pending} icon={Clock} tone="warning" />
        <KpiCard label="Disetujui" value={loading ? '...' : stats.approved} icon={CheckCircle2} tone="success" />
        <KpiCard label="Ditolak" value={loading ? '...' : stats.rejected} icon={XCircle} tone="danger" />
      </div>

      {/* Simple List of Recent Requests */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
        <div className="px-3 py-2.5 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#1E293B]">Permintaan Terbaru</h3>
            <p className="text-[11px] sm:text-xs text-[#64748B]">Daftar pengajuan barang terkini</p>
          </div>
          <button
            onClick={onNavigateToHistory}
            className="flex items-center space-x-1 text-[11px] sm:text-xs font-semibold text-[#F0002B] hover:underline"
          >
            <span>Lihat Semua</span>
            <ArrowRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-[#E2E8F0]">
          {loading ? (
            <StateMessage kind="loading">Memuat permintaan...</StateMessage>
          ) : stats.recentRequests && stats.recentRequests.length > 0 ? (
            stats.recentRequests.map((req) => (
              <div
                key={req.id}
                onClick={() => setSelectedTx(req)}
                className="hd-recent-request-row min-h-[60px] px-3 py-2 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors cursor-pointer gap-2"
              >
                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
                    <span className="font-bold text-xs sm:text-sm text-[#1E293B]">
                      {req.requestCode}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 text-[10px] sm:text-xs text-[#64748B]">
                    <span>{formatDateIndo(req.requestDate)}</span>
                    <span>•</span>
                    <span>{req.itemCount || req.items?.length || 1} Barang</span>
                    {req.itemSummary && (
                      <>
                        <span>•</span>
                        <span className="text-[#1E293B] truncate max-w-[150px] sm:max-w-xs">{req.itemSummary}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTx(req);
                  }}
                  className="px-2.5 py-1 sm:px-3.5 sm:py-1.5 bg-[#F8FAFC] hover:bg-white text-[#1E293B] hover:text-[#F0002B] text-[11px] sm:text-xs font-semibold rounded-[12px] sm:rounded-xl border border-[#E2E8F0] transition-colors shrink-0"
                >
                  Detail
                </button>
              </div>
            ))
          ) : (
            <StateMessage>Belum ada permintaan barang yang diajukan.</StateMessage>
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
