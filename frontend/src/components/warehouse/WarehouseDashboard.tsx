import React, { useEffect, useState, useMemo } from 'react';
import {
  Package,
  Calendar,
  RotateCcw,
  Filter,
  ClockAlert,
  Store,
  Layers,
} from 'lucide-react';
import { WarehouseStats } from '../../types.ts';
import { formatRupiah } from '../../lib/format.ts';
import { OUTLETS } from '../../constants/outlets.ts';

const DASHBOARD_CATEGORIES = [
  { name: 'Raw Material', code: 'RM' },
  { name: 'Support Material', code: 'SM' },
  { name: 'Packaging', code: 'PKG' },
] as const;

export const WarehouseDashboard: React.FC = () => {
  const [stats, setStats] = useState<WarehouseStats>({
    totalStock: 0,
    barangMasukPcs: 0,
    barangKeluarPcs: 0,
    requestPending: 0,
    recentTransactions: [],
    totalPurchaseAmount: 0,
    totalSellingAmount: 0,
    totalProfit: 0,
    totalQuantity: 0,
    itemProfitability: [],
    itemList: [],
  });

  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const fetchStats = async (start = startDate, end = endDate, itemIds = selectedItemIds, outlets = selectedOutlets, categories = selectedCategories) => {
    try {
      setLoading(true);
      let url = '/api/dashboard/warehouse-stats';
      const params = new URLSearchParams();
      if (start) params.append('startDate', start);
      if (end) params.append('endDate', end);
      if (itemIds.length) params.append('itemIds', itemIds.join(','));
      if (outlets.length) params.append('outletNames', outlets.join(','));
      if (categories.length) params.append('categories', categories.join(','));
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      const data: WarehouseStats = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to load warehouse stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(startDate, endDate);
  }, []);

  const handleApplyDateFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setStartDate(filterStartDate);
    setEndDate(filterEndDate);
    fetchStats(filterStartDate, filterEndDate);
  };

  const handleResetFilters = () => {
    setFilterStartDate('');
    setFilterEndDate('');
    setStartDate('');
    setEndDate('');
    setSelectedItemIds([]);
    setSelectedOutlets([]);
    setSelectedCategories([]);
    fetchStats('', '', [], [], []);
  };

  // Filtered profitability data comes from the warehouse stats API.
  const displayItems = useMemo(() => {
    const all = stats.itemProfitability || [];
    return selectedItemIds.length ? all.filter((it) => selectedItemIds.includes(String(it.itemId))) : all;
  }, [stats.itemProfitability, selectedItemIds]);

  // Dynamic summary values calculated based on filtered items
  const summaryTotals = useMemo(() => {
    const totalQty = displayItems.reduce((acc, it) => acc + it.quantity, 0);
    const totalPurchase = displayItems.reduce((acc, it) => acc + it.totalPurchaseAmount, 0);
    const totalSelling = displayItems.reduce((acc, it) => acc + it.totalSellingAmount, 0);
    const totalProfit = displayItems.reduce((acc, it) => acc + it.totalProfit, 0);
    const purchaseQty = displayItems.reduce((acc, it) => acc + it.purchaseQuantity, 0);
    const currentStock = displayItems.reduce((acc, it) => acc + Number(it.currentStock || 0), 0);

    return {
      totalQty,
      purchaseQty,
      totalPurchase,
      totalSelling,
      totalProfit,
      currentStock,
    };
  }, [displayItems]);

  const hasActiveFilters = Boolean(startDate || endDate || selectedItemIds.length || selectedOutlets.length || selectedCategories.length);
  const categoryPurchaseTotals = stats.categoryPurchaseTotals || [];
  const categoryPurchaseGrandTotal = categoryPurchaseTotals.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);

  const updateItemSelection = (next: string[]) => {
    setSelectedItemIds(next);
    fetchStats(startDate, endDate, next, selectedOutlets);
  };
  const updateOutletSelection = (next: string[]) => {
    setSelectedOutlets(next);
    fetchStats(startDate, endDate, selectedItemIds, next);
  };
  const updateCategorySelection = (next: string[]) => {
    setSelectedCategories(next);
    fetchStats(startDate, endDate, selectedItemIds, selectedOutlets, next);
  };
  const toggleItem = (value: string) => updateItemSelection(selectedItemIds.includes(value) ? selectedItemIds.filter((entry) => entry !== value) : [...selectedItemIds, value]);
  const toggleOutlet = (value: string) => updateOutletSelection(selectedOutlets.includes(value) ? selectedOutlets.filter((entry) => entry !== value) : [...selectedOutlets, value]);

  const itemOptions = stats.itemList || [];

  return (
    <div className="space-y-3 sm:space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg sm:text-2xl font-bold text-[#17233D] tracking-tight">Warehouse Dashboard</h1>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] bg-[#FFF8E6] text-[#B27B00] text-xs font-semibold border border-[#FFE7A3]">
          <ClockAlert aria-hidden="true" className="w-3.5 h-3.5" />
          Request Pending: {loading ? '...' : stats.requestPending}
        </span>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3" aria-label="Ringkasan Warehouse">
        <div className="min-w-0 bg-white px-3 py-2.5 sm:px-4 sm:py-3 rounded-[12px] border border-[#DDE5F0] shadow-2xs">
          <p className="text-[11px] sm:text-xs font-semibold text-[#60708C]">Total Pembelian</p>
          <p className="mt-1 text-sm sm:text-lg font-bold text-[#17233D] tabular-nums break-words">
            {loading ? '...' : formatRupiah(summaryTotals.totalPurchase)}
          </p>
        </div>
        <div className="min-w-0 bg-white px-3 py-2.5 sm:px-4 sm:py-3 rounded-[12px] border border-[#DDE5F0] shadow-2xs">
          <p className="text-[11px] sm:text-xs font-semibold text-[#60708C]">Total Penjualan</p>
          <p className="mt-1 text-sm sm:text-lg font-bold text-[#1D63D8] tabular-nums break-words">
            {loading ? '...' : formatRupiah(summaryTotals.totalSelling)}
          </p>
        </div>
        <div className="min-w-0 bg-white px-3 py-2.5 sm:px-4 sm:py-3 rounded-[12px] border border-[#DDE5F0] shadow-2xs">
          <p className="text-[11px] sm:text-xs font-semibold text-[#60708C]">Total Keuntungan</p>
          <p className={`mt-1 text-sm sm:text-lg font-bold tabular-nums break-words ${summaryTotals.totalProfit >= 0 ? 'text-[#1B9357]' : 'text-[#ED002B]'}`}>
            {loading ? '...' : (summaryTotals.totalProfit > 0 ? '+' : '') + formatRupiah(summaryTotals.totalProfit)}
          </p>
        </div>
      </div>

      <section aria-labelledby="category-purchase-heading" className="bg-white rounded-[12px] border border-[#DDE5F0] shadow-2xs overflow-hidden">
        <div className="px-3 sm:px-4 py-2.5 border-b border-[#DDE5F0] flex flex-wrap items-center justify-between gap-1.5">
          <h2 id="category-purchase-heading" className="text-xs sm:text-sm font-bold text-[#17233D]">Rekap Pembelian per Kategori</h2>
          <span className="text-[10px] sm:text-xs text-[#60708C]">Berdasarkan transaksi penerimaan barang</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-xs border-collapse">
            <thead className="bg-[#F8FAFC] text-[10px] sm:text-[11px] font-semibold text-[#60708C]">
              <tr className="border-b border-[#DDE5F0]">
                <th scope="col" className="px-3 sm:px-4 py-2 text-left">Kategori</th>
                <th scope="col" className="px-3 sm:px-4 py-2 text-right">Total Belanja</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE5F0] text-[#17233D]">
              {categoryPurchaseTotals.map((row) => (
                <tr key={row.code}>
                  <th scope="row" className="px-3 sm:px-4 py-2 text-left font-medium">{row.category} <span className="text-[#60708C]">({row.code})</span></th>
                  <td className="px-3 sm:px-4 py-2 text-right tabular-nums">{loading ? '...' : formatRupiah(row.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[#F8FAFC] border-t-2 border-[#DDE5F0] text-[#17233D] font-bold">
              <tr>
                <th scope="row" className="px-3 sm:px-4 py-2 text-left">Total Seluruh Pembelian</th>
                <td className="px-3 sm:px-4 py-2 text-right tabular-nums">{loading ? '...' : formatRupiah(categoryPurchaseGrandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* 2. Filter Barang dan Rentang Tanggal */}
      <div className="bg-white p-3 rounded-[12px] border border-[#DDE5F0] shadow-2xs">
        <form
          onSubmit={handleApplyDateFilter}
          className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5"
        >
          {/* Filter Barang multi-select (data dari Inventory) */}
          <div className="flex-1 min-w-0 md:max-w-xs">
            <label className="block text-[10px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider mb-1">
              Filter Barang
            </label>
            <details className="relative group">
              <summary className="list-none flex items-center bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[14px] px-2.5 py-1.5 sm:py-2 min-h-[36px] sm:min-h-[40px] cursor-pointer text-xs sm:text-sm font-semibold text-[#17233D]">
                <Package className="w-3.5 h-3.5 text-[#60708C] mr-2 shrink-0" />
                <span className="truncate">{selectedItemIds.length ? `${selectedItemIds.length} barang dipilih` : `Semua Barang (${itemOptions.length})`}</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full min-w-[240px] max-h-72 overflow-auto rounded-xl border border-[#DDE5F0] bg-white p-2 shadow-lg">
                <div className="flex justify-between gap-2 border-b border-[#DDE5F0] pb-2 mb-1 text-xs">
                <button type="button" onClick={() => updateItemSelection(itemOptions.map((it) => String(it.id)))} className="font-bold text-[#1D63D8]">Select All</button>
                  <button type="button" onClick={() => updateItemSelection([])} className="font-semibold text-[#60708C]">Clear Selection</button>
                </div>
                {itemOptions.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-[#17233D] hover:bg-[#F8FAFC] cursor-pointer">
                    <input type="checkbox" checked={selectedItemIds.includes(String(it.id))} onChange={() => toggleItem(String(it.id))} />
                    {it.itemName}
                  </label>
                ))}
              </div>
            </details>
          </div>

          <div className="flex-1 min-w-0 md:max-w-xs">
            <label className="block text-[10px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider mb-1">Filter Kategori</label>
            <details className="relative group">
              <summary className="list-none flex items-center bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[14px] px-2.5 py-1.5 sm:py-2 min-h-[36px] sm:min-h-[40px] cursor-pointer text-xs sm:text-sm font-semibold text-[#17233D]">
                <Layers className="w-3.5 h-3.5 text-[#60708C] mr-2 shrink-0" />
                <span className="truncate">{selectedCategories.length ? `${selectedCategories.length} kategori dipilih` : 'Semua Kategori'}</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full min-w-[240px] rounded-xl border border-[#DDE5F0] bg-white p-2 shadow-lg">
                <div className="border-b border-[#DDE5F0] pb-2 mb-1 text-xs">
                  <button type="button" onClick={() => updateCategorySelection([])} className="font-bold text-[#1D63D8]">Semua Kategori</button>
                </div>
                {DASHBOARD_CATEGORIES.map((category) => (
                  <label key={category.code} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-[#17233D] hover:bg-[#F8FAFC] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!selectedCategories.length || selectedCategories.includes(category.name)}
                      onChange={() => {
                        const current = selectedCategories.length ? selectedCategories : DASHBOARD_CATEGORIES.map((entry) => entry.name);
                        updateCategorySelection(current.includes(category.name)
                          ? current.filter((entry) => entry !== category.name)
                          : [...current, category.name]);
                      }}
                    />
                    {category.name} ({category.code})
                  </label>
                ))}
                {!!selectedCategories.length && <button type="button" onClick={() => updateCategorySelection([])} className="mt-1 border-t border-[#DDE5F0] w-full pt-2 text-left text-xs font-semibold text-[#60708C]">Clear Selection</button>}
              </div>
            </details>
          </div>

          <div className="flex-1 min-w-0 md:max-w-xs">
            <label className="block text-[10px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider mb-1">Filter Outlet</label>
            <details className="relative group">
              <summary className="list-none flex items-center bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[14px] px-2.5 py-1.5 sm:py-2 min-h-[36px] sm:min-h-[40px] cursor-pointer text-xs sm:text-sm font-semibold text-[#17233D]">
                <Store className="w-3.5 h-3.5 text-[#60708C] mr-2 shrink-0" />
                <span className="truncate">{selectedOutlets.length ? `${selectedOutlets.length} outlet dipilih` : `Semua Outlet (${OUTLETS.length})`}</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full min-w-[240px] max-h-72 overflow-auto rounded-xl border border-[#DDE5F0] bg-white p-2 shadow-lg">
                <div className="flex justify-between gap-2 border-b border-[#DDE5F0] pb-2 mb-1 text-xs">
                  <button type="button" onClick={() => updateOutletSelection([...OUTLETS])} className="font-bold text-[#1D63D8]">Select All</button>
                  <button type="button" onClick={() => updateOutletSelection([])} className="font-semibold text-[#60708C]">Clear Selection</button>
                </div>
                {OUTLETS.map((outlet) => (
                  <label key={outlet} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-[#17233D] hover:bg-[#F8FAFC] cursor-pointer">
                    <input type="checkbox" checked={selectedOutlets.includes(outlet)} onChange={() => toggleOutlet(outlet)} />
                    {outlet}
                  </label>
                ))}
              </div>
            </details>
          </div>

          {/* Filter Rentang Tanggal (Data dari Riwayat / Request) */}
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider mb-1">
              Rentang Tanggal
            </label>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex items-center space-x-1 sm:space-x-1.5 bg-[#F8FAFC] border border-[#DDE5F0] px-2 sm:px-3 py-1.5 sm:py-2 rounded-[10px] sm:rounded-[14px] flex-1 min-w-0 min-h-[36px] sm:min-h-[40px] focus-within:border-[#ED002B] transition-colors">
                <Calendar className="w-3.5 h-3.5 text-[#60708C] shrink-0" />
                <input
                  id="date-filter-start"
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  placeholder="Mulai"
                  className="text-xs sm:text-sm text-[#17233D] bg-transparent outline-none cursor-pointer w-full min-w-0 p-0 font-medium"
                />
                <span className="text-[#60708C] text-xs px-1 shrink-0">—</span>
                <input
                  id="date-filter-end"
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  placeholder="Akhir"
                  className="text-xs sm:text-sm text-[#17233D] bg-transparent outline-none cursor-pointer w-full min-w-0 p-0 font-medium"
                />
              </div>

              {/* Tombol Filter & Reset */}
              <button
                id="btn-apply-dashboard-filter"
                type="submit"
                className="px-3 sm:px-4 py-1.5 sm:py-2 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs sm:text-sm font-bold rounded-[10px] sm:rounded-[14px] transition-colors shadow-2xs min-h-[36px] sm:min-h-[40px] cursor-pointer shrink-0 flex items-center space-x-1"
              >
                <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>Terapkan</span>
              </button>

              {hasActiveFilters && (
                <button
                  id="btn-reset-dashboard-filter"
                  type="button"
                  onClick={handleResetFilters}
                  className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-white hover:bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D] text-xs sm:text-sm font-semibold rounded-[10px] sm:rounded-[14px] border border-[#DDE5F0] transition-colors min-h-[36px] sm:min-h-[40px] cursor-pointer shrink-0 flex items-center space-x-1"
                  title="Reset Semua Filter"
                >
                  <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline">Reset</span>
                </button>
              )}
            </div>
          </div>
        </form>

        {hasActiveFilters && (
          <div className="mt-2.5 pt-2.5 border-t border-[#DDE5F0]/60 flex flex-wrap items-center gap-1.5 text-[10px] sm:text-xs text-[#60708C]">
            <span className="font-semibold text-[#17233D]">Filter aktif:</span>
            {selectedItemIds.length > 0 && (
              <span className="bg-[#EAF2FE] text-[#1D63D8] px-2 py-0.5 rounded-full font-bold">
                Barang: {selectedItemIds.length} dipilih
              </span>
            )}
            {selectedOutlets.length > 0 && <span className="bg-[#EAF2FE] text-[#1D63D8] px-2 py-0.5 rounded-full font-bold">Outlet: {selectedOutlets.length} dipilih</span>}
            {selectedCategories.length > 0 && <span className="bg-[#EAF2FE] text-[#1D63D8] px-2 py-0.5 rounded-full font-bold">Kategori: {selectedCategories.length} dipilih</span>}
            {(startDate || endDate) && (
              <span className="bg-[#FFF8E6] text-[#B27B00] px-2 py-0.5 rounded-full font-bold">
                Periode: {startDate || 'Awal'} s/d {endDate || 'Hari ini'}
              </span>
            )}
          </div>
        )}
      </div>

      <section aria-labelledby="warehouse-detail-heading" className="bg-white rounded-[14px] border border-[#DDE5F0] overflow-hidden shadow-xs">
        <div className="px-3 sm:px-4 py-3 border-b border-[#DDE5F0] flex flex-wrap items-center justify-between gap-1.5">
          <h2 id="warehouse-detail-heading" className="text-sm font-bold text-[#17233D]">Rincian Barang</h2>
          <span className="text-xs text-[#60708C]">{displayItems.length} barang</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-xs text-right border-collapse">
            <thead className="bg-[#F8FAFC] text-[11px] font-semibold text-[#60708C]">
              <tr className="border-b border-[#DDE5F0]">
                <th scope="col" rowSpan={2} className="px-3 py-2 text-left">Nama Barang</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 border-l border-[#DDE5F0]">Stok Saat Ini</th>
                <th scope="colgroup" colSpan={3} className="px-3 py-2 text-center border-l border-[#DDE5F0]">Pembelian Barang</th>
                <th scope="colgroup" colSpan={3} className="px-3 py-2 text-center border-l border-[#DDE5F0]">Penjualan ke Outlet</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 border-l border-[#DDE5F0]">
                  Keuntungan
                  <span className="block text-[10px] font-normal mt-0.5">(Katalog − rata-rata beli) × qty terjual</span>
                </th>
              </tr>
              <tr className="border-b border-[#DDE5F0]">
                <th scope="col" className="px-3 py-2 border-l border-[#DDE5F0]">Qty Masuk</th>
                <th scope="col" className="px-3 py-2">Rata-rata Beli</th>
                <th scope="col" className="px-3 py-2">Total Pembelian</th>
                <th scope="col" className="px-3 py-2 border-l border-[#DDE5F0]">Qty Terjual</th>
                <th scope="col" className="px-3 py-2">Harga Katalog</th>
                <th scope="col" className="px-3 py-2">Total Penjualan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE5F0] text-[#17233D] tabular-nums">
              {loading ? (
                <tr><td colSpan={9} className="py-8 text-center text-[#60708C]">Memuat data...</td></tr>
              ) : displayItems.length > 0 ? displayItems.map((item) => (
                <tr key={item.itemId} className="hover:bg-[#F8FAFC]">
                  <th scope="row" className="px-3 py-2.5 text-left font-semibold">{item.itemName}</th>
                  <td className="px-3 py-2.5 whitespace-nowrap border-l border-[#DDE5F0]">{Number(item.currentStock).toLocaleString('id-ID')} pcs</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{Number(item.purchaseQuantity).toLocaleString('id-ID')} pcs</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[#60708C]">{formatRupiah(item.avgPurchasePrice)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{formatRupiah(item.totalPurchaseAmount)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{Number(item.quantity).toLocaleString('id-ID')} pcs</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[#60708C]">{formatRupiah(item.catalogPrice)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{formatRupiah(item.totalSellingAmount)}</td>
                  <td className={`px-3 py-2.5 whitespace-nowrap font-semibold ${item.totalProfit >= 0 ? 'text-[#1B9357]' : 'text-[#ED002B]'}`}>
                    {formatRupiah(item.totalProfit)}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={9} className="py-8 text-center text-[#60708C]">Tidak ada barang pada filter ini.</td></tr>
              )}
            </tbody>
            {!loading && displayItems.length > 0 && (
              <tfoot className="bg-[#F8FAFC] border-t-2 border-[#DDE5F0] text-[#17233D] font-bold tabular-nums">
                <tr>
                  <th scope="row" className="px-3 py-3 text-left">Total</th>
                  <td className="px-3 py-3 whitespace-nowrap">{Number(summaryTotals.currentStock).toLocaleString('id-ID')} pcs</td>
                  <td className="px-3 py-3 whitespace-nowrap">{Number(summaryTotals.purchaseQty).toLocaleString('id-ID')} pcs</td>
                  <td className="px-3 py-3">—</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatRupiah(summaryTotals.totalPurchase)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{Number(summaryTotals.totalQty).toLocaleString('id-ID')} pcs</td>
                  <td className="px-3 py-3">—</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatRupiah(summaryTotals.totalSelling)}</td>
                  <td className={`px-3 py-3 whitespace-nowrap ${summaryTotals.totalProfit >= 0 ? 'text-[#1B9357]' : 'text-[#ED002B]'}`}>
                    {formatRupiah(summaryTotals.totalProfit)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

    </div>
  );
};
