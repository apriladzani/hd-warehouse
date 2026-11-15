import { Toolbar } from '../common/UI.tsx';
import { StateMessage } from '../common/UI.tsx';
import React, { useEffect, useMemo, useState } from 'react';
import { canCancelOwnRequest, outletsOfRequests } from '../../lib/outletPlacement.ts';
import { itemOutletMatrix, purchaseRecap } from '../../lib/outletPurchases.ts';
import { User, RequestTransaction } from '../../types.ts';
import { CheckCircle2, PackageX, SlidersHorizontal, X } from 'lucide-react';
import { CancelRequestDialog } from '../modals/CancelRequestDialog.tsx';
import { canCancelRequest } from '../../lib/requestCancel.ts';
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
  const [cancelTarget, setCancelTarget] = useState<RequestTransaction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outletFilter, setOutletFilter] = useState('all');
  // Outlets the account holds (active or not); null until known, then the
  // server stays the judge of who may cancel.
  const [heldOutletIds, setHeldOutletIds] = useState<number[] | null>(null);
  const [activeOutletCount, setActiveOutletCount] = useState(0);

  useEffect(() => {
    fetch('/api/outlet/profile', { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.json()).then((data) => {
      setHeldOutletIds(Array.isArray(data.heldOutletIds) ? data.heldOutletIds : null);
      setActiveOutletCount(Array.isArray(data.outlets) ? data.outlets.length : 0);
    }).catch(() => setHeldOutletIds(null));
  }, [currentUser.id]);

  const outletOptions = useMemo(() => outletsOfRequests(requests), [requests]);
  // Shown for an account with more than one outlet, or history across several.
  const showOutletFilter = activeOutletCount > 1 || outletOptions.length > 1;
  const shownRequests = useMemo(() => outletFilter === 'all' ? requests : requests.filter((req) => String(req.outletId ?? '') === outletFilter), [requests, outletFilter]);
  const canCancel = (req: RequestTransaction) => canCancelOwnRequest(canCancelRequest(req.status), req.outletId, heldOutletIds);
  // Purchase recap of what is listed (date, status and outlet filters applied).
  const recap = useMemo(() => purchaseRecap(shownRequests), [shownRequests]);
  const matrix = useMemo(() => itemOutletMatrix(shownRequests), [shownRequests]);
  // Per-outlet columns in the item table: only when several outlets are listed.
  const outletColumns = recap.byOutlet.length > 1 && recap.byOutlet.length <= 4 ? recap.byOutlet : [];
  const periodText = startDate || endDate ? `${startDate ? formatDateIndo(startDate) : 'Awal'} – ${endDate ? formatDateIndo(endDate) : 'Sekarang'}` : 'Semua tanggal';

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

  const activeFilterCount = Number(Boolean(startDate)) + Number(Boolean(endDate)) + Number(statusFilter !== 'Semua Status') + Number(outletFilter !== 'all');

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
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        {showOutletFilter && (
          <div className="flex items-center space-x-1 sm:space-x-1.5 w-full sm:w-auto justify-end">
            <label htmlFor="user-outlet-filter" className="hd-status-filter-label text-[10px] sm:text-xs text-[#64748B] font-semibold shrink-0">Outlet:</label>
            <select
              id="user-outlet-filter"
              value={outletFilter}
              onChange={(e) => setOutletFilter(e.target.value)}
              className="flex-1 sm:flex-initial px-2 py-0.5 sm:px-3 sm:py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] sm:rounded-xl text-[10px] sm:text-xs text-[#1E293B] font-medium outline-none cursor-pointer focus:border-[#F0002B] min-h-[28px] sm:min-h-[36px]"
            >
              <option value="all">Semua Outlet</option>
              {outletOptions.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
            </select>
          </div>
        )}
        </div>
      </Toolbar>

      {notice && (
        <p role="status" className="flex items-center gap-1.5 rounded-lg border border-[#A7E4C4] bg-[#EAF8F1] px-3 py-2 text-xs font-semibold text-[#1B9357]">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{notice}
        </p>
      )}

      {/* Purchase recap: totals, per outlet, per item - no need to open each request */}
      {!loading && (
        <section aria-labelledby="purchase-recap-title" className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-3 sm:col-span-1">
              <p id="purchase-recap-title" className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Total Pembelian</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-[#1E293B] sm:text-2xl">{formatRupiah(recap.amount)}</p>
              <p className="mt-0.5 text-[11px] text-[#64748B]">{recap.requests} request · {recap.quantity.toLocaleString('id-ID')} unit · {periodText}</p>
            </div>
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-3 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Per Outlet</p>
              {recap.byOutlet.length ? (
                <ul className="mt-1.5 space-y-1">
                  {recap.byOutlet.map((outlet) => (
                    <li key={outlet.key} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate font-semibold text-[#1E293B]">{outlet.name}</span>
                      <span className="shrink-0 text-[11px] text-[#64748B]">{outlet.requests} request · {outlet.quantity.toLocaleString('id-ID')} unit</span>
                      <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-[#1E293B]">{formatRupiah(outlet.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1.5 text-xs text-[#64748B]">Belum ada pembelian pada filter ini.</p>}
            </div>
          </div>

          {recap.byItem.length > 0 && (
            <details open className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
              <summary className="cursor-pointer border-b border-[#E2E8F0] bg-[#F8FAFC]/60 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B] sm:px-4">
                Pembelian per Barang ({recap.byItem.length})
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead><tr>
                    <th>Barang</th>
                    {outletColumns.map((outlet) => <th key={outlet.key} className="text-right">{outlet.name}</th>)}
                    <th className="text-right">Total Qty</th>
                    <th className="text-right">Total Nilai</th>
                  </tr></thead>
                  <tbody>
                    {recap.byItem.map((item) => (
                      <tr key={item.key}>
                        <th scope="row" className="font-semibold text-[#1E293B]">{item.name}</th>
                        {outletColumns.map((outlet) => {
                          const cell = matrix.get(item.key)?.get(outlet.key);
                          return <td key={outlet.key} className="text-right tabular-nums text-[#475569]">{cell ? cell.quantity.toLocaleString('id-ID') : '—'}</td>;
                        })}
                        <td className="text-right font-semibold tabular-nums">{item.quantity.toLocaleString('id-ID')}</td>
                        <td className="text-right font-semibold tabular-nums">{formatRupiah(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <th scope="row" className="text-right">Total</th>
                    {outletColumns.map((outlet) => <td key={outlet.key} className="text-right font-semibold tabular-nums">{outlet.quantity.toLocaleString('id-ID')}</td>)}
                    <td className="text-right font-bold tabular-nums">{recap.quantity.toLocaleString('id-ID')}</td>
                    <td className="text-right font-bold tabular-nums">{formatRupiah(recap.amount)}</td>
                  </tr></tfoot>
                </table>
              </div>
              <p className="border-t border-[#E2E8F0] px-3 py-1.5 text-[10px] text-[#64748B] sm:px-4">Dihitung dari barang yang disetujui gudang (qty disetujui × harga). Request pending, ditolak, atau dibatalkan tidak dihitung.</p>
            </details>
          )}
        </section>
      )}

      {/* Transactions List */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden ">
        <div className="px-3 py-2 sm:p-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]/50">
          <span className="text-[10px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider">
            Total Transaksi: {shownRequests.length}
          </span>
        </div>

        {loading ? <StateMessage kind="loading">Memuat riwayat...</StateMessage> : shownRequests.length > 0 ? (
          <>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-xs">
              <thead><tr><th>Nomor Request</th><th>Tanggal</th><th>Outlet</th><th>Barang</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Aksi</th></tr></thead>
              <tbody>{shownRequests.map((req) => <tr key={req.id}>
                <th scope="row" className="whitespace-nowrap font-semibold text-[#1E293B]">{req.requestCode}</th>
                <td className="whitespace-nowrap text-[#64748B]">{formatDateIndo(req.requestDate)}</td>
                <td className="max-w-[160px] truncate">{req.outletName || '—'}</td>
                <td className="max-w-[280px] truncate">{req.itemSummary || `${req.itemCount || 1} Barang`}</td>
                <td><StatusBadge status={req.status} /></td>
                <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatRupiah(req.totalAmount)}</td>
                <td className="text-right"><div className="flex justify-end gap-1.5">
                  {canCancel(req) && <button type="button" id={`btn-cancel-request-${req.id}`} onClick={() => setCancelTarget(req)} className="hd-button hd-button--secondary !min-h-[30px] !px-2.5 !text-[#D80027]"><PackageX size={14} aria-hidden="true" />Batalkan</button>}
                  <button onClick={() => setSelectedTx(req)} className="hd-button hd-button--secondary !min-h-[30px] !px-2.5">Detail</button>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="sm:hidden divide-y divide-[#E2E8F0]">
            {shownRequests.map((req) => (
              <article key={req.id} className="hd-outlet-history-row">
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1E293B] truncate">{req.requestCode}</p>
                    <p className="mt-0.5 text-[11px] text-[#64748B]">{formatDateIndo(req.requestDate)} <span aria-hidden="true">·</span> {req.outletName || '—'} <span aria-hidden="true">·</span> {req.itemCount || req.items?.length || 1} barang</p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] text-[#64748B]">{req.itemSummary || `${req.itemCount || 1} Barang`}</span>
                  <div className="flex shrink-0 gap-1.5">
                    {canCancel(req) && <button type="button" onClick={() => setCancelTarget(req)} className="hd-button hd-button--secondary hd-history-detail !text-[#D80027]">Batalkan</button>}
                    <button onClick={() => setSelectedTx(req)} className="hd-button hd-button--secondary hd-history-detail">Detail</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          </>
        ) : <StateMessage>Tidak ada transaksi permintaan yang sesuai dengan filter.</StateMessage>}
      </div>

      {cancelTarget && (
        <CancelRequestDialog
          request={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            setNotice(`${cancelTarget.requestCode} dibatalkan. Stok yang sudah disetujui dikembalikan ke warehouse.`);
            setCancelTarget(null);
            void fetchRequests(startDate, endDate, statusFilter);
          }}
        />
      )}

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
