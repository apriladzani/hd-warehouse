import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Layers, Package, RotateCcw, ShoppingBag, Store, TrendingUp, Banknote } from 'lucide-react';
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
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const credentials = currentUser as User & { password?: string };

  const fetchStats = async (itemIds = selectedItemIds, outletIds = selectedOutlets, categories = selectedCategories, periodId = selectedPeriodId) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('periodId', periodId);
      if (itemIds.length) params.set('itemIds', itemIds.join(','));
      if (outletIds.length) params.set('outletIds', outletIds.join(','));
      if (categories.length) params.set('categories', categories.join(','));
      const response = await fetch(`/api/dashboard/finance-stats${params.size ? `?${params}` : ''}`, {
        headers: { 'X-Auth-Email': currentUser.email, 'X-Auth-Password': credentials.password || '' },
      });
      const data: WarehouseStats = await response.json();
      if (!response.ok) {
        if ((data as any).code === 'FINANCE_ACCESS_REQUIRED') window.dispatchEvent(new Event('finance-access-required'));
        throw new Error((data as any).error || 'Tidak dapat memuat dashboard Finance.');
      }
      setStats(data);
    } catch (error) {
      console.error('Gagal memuat dashboard Finance:', error);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void fetchStats([], [], [], 'running');
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
    stock: displayItems.reduce((sum, item) => sum + Number(item.currentStock || 0), 0),
    purchase: displayItems.reduce((sum, item) => sum + Number(item.totalPurchaseAmount || 0), 0),
    sales: displayItems.reduce((sum, item) => sum + Number(item.totalSellingAmount || 0), 0),
    profit: displayItems.reduce((sum, item) => sum + Number(item.totalProfit ?? 0), 0),
    missingCostQuantity: displayItems.reduce((sum, item) => sum + Number(item.missingCostQuantity || 0), 0),
  }), [displayItems]);
  const categoryTotals = stats.categoryPurchaseTotals || [];
  const categoryGrandTotal = categoryTotals.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
  const financePeriods = stats.financePeriods || [];
  const currentPeriod = financePeriods.find((period) => period.id === selectedPeriodId) || financePeriods.find((period) => period.id === 'running');
  const activeFilterCount = Number(selectedItemIds.length > 0) + Number(selectedCategories.length > 0) + Number(selectedOutlets.length > 0) + Number(selectedPeriodId !== 'running');
  const canReset = Boolean(activeFilterCount);

  const updateItemIds = (next: string[]) => { setSelectedItemIds(next); void fetchStats(next, selectedOutlets, selectedCategories); };
  const updateOutletIds = (next: string[]) => { setSelectedOutlets(next); void fetchStats(selectedItemIds, next, selectedCategories); };
  const updateCategories = (next: string[]) => { setSelectedCategories(next); void fetchStats(selectedItemIds, selectedOutlets, next); };
  const toggle = (values: string[], value: string, update: (next: string[]) => void) => update(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  const updatePeriod = (periodId: string) => { setSelectedPeriodId(periodId); void fetchStats(selectedItemIds, selectedOutlets, selectedCategories, periodId); };
  const reset = () => { setSelectedPeriodId('running'); setSelectedItemIds([]); setSelectedOutlets([]); setSelectedCategories([]); void fetchStats([], [], [], 'running'); };

  return <div className="space-y-3 sm:space-y-4">
    <header><h1 className="text-lg font-bold tracking-tight text-[#1E293B] sm:text-xl">Finance Overview</h1><p className="mt-0.5 text-xs text-[#64748B]">Pembelian Warehouse, penjualan ke Outlet, dan keuntungan transaksi.</p></header>

    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" aria-label="Ringkasan Finance">
      <KpiCard label="Total Pembelian" value={loading ? '…' : formatRupiah(totals.purchase)} icon={ShoppingBag} />
      <KpiCard label="Total Penjualan Outlet" value={loading ? '…' : formatRupiah(totals.sales)} icon={TrendingUp} tone="info" />
      <KpiCard label="Total Keuntungan" value={loading ? '…' : <span className="hd-profit-display" title={totals.missingCostQuantity ? 'Keuntungan belum final karena sebagian harga pokok belum tercatat.' : 'Keuntungan = penjualan disetujui − HPP berdasarkan snapshot atau rekonstruksi histori biaya.'}>{formatRupiah(totals.profit)}{totals.missingCostQuantity > 0 && <small>Harga pokok belum tercatat</small>}</span>} icon={Banknote} tone={totals.missingCostQuantity ? 'warning' : totals.profit >= 0 ? 'success' : 'warning'} />
    </div>

    <section className="overflow-hidden rounded-[10px] border border-[#E2E8F0] bg-white" aria-labelledby="category-purchase-heading">
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
    </div>

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
      <details className="relative"><summary className="flex h-[34px] cursor-pointer list-none items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-xs"><Store size={14} />{selectedOutlets.length ? `${selectedOutlets.length} outlet` : `Outlet (${outlets.length})`}<ChevronDown size={14} /></summary><div className="absolute z-20 mt-1 max-h-72 w-52 overflow-auto rounded-lg border border-[#E2E8F0] bg-white p-2 shadow-lg"><div className="mb-1 flex justify-between border-b pb-2 text-[11px]"><button type="button" onClick={() => updateOutletIds(outlets.map((outlet) => String(outlet.id)))} className="text-blue-700">Pilih Semua</button><button type="button" onClick={() => updateOutletIds([])}>Reset</button></div>{outlets.map((outlet) => <label key={outlet.id} className="flex gap-2 p-1.5 text-xs"><input type="checkbox" checked={selectedOutlets.includes(String(outlet.id))} onChange={() => toggle(selectedOutlets, String(outlet.id), updateOutletIds)} />{outlet.name}</label>)}</div></details>
      <button type="button" onClick={reset} disabled={!canReset} className="hd-button hd-button--secondary !h-[34px]" title="Reset filter"><RotateCcw size={14} />Reset</button>
      {!!activeFilterCount && <span className="text-[11px] text-[#64748B]">{activeFilterCount} Filter Aktif</span>}
    </div>

    <section className="overflow-hidden rounded-[10px] border border-[#E2E8F0] bg-white" aria-labelledby="finance-detail-heading">
      <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] px-3 py-2.5"><div><h2 id="finance-detail-heading" className="text-sm font-semibold text-[#1E293B]">Rincian Transaksi Keuangan</h2><p className="text-[11px] text-[#64748B]">Pembelian aktual, penjualan yang disetujui, HPP, dan keuntungan per barang.</p></div><span className="text-xs text-[#64748B]">{displayItems.length} barang</span></div>
      <div className="hd-finance-desktop-table"><table className="hd-finance-detail-table">
        <colgroup><col style={{ width: '18%' }} /><col style={{ width: '8%' }} /><col style={{ width: '11%' }} /><col style={{ width: '12%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /><col style={{ width: '10%' }} /><col style={{ width: '8%' }} /></colgroup>
        <thead><tr><th rowSpan={2} className="finance-name">Nama Barang</th><th colSpan={3} className="finance-group">Pembelian Barang</th><th colSpan={4} className="finance-group">Penjualan ke Outlet</th><th rowSpan={2}>Keuntungan</th></tr><tr><th>Qty Masuk</th><th>Rata-rata Beli</th><th>Total Pembelian</th><th>Qty Terjual</th><th>Harga Jual</th><th>Total Penjualan</th><th>HPP Terjual</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={9}><StateMessage kind="loading">Memuat laporan…</StateMessage></td></tr> : displayItems.length ? displayItems.map((item) => <tr key={item.itemId}><th className="finance-name" title={item.itemName}>{item.itemName}</th><td>{Number(item.purchaseQuantity).toLocaleString('id-ID')} pcs</td><td title={formatRupiah(item.avgPurchasePrice)}>{formatTableRupiah(item.avgPurchasePrice)}</td><td title={formatRupiah(item.totalPurchaseAmount)}>{formatTableRupiah(item.totalPurchaseAmount)}</td><td>{Number(item.quantity).toLocaleString('id-ID')} pcs</td><td title={formatRupiah(item.catalogPrice)}>{formatTableRupiah(item.catalogPrice)}</td><td title={formatRupiah(item.totalSellingAmount)}>{formatTableRupiah(item.totalSellingAmount)}</td><td title={item.missingCostQuantity ? 'Harga pokok tidak ditemukan pada snapshot, histori pembelian, atau cut-off yang relevan.' : 'HPP dihitung dari harga pokok transaksi yang tersimpan atau direkonstruksi dari histori biaya.'}>{item.missingCostQuantity ? <>{formatRupiah(0)}<small>Harga pokok belum tercatat</small></> : formatTableRupiah(item.totalCogsAmount)}</td><td className={item.totalProfit == null ? 'finance-unvalidated' : item.totalProfit >= 0 ? 'finance-positive' : 'finance-negative'} title={item.totalProfit == null ? 'Keuntungan belum final karena harga pokok belum dapat ditemukan.' : formatRupiah(item.totalProfit)}>{item.totalProfit == null ? <>{formatRupiah(0)}<small>Harga pokok belum tercatat</small></> : formatTableRupiah(item.totalProfit)}</td></tr>) : <tr><td colSpan={9}><StateMessage>Tidak ada barang pada filter ini.</StateMessage></td></tr>}
        </tbody>
        {!loading && displayItems.length > 0 && <tfoot><tr><th className="finance-name">Total</th><td>{totals.purchaseQty.toLocaleString('id-ID')} pcs</td><td>—</td><td title={formatRupiah(totals.purchase)}>{formatTableRupiah(totals.purchase)}</td><td>{totals.soldQty.toLocaleString('id-ID')} pcs</td><td>—</td><td title={formatRupiah(totals.sales)}>{formatTableRupiah(totals.sales)}</td><td title={totals.missingCostQuantity ? 'Sebagian harga pokok belum dapat ditemukan.' : undefined}>{formatTableRupiah(displayItems.reduce((sum, item) => sum + Number(item.totalCogsAmount || 0), 0))}{totals.missingCostQuantity > 0 && <small>Harga pokok belum tercatat</small>}</td><td className={totals.missingCostQuantity ? 'finance-unvalidated' : totals.profit >= 0 ? 'finance-positive' : 'finance-negative'} title={totals.missingCostQuantity ? 'Keuntungan belum final karena ada harga pokok yang belum tercatat.' : formatRupiah(totals.profit)}>{formatTableRupiah(totals.profit)}{totals.missingCostQuantity > 0 && <small>Belum tervalidasi</small>}</td></tr></tfoot>}
      </table></div>
      <div className="hd-finance-responsive-list">
        {loading ? <StateMessage kind="loading">Memuat laporan…</StateMessage> : displayItems.length ? <>{displayItems.map((item) => <article key={item.itemId} className="finance-compact-row"><h3>{item.itemName}</h3><dl>{[['Qty Masuk', `${Number(item.purchaseQuantity).toLocaleString('id-ID')} pcs`], ['Rata-rata Beli', formatRupiah(item.avgPurchasePrice)], ['Total Pembelian', formatRupiah(item.totalPurchaseAmount)], ['Qty Terjual', `${Number(item.quantity).toLocaleString('id-ID')} pcs`], ['Harga Jual', formatRupiah(item.catalogPrice)], ['Total Penjualan', formatRupiah(item.totalSellingAmount)], ['HPP Terjual', item.missingCostQuantity ? `${formatRupiah(0)} · Harga pokok belum tercatat` : formatRupiah(item.totalCogsAmount)], ['Keuntungan', item.totalProfit == null ? `${formatRupiah(0)} · Harga pokok belum tercatat` : formatRupiah(item.totalProfit)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={item.totalProfit == null && label === 'HPP Terjual' ? 'Harga pokok tidak ditemukan pada histori transaksi yang tersedia.' : undefined}>{value}</dd></div>)}</dl></article>)}<article className="finance-compact-row finance-compact-total"><h3>Total</h3><dl><div><dt>Qty Masuk</dt><dd>{totals.purchaseQty.toLocaleString('id-ID')} pcs</dd></div><div><dt>Rata-rata Beli</dt><dd>{displayItems.length ? 'Per Inventory' : '—'}</dd></div><div><dt>Total Pembelian</dt><dd>{formatRupiah(totals.purchase)}</dd></div><div><dt>Qty Terjual</dt><dd>{totals.soldQty.toLocaleString('id-ID')} pcs</dd></div><div><dt>Harga Jual</dt><dd>Harga katalog</dd></div><div><dt>Total Penjualan</dt><dd>{formatRupiah(totals.sales)}</dd></div><div><dt>HPP Terjual</dt><dd>{formatRupiah(displayItems.reduce((sum, item) => sum + Number(item.totalCogsAmount || 0), 0))}{totals.missingCostQuantity > 0 && ' · Harga pokok belum tercatat'}</dd></div><div><dt>Keuntungan</dt><dd>{formatRupiah(totals.profit)}{totals.missingCostQuantity > 0 && ' · Belum tervalidasi'}</dd></div></dl></article></> : <StateMessage>Tidak ada barang pada filter ini.</StateMessage>}
      </div>
    </section>
  </div>;
};
