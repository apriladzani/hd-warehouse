import { warehouseEstimateTotals } from '../../finance/warehouseEstimate.ts';
import { WarehouseFinanceTable } from './WarehouseFinanceTable.tsx';
import { OutletFilter } from './OutletFilter.tsx';
import { effectiveOutletIds, readOutletParam, withOutletParam } from '../../finance/outletFilter.ts';
import { formatMoney } from '../../finance/model.ts';
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Layers, Package, RotateCcw, ShoppingBag, TrendingUp, Banknote } from 'lucide-react';
import type { User, WarehouseStats } from '../../types.ts';
import { formatDateIndo, formatRupiah } from '../../lib/format.ts';
import { KpiCard, StateMessage } from '../common/UI.tsx';

const CATEGORIES = [
  { name: 'Raw Material', code: 'RM' },
  { name: 'Support Material', code: 'SM' },
  { name: 'Packaging', code: 'PKG' },
] as const;

const formatTableRupiah = (value: number) => {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);
  if (absolute >= 1_000_000_000_000) return `${amount < 0 ? '-' : ''}Rp ${(absolute / 1_000_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} T`;
  if (absolute >= 1_000_000_000) return `${amount < 0 ? '-' : ''}Rp ${(absolute / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  return formatRupiah(amount);
};

export const WarehouseDashboard: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [stats, setStats] = useState<WarehouseStats>({ totalStock: 0, barangMasukPcs: 0, barangKeluarPcs: 0, requestPending: 0, recentTransactions: [], itemProfitability: [], itemList: [] });
  const [outlets, setOutlets] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriodId, setSelectedPeriodId] = useState('running');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  // An Outlet account is locked to its outlet by the server; its URL filter is ignored.
  const outletAccount = currentUser.role === 'OUTLET';
  const [selectedOutlets, setSelectedOutlets] = useState<number[]>(() => outletAccount ? [] : readOutletParam(window.location.search));
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [error, setError] = useState('');

  const fetchStats = async (itemIds = selectedItemIds, outletIds = effectiveOutletIds(selectedOutlets, outlets), categories = selectedCategories, periodId = selectedPeriodId) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      params.set('periodId', periodId);
      if (itemIds.length) params.set('itemIds', itemIds.join(','));
      if (outletIds.length) params.set('outletIds', outletIds.join(','));
      if (categories.length) params.set('categories', categories.join(','));
      const response = await fetch(`/api/dashboard/finance-stats${params.size ? `?${params}` : ''}`, {
        credentials: 'same-origin',
      });
      const data: WarehouseStats = await response.json();
      if (!response.ok) {
        if ((data as any).code === 'FINANCE_ACCESS_REQUIRED') window.dispatchEvent(new Event('finance-access-required'));
        throw new Error((data as any).error || 'Tidak dapat memuat laporan.');
      }
      setStats(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Gagal memuat Finance Warehouse.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void fetchStats([], selectedOutlets, [], 'running');
    fetch('/api/outlets').then((response) => response.json()).then((data) => setOutlets(data.outlets || [])).catch(() => setOutlets([]));
  }, []);

  const displayItems = useMemo(() => {
    const all = stats.itemProfitability || [];
    return all.filter((item) => (!selectedItemIds.length || selectedItemIds.includes(String(item.itemId)))
      && (!selectedCategories.length || selectedCategories.includes(item.category)));
  }, [stats.itemProfitability, selectedItemIds, selectedCategories]);
  const totals = useMemo(() => ({
    purchaseQty: displayItems.reduce((sum, item) => sum + Number(item.purchaseQuantity || 0), 0),
    soldQty: displayItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    purchase: displayItems.reduce((sum, item) => sum + Number(item.totalPurchaseAmount || 0), 0),
    sales: displayItems.reduce((sum, item) => sum + Number(item.totalSellingAmount || 0), 0),
    profit: displayItems.reduce((sum, item) => sum + Number(item.totalProfit ?? 0), 0),
    missingCostQuantity: displayItems.reduce((sum, item) => sum + Number(item.missingCostQuantity || 0), 0),
  }), [displayItems]);
  const estimateTotals = warehouseEstimateTotals(displayItems);
  const categoryTotals = stats.categoryPurchaseTotals || [];
  const categoryGrandTotal = categoryTotals.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
  const financePeriods = stats.financePeriods || [];
  const currentPeriod = financePeriods.find((period) => period.id === selectedPeriodId) || financePeriods.find((period) => period.id === 'running');
  const viewer = stats.viewer;
  const lockedOutletId = viewer?.lockedOutletId ?? null;
  const outletIds = effectiveOutletIds(selectedOutlets, outlets);
  const activeFilterCount = Number(selectedItemIds.length > 0) + Number(selectedCategories.length > 0) + Number(outletIds.length > 0) + Number(selectedPeriodId !== 'running');
  const canReset = Boolean(activeFilterCount);

  const updateItemIds = (next: string[]) => { setSelectedItemIds(next); void fetchStats(next, outletIds, selectedCategories); };
  const updateOutletIds = (next: number[]) => {
    setSelectedOutlets(next);
    const ids = effectiveOutletIds(next, outlets);
    window.history.replaceState(window.history.state, '', withOutletParam(window.location.href, ids));
    void fetchStats(selectedItemIds, ids, selectedCategories);
  };
  const updateCategories = (next: string[]) => { setSelectedCategories(next); void fetchStats(selectedItemIds, outletIds, next); };
  const toggle = (values: string[], value: string, update: (next: string[]) => void) => update(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  const updatePeriod = (periodId: string) => { setSelectedPeriodId(periodId); void fetchStats(selectedItemIds, outletIds, selectedCategories, periodId); };
  const reset = () => {
    setSelectedPeriodId('running'); setSelectedItemIds([]); setSelectedOutlets([]); setSelectedCategories([]);
    window.history.replaceState(window.history.state, '', withOutletParam(window.location.href, []));
    void fetchStats([], [], [], 'running');
  };

  if (error) return <section className="hd-surface p-5"><p role="alert">{error}</p><button className="hd-button" onClick={() => void fetchStats()}>Coba lagi</button></section>;
  return <div className="space-y-3 sm:space-y-4">
    <header><h1 className="text-lg font-bold tracking-tight text-[#1E293B] sm:text-xl">{outletAccount ? 'Laporan Penjualan Outlet' : 'Finance Overview'}</h1><p className="mt-0.5 text-xs text-[#64748B]">{outletAccount ? 'Barang yang dikirim gudang ke outlet Anda per periode Stock Opname.' : 'Stok, HPP, dan penjualan per periode Stock Opname. Periode yang sudah ditutup memakai data terkunci.'}</p></header>

    <div className={`grid grid-cols-1 gap-2 sm:gap-3 ${outletAccount ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`} aria-label="Ringkasan Finance">
      {!outletAccount && <KpiCard label="Total Pembelian" value={loading ? '…' : formatRupiah(totals.purchase)} icon={ShoppingBag} />}
      <KpiCard label="Total Penjualan Outlet" value={loading ? '…' : estimateTotals.sales === null ? 'Belum terverifikasi' : formatMoney(estimateTotals.sales)} icon={TrendingUp} tone="info" />
      {viewer?.showCost !== false && <KpiCard label="Estimasi Keuntungan" value={loading ? '…' : estimateTotals.profit === null ? 'Belum terverifikasi' : formatMoney(estimateTotals.profit)} icon={Banknote} tone={estimateTotals.profit === null ? 'warning' : estimateTotals.profit.startsWith('-') ? 'warning' : 'success'} />}
    </div>

    {!outletAccount && <><section className="overflow-hidden rounded-[10px] border border-[#E2E8F0] bg-white" aria-labelledby="category-purchase-heading">
      <h2 id="category-purchase-heading" className="border-b border-[#E2E8F0] px-3 py-2 text-xs font-semibold text-[#1E293B]">Rekap Pembelian per Kategori</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[360px] border-collapse text-xs">
        <thead className="bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B]"><tr><th className="px-3 py-1.5 text-left">Kategori</th><th className="px-3 py-1.5 text-right">Total Belanja</th></tr></thead>
        <tbody className="divide-y divide-[#E2E8F0] text-[#1E293B]">{CATEGORIES.map((category) => { const row = categoryTotals.find((entry) => entry.code === category.code); return <tr key={category.code}><th className="px-3 py-1.5 text-left font-medium">{category.name} <span className="text-[#64748B]">({category.code})</span></th><td className="px-3 py-1.5 text-right tabular-nums">{loading ? '…' : formatRupiah(row?.totalAmount || 0)}</td></tr>; })}</tbody>
        <tfoot className="border-t-2 border-[#E2E8F0] bg-[#F8FAFC] font-bold text-[#1E293B]"><tr><th className="px-3 py-1.5 text-left">Total Seluruh Pembelian</th><td className="px-3 py-1.5 text-right tabular-nums">{loading ? '…' : formatRupiah(categoryGrandTotal)}</td></tr></tfoot>
      </table></div>
    </section>

    <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs">
      <span className="text-[#64748B]">Penyesuaian Stock Opname <span className="text-[10px]">(terpisah dari pembelian dan HPP)</span></span>
      <strong className="tabular-nums text-[#1E293B]">{loading ? '…' : formatRupiah(Number(stats.inventoryAdjustmentAmount || 0))}</strong>
    </div></>}

    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-white p-2.5">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="finance-period-filter" className="text-[10px] font-semibold text-[#64748B]">Periode Stock Opname</label>
        <select id="finance-period-filter" value={selectedPeriodId} onChange={(event) => updatePeriod(event.target.value)} className="h-[34px] min-w-[190px] max-w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-xs text-[#1E293B] outline-none focus:border-[#F0002B]">
          {financePeriods.map((period) => <option key={period.id} value={period.id}>{period.label} · {period.status}{period.startDate ? ` · ${formatDateIndo(period.startDate)}` : ''}{period.endDate ? ` – ${formatDateIndo(period.endDate)}` : period.id === 'running' ? ' – sekarang' : ''}</option>)}
        </select>
      </div>
      {currentPeriod && <div className="flex min-h-[34px] items-center gap-2 text-[11px] text-[#64748B]">
        <span>{currentPeriod.startDate ? formatDateIndo(currentPeriod.startDate) : 'Transaksi pertama'} – {currentPeriod.endDate ? formatDateIndo(currentPeriod.endDate) : currentPeriod.id === 'all' ? 'sekarang' : 'sekarang'}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${currentPeriod.status === 'Closed' ? 'bg-slate-100 text-slate-700' : currentPeriod.status === 'Open' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{currentPeriod.status === 'Open' ? 'Berjalan' : currentPeriod.status === 'All' ? 'Semua' : 'Closed'}</span>
      </div>}
      <details className="relative"><summary className="flex h-[34px] cursor-pointer list-none items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-xs"><Package size={14} />{selectedItemIds.length ? `${selectedItemIds.length} barang` : `Barang (${(stats.itemList || []).length})`}<ChevronDown size={14} /></summary><div className="absolute z-20 mt-1 max-h-72 w-56 max-w-[calc(100vw-24px)] overflow-auto rounded-lg border border-[#E2E8F0] bg-white p-2 shadow-lg"><div className="mb-1 flex justify-between border-b pb-2 text-[11px]"><button type="button" onClick={() => updateItemIds((stats.itemList || []).map((item) => String(item.id)))} className="text-blue-700">Pilih Semua</button><button type="button" onClick={() => updateItemIds([])}>Reset</button></div>{(stats.itemList || []).map((item) => <label key={item.id} className="flex gap-2 p-1.5 text-xs"><input type="checkbox" checked={selectedItemIds.includes(String(item.id))} onChange={() => toggle(selectedItemIds, String(item.id), updateItemIds)} />{item.itemName}</label>)}</div></details>
      <details className="relative"><summary className="flex h-[34px] cursor-pointer list-none items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-xs"><Layers size={14} />{selectedCategories.length ? `${selectedCategories.length} kategori` : 'Kategori'}<ChevronDown size={14} /></summary><div className="absolute z-20 mt-1 w-52 rounded-lg border border-[#E2E8F0] bg-white p-2 shadow-lg">{CATEGORIES.map((category) => <label key={category.code} className="flex gap-2 p-1.5 text-xs"><input type="checkbox" checked={selectedCategories.includes(category.name)} onChange={() => toggle(selectedCategories, category.name, updateCategories)} />{category.name} ({category.code})</label>)}<button type="button" onClick={() => updateCategories([])} className="mt-1 border-t pt-2 text-[11px]">Hapus pilihan</button></div></details>
      <OutletFilter outlets={outlets} selected={selectedOutlets} onChange={updateOutletIds} lockedOutletId={lockedOutletId} />
      <button type="button" onClick={reset} disabled={!canReset} className="hd-button hd-button--secondary !h-[34px]" title="Reset filter"><RotateCcw size={14} />Reset</button>
      {!!activeFilterCount && <span className="text-[11px] text-[#64748B]">{activeFilterCount} Filter Aktif</span>}
    </div>

    <WarehouseFinanceTable rows={displayItems} loading={loading} period={stats.financePeriod ?? currentPeriod} outletFiltered={outletIds.length > 0 || lockedOutletId != null} showCost={viewer?.showCost !== false} outlets={outlets} />
  </div>;
};
