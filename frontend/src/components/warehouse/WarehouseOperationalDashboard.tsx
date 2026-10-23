import { Button, Input, KpiCard, StateMessage, Toolbar } from '../common/UI.tsx';
import { Boxes, Search, ShoppingBag, TriangleAlert } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, RotateCcw } from 'lucide-react';
import type { InventoryItem, PurchaseTransaction, User } from '../../types.ts';
import { formatRupiah } from '../../lib/format.ts';

const CATEGORIES = ['Raw Material', 'Support Material', 'Packaging'] as const;
const CATEGORY_ORDER: Record<(typeof CATEGORIES)[number], number> = {
  'Raw Material': 0,
  'Support Material': 1,
  Packaging: 2,
};

interface DashboardData {
  items: InventoryItem[];
  purchases: PurchaseTransaction[];
}

export const WarehouseOperationalDashboard: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [data, setData] = useState<DashboardData>({ items: [], purchases: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftEndDate, setDraftEndDate] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [stockSearch, setStockSearch] = useState('');

  const loadDashboard = async (start = startDate, end = endDate) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
      const credentials = currentUser as User & { password?: string };
      const response = await fetch(`/api/dashboard/warehouse-ops-stats${params.size ? `?${params}` : ''}`, {
        headers: {
          'X-Auth-Email': currentUser.email,
          'X-Auth-Password': credentials.password || '',
        },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Gagal memuat dashboard');
      setData({ items: result.items || [], purchases: result.purchases || [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadDashboard(); }, []);

  const filteredItems = useMemo(() => data.items.filter((item) =>
    (!selectedItemIds.length || selectedItemIds.includes(item.id)) &&
    (!selectedCategories.length || selectedCategories.includes(item.category)) &&
    `${item.itemName} ${item.itemCode}`.toLocaleLowerCase('id-ID').includes(stockSearch.trim().toLocaleLowerCase('id-ID'))
  ).sort((a, b) =>
    CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
    a.itemCode.localeCompare(b.itemCode, 'en', { numeric: true, sensitivity: 'base' })
  ), [data.items, selectedItemIds, selectedCategories, stockSearch]);

  const selectedInventory = useMemo(() => data.items.filter((item) =>
    (!selectedItemIds.length || selectedItemIds.includes(item.id)) &&
    (!selectedCategories.length || selectedCategories.includes(item.category))
  ), [data.items, selectedItemIds, selectedCategories]);

  const filteredItemIds = useMemo(() => new Set(selectedInventory.map((item) => item.id)), [selectedInventory]);
  const totalPurchases = useMemo(() => data.purchases.reduce((total, purchase) =>
    total + (purchase.items || []).reduce((sum, line) =>
      sum + (filteredItemIds.has(line.itemId) ? Number(line.quantity) * Number(line.price) : 0), 0), 0
  ), [data.purchases, filteredItemIds]);
  const outOfStockCount = selectedInventory.filter((item) => Number(item.currentStock || 0) <= 0).length;

  const resetFilters = () => {
    setSelectedItemIds([]);
    setSelectedCategories([]);
    setDraftStartDate('');
    setDraftEndDate('');
    setStartDate('');
    setEndDate('');
    void loadDashboard('', '');
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[#1E293B]">Warehouse Overview</h1>
          <p className="mt-0.5 text-xs text-[#64748B]">Pantau pembelian dan ketersediaan stok gudang.</p>
        </div>
        <Button onClick={() => void loadDashboard()} variant="secondary" className="px-3 py-2">
          <RotateCcw className="h-3.5 w-3.5" /> Muat ulang
        </Button>
      </header>

      <section aria-label="Ringkasan operasional gudang" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Total Pembelian Barang" value={loading ? 'Memuat…' : formatRupiah(totalPurchases)} icon={ShoppingBag} description="Sesuai periode dan filter barang/kategori" />
        <KpiCard label="Total Jenis Barang" value={loading ? 'Memuat…' : selectedInventory.length.toLocaleString('id-ID')} icon={Boxes} description="Barang sesuai filter operasional" />
        <KpiCard label="Barang Stok Habis" value={loading ? 'Memuat…' : outOfStockCount.toLocaleString('id-ID')} icon={TriangleAlert} tone={outOfStockCount ? 'warning' : 'success'} description="Stok saat ini bernilai nol" />
      </section>

      <Toolbar aria-label="Filter dashboard" className="hd-filter-toolbar">
        <label className="text-[11px] font-semibold text-[#64748B]">Dari tanggal
          <span className="mt-1 flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-[#1E293B]"><CalendarDays className="h-3.5 w-3.5 text-[#64748B]" /><input aria-label="Dari tanggal" type="date" value={draftStartDate} onChange={(e) => setDraftStartDate(e.target.value)} className="w-[126px] bg-transparent text-xs outline-none" /></span>
        </label>
        <label className="text-[11px] font-semibold text-[#64748B]">Sampai tanggal
          <span className="mt-1 flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-[#1E293B]"><CalendarDays className="h-3.5 w-3.5 text-[#64748B]" /><input aria-label="Sampai tanggal" type="date" value={draftEndDate} onChange={(e) => setDraftEndDate(e.target.value)} className="w-[126px] bg-transparent text-xs outline-none" /></span>
        </label>
        <details className="relative">
          <summary className="flex min-h-[34px] cursor-pointer list-none items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 text-xs font-semibold text-[#334155]">Barang ({selectedItemIds.length || 'Semua'}) <ChevronDown className="h-3.5 w-3.5" /></summary>
          <div className="absolute left-0 top-10 z-20 max-h-64 w-64 overflow-auto rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-lg">
            {data.items.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-slate-50">
              <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={() => setSelectedItemIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
              <span className="truncate">{item.itemCode} · {item.itemName}</span>
            </label>)}
          </div>
        </details>
        <details className="relative">
          <summary className="flex min-h-[34px] cursor-pointer list-none items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 text-xs font-semibold text-[#334155]">Kategori ({selectedCategories.length || 'Semua'}) <ChevronDown className="h-3.5 w-3.5" /></summary>
          <div className="absolute left-0 top-10 z-20 w-52 rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-lg">
            {CATEGORIES.map((category) => <label key={category} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-slate-50">
              <input type="checkbox" checked={selectedCategories.includes(category)} onChange={() => setSelectedCategories((current) => current.includes(category) ? current.filter((value) => value !== category) : [...current, category])} />
              {category}
            </label>)}
          </div>
        </details>
        <button onClick={() => { setStartDate(draftStartDate); setEndDate(draftEndDate); void loadDashboard(draftStartDate, draftEndDate); }} className="min-h-[34px] rounded-lg bg-[#F0002B] px-3 text-xs font-bold text-white hover:bg-[#D80027]">Terapkan</button>
        <button onClick={resetFilters} className="min-h-[34px] rounded-lg px-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50">Reset</button>
      </Toolbar>

      {error && <StateMessage kind="error">{error}</StateMessage>}

      <section aria-labelledby="warehouse-stock-heading" className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8EDF4] px-4 py-3">
          <div>
            <h2 id="warehouse-stock-heading" className="text-sm font-bold text-[#1E293B]">Stok Saat Ini</h2>
            <p className="mt-0.5 text-[11px] text-[#64748B]">Status ketersediaan diperbarui mengikuti stok Inventory.</p>
          </div>
          <label className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" aria-hidden="true" />
            <Input aria-label="Cari nama atau kode barang" placeholder="Cari nama atau kode barang" value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="!min-h-[34px] !pl-8 !text-xs" />
          </label>
          <span className="text-[11px] text-[#64748B]">{loading ? 'Memuat…' : `${filteredItems.length} barang`}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="bg-[#F8FAFC] text-[10px] uppercase tracking-wide text-[#64748B]"><tr>
              <th className="px-4 py-2.5 font-bold">Kode Barang</th><th className="px-4 py-2.5 font-bold">Nama Barang</th><th className="px-4 py-2.5 font-bold">Kategori</th><th className="px-4 py-2.5 text-right font-bold">Satuan</th><th className="px-4 py-2.5 text-right font-bold">Stok Saat Ini</th>
            </tr></thead>
            <tbody className="divide-y divide-[#EEF2F7]">
              {filteredItems.map((item) => {
                const stock = Number(item.currentStock || 0);
                const stockState = stock <= 0 ? 'habis' : stock < 10 ? 'menipis' : 'tersedia';
                return <tr key={item.id} className="text-[#334155] hover:bg-slate-50/70">
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px]">{item.itemCode}</td><td className="px-4 py-2.5 font-semibold text-[#1E293B]">{item.itemName}</td><td className="px-4 py-2.5">{item.category}</td><td className="px-4 py-2.5 text-right text-[#64748B]">pcs</td><td className="px-4 py-2.5 text-right"><span className="inline-flex items-center gap-2 font-bold tabular-nums">{stock.toLocaleString('id-ID')}<span className={`hd-stock-status hd-stock-status--${stockState}`}>{stockState === 'habis' ? 'Habis' : stockState === 'menipis' ? 'Menipis' : 'Tersedia'}</span></span></td>
              </tr>;})}
              {!loading && filteredItems.length === 0 && <tr><td colSpan={5}><StateMessage>{stockSearch ? 'Tidak ada barang yang cocok dengan pencarian.' : 'Tidak ada barang untuk filter ini.'}</StateMessage></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
