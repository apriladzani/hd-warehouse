import { StateMessage } from '../common/UI.tsx';
import React, { useState, useEffect, useMemo } from 'react';
import { DateFilter } from '../common/DateFilter.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatDateIndo, formatRupiah } from '../../lib/format.ts';
import { PurchaseTransaction, OutgoingHistoryTransaction } from '../../types.ts';
import { TransactionDetailModal } from '../modals/TransactionDetailModal.tsx';
import { PrintableTransactionA4 } from '../modals/PrintableTransactionA4.tsx';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  Calendar,
  CalendarDays,
  Store,
  RotateCcw,
  Sparkles,
  Layers,
  Scale,
  FileSpreadsheet,
  Search,
} from 'lucide-react';

type PeriodFilterType = 'hari' | 'minggu' | 'bulan' | 'semua' | 'kustom';

export const WarehouseHistory: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing'>('incoming');
  const [activePeriod, setActivePeriod] = useState<PeriodFilterType>('semua');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedOutlets, setSelectedOutlets] = useState<number[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [historySearch, setHistorySearch] = useState('');

  const [incomingList, setIncomingList] = useState<PurchaseTransaction[]>([]);
  const [outgoingList, setOutgoingList] = useState<OutgoingHistoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTx, setSelectedTx] = useState<{
    type: 'incoming' | 'outgoing';
    data: any;
  } | null>(null);

  const [printA4Data, setPrintA4Data] = useState<{
    type: 'incoming' | 'outgoing';
    data: any;
  } | null>(null);

  // Helper to format Date to local YYYY-MM-DD
  const getLocalDateString = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Fetch both incoming & outgoing history for the date filter
  const fetchAllHistory = async (start = startDate, end = endDate) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (start) params.append('startDate', start);
      if (end) params.append('endDate', end);

      const [resInc, resOut] = await Promise.all([
        fetch(`/api/history/incoming?${params.toString()}`),
        fetch(`/api/history/outgoing?${params.toString()}`),
      ]);

      const dataInc = await resInc.json();
      const dataOut = await resOut.json();

      setIncomingList(dataInc.history || []);
      setOutgoingList(dataOut.history || []);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchAllHistory(startDate, endDate);
    fetch('/api/outlets').then((res) => res.json()).then((data) => setOutlets(data.outlets || [])).catch((err) => console.error('Failed to load outlets:', err));
  }, []);

  // Quick period presets: Hari, Minggu, Bulan, Semua
  const handlePeriodChange = (period: PeriodFilterType) => {
    const now = new Date();
    let start = '';
    let end = '';

    if (period === 'hari') {
      const todayStr = getLocalDateString(now);
      start = todayStr;
      end = todayStr;
    } else if (period === 'minggu') {
      // Monday to Sunday of current week
      const day = now.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      start = getLocalDateString(monday);
      end = getLocalDateString(sunday);
    } else if (period === 'bulan') {
      // 1st of current month to last day of current month
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      start = getLocalDateString(firstDay);
      end = getLocalDateString(lastDay);
    } else if (period === 'semua') {
      start = '';
      end = '';
    }

    setActivePeriod(period);
    setStartDate(start);
    setEndDate(end);
    fetchAllHistory(start, end);
  };

  // Custom date filter from DateFilter form
  const handleCustomFilter = (start: string, end: string) => {
    setActivePeriod('kustom');
    setStartDate(start);
    setEndDate(end);
    fetchAllHistory(start, end);
  };

  const handleResetFilter = () => {
    handlePeriodChange('semua');
    setSelectedOutlets([]);
  };

  // Filter outgoing list by selected outlet if any
  const itemOptions = useMemo(() => {
    const items = [...incomingList.flatMap((tx) => tx.items || []), ...outgoingList.flatMap((tx) => tx.items || [])];
    return [...new Map(items.map((item) => [item.itemId, { id: item.itemId, name: item.itemName || `Barang #${item.itemId}` }])).values()];
  }, [incomingList, outgoingList]);
  const matchesHistoryFilters = (tx: PurchaseTransaction | OutgoingHistoryTransaction) => {
    const isPurchase = 'transactionCode' in tx;
    const text = `${isPurchase ? tx.transactionCode : tx.requestCode} ${isPurchase ? tx.vendorName || tx.vendorCode || '' : tx.requesterName} ${tx.itemSummary || ''} ${(tx.items || []).map((item) => item.itemName || '').join(' ')}`.toLocaleLowerCase('id-ID');
    const itemMatches = !selectedItemIds.length || (tx.items || []).some((item) => selectedItemIds.includes(item.itemId));
    return itemMatches && text.includes(historySearch.trim().toLocaleLowerCase('id-ID'));
  };
  const filteredIncomingList = useMemo(() => incomingList.filter(matchesHistoryFilters), [incomingList, selectedItemIds, historySearch]);
  const filteredOutgoingList = useMemo(() => {
    if (!selectedOutlets.length) return outgoingList;
    return outgoingList.filter((tx) => tx.outletId != null && selectedOutlets.includes(Number(tx.outletId)));
  }, [outgoingList, selectedOutlets]);
  const displayedOutgoingList = useMemo(() => filteredOutgoingList.filter(matchesHistoryFilters), [filteredOutgoingList, selectedItemIds, historySearch]);

  // Aggregate stats based on current period filter
  const totalIncomingAmount = useMemo(() => {
    return incomingList.reduce((sum, tx) => sum + (tx.items || []).reduce((lineSum, line) =>
      Number(line.quantity) > 0 && Number(line.price) >= 0 && (!selectedItemIds.length || selectedItemIds.includes(line.itemId))
        ? lineSum + Number(line.quantity) * Number(line.price) : lineSum, 0), 0);
  }, [incomingList, selectedItemIds]);

  const totalIncomingQty = useMemo(() => {
    return incomingList.reduce((sum, tx) => sum + (tx.items || []).reduce((lineSum, line) =>
      Number(line.quantity) > 0 && Number(line.price) >= 0 && (!selectedItemIds.length || selectedItemIds.includes(line.itemId))
        ? lineSum + Number(line.quantity) : lineSum, 0), 0);
  }, [incomingList, selectedItemIds]);

  const totalOutgoingAmount = useMemo(() => {
    return filteredOutgoingList.reduce((sum, tx) => sum + (tx.items || []).reduce((lineSum, line) =>
      line.status === 'Approved' && Number(line.approvedQuantity) > 0 && (!selectedItemIds.length || selectedItemIds.includes(line.itemId))
        ? lineSum + Number(line.approvedQuantity) * Number(line.price) : lineSum, 0), 0);
  }, [filteredOutgoingList, selectedItemIds]);

  const totalOutgoingQty = useMemo(() => {
    return filteredOutgoingList.reduce((sum, tx) => sum + (tx.items || []).reduce((lineSum, line) =>
      line.status === 'Approved' && Number(line.approvedQuantity) > 0 && (!selectedItemIds.length || selectedItemIds.includes(line.itemId))
        ? lineSum + Number(line.approvedQuantity) : lineSum, 0), 0);
  }, [filteredOutgoingList, selectedItemIds]);

  // Dynamic period label
  const periodLabel = useMemo(() => {
    if (activePeriod === 'hari') {
      return `Hari Ini (${formatDateIndo(startDate)})`;
    }
    if (activePeriod === 'minggu') {
      return `Minggu Ini (${formatDateIndo(startDate)} — ${formatDateIndo(endDate)})`;
    }
    if (activePeriod === 'bulan') {
      const d = startDate ? new Date(startDate) : new Date();
      const monthName = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
      return `Bulan Ini (${monthName})`;
    }
    if (activePeriod === 'kustom' && (startDate || endDate)) {
      return `Kustom (${startDate ? formatDateIndo(startDate) : 'Awal'} — ${
        endDate ? formatDateIndo(endDate) : 'Sekarang'
      })`;
    }
    return 'Semua Periode Transaksi';
  }, [activePeriod, startDate, endDate]);

  return (
    <div className="hd-warehouse-history space-y-3">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#1E293B] tracking-tight">
            Riwayat Transaksi Gudang
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
            Arsip mutasi transaksi fisik barang masuk dan barang keluar.
          </p>
        </div>

        {/* Badge Periode Aktif */}
        <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-full bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] sm:text-xs text-[#1E293B] font-semibold self-start md:self-auto">
          <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#F0002B]" />
          <span>Periode: <strong className="text-[#1E293B]">{periodLabel}</strong></span>
        </div>
      </div>

      {/* Quick Filter Bar: Hari, Minggu, Bulan, Semua & Custom Date Picker */}
      <div className="hd-period-toolbar bg-white p-2 sm:p-4 rounded-xl border border-[#E2E8F0] space-y-1.5 sm:space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-1.5 sm:gap-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-2">
            <span className="text-[10px] sm:text-xs font-bold text-[#64748B] mr-0.5 hidden sm:inline uppercase tracking-wider">
              Filter:
            </span>

            <button
              id="filter-preset-hari"
              type="button"
              onClick={() => handlePeriodChange('hari')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-xl text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'hari'
                  ? 'bg-[#F0002B] text-white '
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#64748B] hover:text-[#1E293B] border border-[#E2E8F0]'
              }`}
            >
              📅 Hari Ini
            </button>

            <button
              id="filter-preset-minggu"
              type="button"
              onClick={() => handlePeriodChange('minggu')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-xl text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'minggu'
                  ? 'bg-[#F0002B] text-white '
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#64748B] hover:text-[#1E293B] border border-[#E2E8F0]'
              }`}
            >
              📆 Minggu Ini
            </button>

            <button
              id="filter-preset-bulan"
              type="button"
              onClick={() => handlePeriodChange('bulan')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-xl text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'bulan'
                  ? 'bg-[#F0002B] text-white '
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#64748B] hover:text-[#1E293B] border border-[#E2E8F0]'
              }`}
            >
              🗓️ Bulan Ini
            </button>

            <button
              id="filter-preset-semua"
              type="button"
              onClick={() => handlePeriodChange('semua')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-xl text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'semua'
                  ? 'bg-[#1E293B] text-white '
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#64748B] hover:text-[#1E293B] border border-[#E2E8F0]'
              }`}
            >
              Semua
            </button>
          </div>

          {/* Date Picker Form */}
          <DateFilter
            startDate={startDate}
            endDate={endDate}
            onFilter={handleCustomFilter}
            onReset={handleResetFilter}
          />
        </div>
      </div>

      {/* TOTAL TRANSAKSI SUMMARY CARDS: BARANG MASUK & BARANG KELUAR */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4">
        {/* Card 1: Total Transaksi Barang Masuk */}
        <div
          onClick={() => setActiveTab('incoming')}
          className={`hd-history-summary-card p-2.5 sm:p-3 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
            activeTab === 'incoming'
              ? 'bg-white border-[#1B9357] ring-2 ring-[#1B9357]/20 '
              : 'bg-white border-[#E2E8F0] hover:border-[#1B9357]/50 '
          }`}
        >
          <div className="flex items-center justify-between mb-1 sm:mb-3">
            <div className="flex items-center space-x-1 sm:space-x-2.5">
              <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[8px] sm:rounded-xl bg-[#EAF8F1] text-[#1B9357] flex items-center justify-center font-bold">
                <ArrowDownLeft className="w-3 h-3 sm:w-5 sm:h-5" />
              </div>
              <div>
                <span className="text-[10px] sm:text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">
                  Barang Masuk
                </span>
                <span className="text-[10px] sm:text-xs text-[#1B9357] font-semibold hidden sm:inline">
                  (Pembelian Vendor)
                </span>
              </div>
            </div>
            {activeTab === 'incoming' && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] sm:text-[10px] font-bold bg-[#EAF8F1] text-[#1B9357] border border-[#A7E4C4]">
                Aktif
              </span>
            )}
          </div>

          <div className="space-y-0.5 sm:space-y-1">
            <div className="hd-history-kpi-value text-xs sm:text-xl lg:text-3xl font-bold text-[#1E293B] tracking-tight">
              {formatRupiah(totalIncomingAmount)}
            </div>
            <div className="flex flex-wrap items-center gap-x-1 sm:gap-x-2 text-[10px] sm:text-xs text-[#64748B]">
              <span className="font-bold text-[#1E293B]">{incomingList.length} Trx</span>
              <span>•</span>
              <span className="font-semibold text-[#1B9357]">
                {totalIncomingQty.toLocaleString('id-ID')} unit
              </span>
            </div>
          </div>

          <div className="mt-1.5 sm:mt-4 pt-1 sm:pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-[10px] sm:text-xs font-semibold text-[#1B9357]">
            <span className="truncate">Buka daftar masuk</span>
            <span>→</span>
          </div>
        </div>

        {/* Card 2: Total Transaksi Barang Keluar */}
        <div
          onClick={() => setActiveTab('outgoing')}
          className={`hd-history-summary-card p-2.5 sm:p-3 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
            activeTab === 'outgoing'
              ? 'bg-white border-[#F0002B] ring-2 ring-[#F0002B]/20 '
              : 'bg-white border-[#E2E8F0] hover:border-[#F0002B]/50 '
          }`}
        >
          <div className="flex items-center justify-between mb-1 sm:mb-3">
            <div className="flex items-center space-x-1 sm:space-x-2.5">
              <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[8px] sm:rounded-xl bg-[#FDF2F4] text-[#F0002B] flex items-center justify-center font-bold">
                <ArrowUpRight className="w-3 h-3 sm:w-5 sm:h-5" />
              </div>
              <div>
                <span className="text-[10px] sm:text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">
                  Barang Keluar
                </span>
                <span className="text-[10px] sm:text-xs text-[#F0002B] font-semibold hidden sm:inline">
                  (Disetujui Outlet)
                </span>
              </div>
            </div>
            {activeTab === 'outgoing' && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] sm:text-[10px] font-bold bg-[#FDF2F4] text-[#F0002B] border border-[#F9B7C2]">
                Aktif
              </span>
            )}
          </div>

          <div className="space-y-0.5 sm:space-y-1">
            <div className="hd-history-kpi-value text-xs sm:text-xl lg:text-3xl font-bold text-[#F0002B] tracking-tight">
              {formatRupiah(totalOutgoingAmount)}
            </div>
            <div className="flex flex-wrap items-center gap-x-1 sm:gap-x-2 text-[10px] sm:text-xs text-[#64748B]">
              <span className="font-bold text-[#1E293B]">{filteredOutgoingList.length} Trx</span>
              <span>•</span>
              <span className="font-semibold text-[#F0002B]">
                {totalOutgoingQty.toLocaleString('id-ID')} unit
              </span>
            </div>
          </div>

          <div className="mt-1.5 sm:mt-4 pt-1 sm:pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-[10px] sm:text-xs font-semibold text-[#F0002B]">
            <span className="truncate">Buka daftar keluar</span>
            <span>→</span>
          </div>
        </div>

        {/* Card 3: Selisih Mutasi & Ringkasan Periode */}
        <div className="hd-history-summary-card col-span-2 md:col-span-1 p-2.5 sm:p-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-1.5 sm:space-x-2.5 mb-1 sm:mb-3">
              <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[8px] sm:rounded-xl bg-white border border-[#E2E8F0] text-[#1E293B] flex items-center justify-center font-bold">
                <Scale className="w-3 h-3 sm:w-5 sm:h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] sm:text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">
                  Selisih Nilai Mutasi
                </span>
                <span className="text-[10px] sm:text-xs text-[#64748B] font-semibold truncate block">
                  {periodLabel}
                </span>
              </div>
            </div>

            <div className="space-y-0.5 sm:space-y-1">
              <div
                className={`hd-history-kpi-value text-xs sm:text-xl lg:text-2xl font-bold tracking-tight ${
                  totalIncomingAmount - totalOutgoingAmount >= 0 ? 'text-[#1E293B]' : 'text-[#F0002B]'
                }`}
              >
                {formatRupiah(totalIncomingAmount - totalOutgoingAmount)}
              </div>
              <div className="text-[10px] sm:text-xs text-[#64748B]">
                {totalIncomingAmount >= totalOutgoingAmount ? (
                  <span className="text-[#1B9357] font-semibold">
                    ▲ Surplus Nilai Masuk
                  </span>
                ) : (
                  <span className="text-[#F0002B] font-semibold">
                    ▼ Nilai Keluar Lebih Tinggi
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-1.5 sm:mt-4 pt-1 sm:pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-[10px] sm:text-xs text-[#64748B]">
            <span>Volume Total</span>
            <span className="font-bold text-[#1E293B]">
              {(totalIncomingQty + totalOutgoingQty).toLocaleString('id-ID')} unit
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs & Outlet Filter */}
      <div className="hd-history-filterbar bg-white p-2.5 sm:p-3 rounded-xl border border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
        {/* Tabs: [ Barang Masuk ] [ Barang Keluar ] */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 bg-[#F8FAFC] p-1 rounded-xl border border-[#E2E8F0] w-full sm:w-auto">
          <button
            id="tab-barang-masuk"
            onClick={() => setActiveTab('incoming')}
            className={`flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-[12px] sm:rounded-xl text-[11px] sm:text-xs font-bold transition-colors cursor-pointer min-h-[34px] ${
              activeTab === 'incoming'
                ? 'bg-[#1E293B] text-white '
                : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            <ArrowDownLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Masuk ({incomingList.length})</span>
          </button>

          <button
            id="tab-barang-keluar"
            onClick={() => setActiveTab('outgoing')}
            className={`flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-[12px] sm:rounded-xl text-[11px] sm:text-xs font-bold transition-colors cursor-pointer min-h-[34px] ${
              activeTab === 'outgoing'
                ? 'bg-[#1E293B] text-white '
                : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            <ArrowUpRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Keluar ({filteredOutgoingList.length})</span>
          </button>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <label className="relative min-w-[180px] flex-1 sm:max-w-[240px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" aria-hidden="true" />
            <input aria-label="Cari riwayat transaksi" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Cari transaksi atau barang" className="w-full min-h-[34px] rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-2 text-xs text-[#1E293B] outline-none focus:border-[#F0002B]" />
          </label>
          <details className="relative">
            <summary className="list-none flex min-h-[34px] items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-xs font-semibold text-[#334155]">Barang ({selectedItemIds.length || 'Semua'})</summary>
            <div className="absolute right-0 z-20 mt-1 max-h-64 w-64 overflow-auto rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-lg">
              {itemOptions.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[#F8FAFC]">
                <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={() => setSelectedItemIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
                <span className="truncate">{item.name}</span>
              </label>)}
              {!itemOptions.length && <span className="block px-2 py-2 text-xs text-[#64748B]">Data barang belum tersedia.</span>}
            </div>
          </details>
        </div>

        {/* Filter Outlet khusus tab Barang Keluar */}
        {activeTab === 'outgoing' && (
          <details className="relative w-full sm:w-auto">
            <summary id="filter-history-outlet" className="list-none flex items-center gap-1.5 w-full bg-[#F8FAFC] px-2.5 py-1.5 rounded-[12px] sm:rounded-xl border border-[#E2E8F0] cursor-pointer text-[11px] sm:text-xs font-semibold text-[#1E293B] min-h-[30px] sm:min-h-[36px]">
              <Store className="w-3.5 h-3.5 text-[#F0002B] shrink-0" />
              {selectedOutlets.length ? `${selectedOutlets.length} outlet dipilih` : `Semua Outlet (${outlets.length})`}
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 max-h-72 overflow-auto rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-lg">
              <div className="flex justify-between gap-2 border-b border-[#E2E8F0] pb-2 mb-1 text-xs">
              <button type="button" onClick={() => setSelectedOutlets(outlets.map((outlet) => outlet.id))} className="font-bold text-[#1D63D8]">Select All</button>
                <button type="button" onClick={() => setSelectedOutlets([])} className="font-semibold text-[#64748B]">Clear Selection</button>
              </div>
              {outlets.map((outlet) => (
                <label key={outlet.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-[#1E293B] hover:bg-[#F8FAFC] cursor-pointer">
                  <input type="checkbox" checked={selectedOutlets.includes(outlet.id)} onChange={() => setSelectedOutlets((current) => current.includes(outlet.id) ? current.filter((entry) => entry !== outlet.id) : [...current, outlet.id])} />
                  {outlet.name}
                </label>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Content for BARANG MASUK */}
      {activeTab === 'incoming' && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden ">
          <div className="p-3 sm:p-4 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 bg-[#F8FAFC]/60">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-[11px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider">
                Pembelian Masuk ({incomingList.length})
              </span>
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#EAF8F1] text-[#1B9357] font-bold border border-[#A7E4C4]">
                {periodLabel}
              </span>
            </div>
            <div className="text-[11px] sm:text-xs text-[#1E293B] font-bold">
              Subtotal: <span className="text-[#1B9357]">{formatRupiah(totalIncomingAmount)}</span> ({totalIncomingQty} unit)
            </div>
          </div>

          {loading ? <StateMessage kind="loading">Memuat data barang masuk...</StateMessage> : filteredIncomingList.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs">
              <thead><tr><th>Nomor Transaksi</th><th>Tanggal</th><th>Vendor</th><th>Barang</th><th>Metode</th><th className="text-right">Total Nominal</th><th className="text-right">Aksi</th></tr></thead>
              <tbody>{filteredIncomingList.map((tx) => <tr key={tx.id}>
                <th scope="row" className="whitespace-nowrap font-semibold text-[#1E293B]">{tx.transactionCode}</th>
                <td className="whitespace-nowrap text-[#64748B]">{formatDateIndo(tx.transactionDate)}</td>
                <td className="max-w-[180px] truncate">{tx.vendorName || tx.vendorCode}</td>
                <td className="max-w-[220px] truncate">{tx.itemSummary || `${tx.itemCount || 1} Barang`}</td>
                <td><span className="hd-badge">{tx.paymentMethod || 'Transfer'}</span></td>
                <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatRupiah(tx.totalAmount)}</td>
                <td className="whitespace-nowrap text-right"><div className="inline-flex gap-1">
                  <button onClick={() => setPrintA4Data({ type: 'incoming', data: tx })} className="hd-button hd-button--secondary !min-h-[30px] !px-2"><Printer className="h-3.5 w-3.5" /><span>Cetak A4</span></button>
                  <button onClick={() => setSelectedTx({ type: 'incoming', data: tx })} className="hd-button hd-button--secondary !min-h-[30px] !px-2">Detail</button>
                </div></td>
              </tr>)}</tbody>
            </table></div>
          ) : <StateMessage>Tidak ada transaksi barang masuk pada filter {periodLabel}.</StateMessage>}
        </div>
      )}

      {/* Content for BARANG KELUAR */}
      {activeTab === 'outgoing' && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden ">
          <div className="p-3 sm:p-4 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 bg-[#F8FAFC]/60">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-[11px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider">
                Barang Keluar ({filteredOutgoingList.length})
              </span>
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#FDF2F4] text-[#F0002B] font-bold border border-[#F9B7C2]">
                {periodLabel}
              </span>
              {selectedOutlets.length > 0 && (
                <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#1E293B] font-bold border border-[#E2E8F0]">
                  Outlet: {selectedOutlets.length} dipilih
                </span>
              )}
            </div>
            <div className="text-[11px] sm:text-xs text-[#1E293B] font-bold">
              Subtotal: <span className="text-[#F0002B]">{formatRupiah(totalOutgoingAmount)}</span> ({totalOutgoingQty} unit)
            </div>
          </div>

          {loading ? <StateMessage kind="loading">Memuat data barang keluar...</StateMessage> : displayedOutgoingList.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs">
              <thead><tr><th>Nomor Request</th><th>Tanggal</th><th>Outlet</th><th>Status</th><th>Barang</th><th className="text-right">Total Nilai Keluar</th><th className="text-right">Aksi</th></tr></thead>
              <tbody>{displayedOutgoingList.map((tx) => <tr key={tx.id}>
                <th scope="row" className="whitespace-nowrap font-semibold text-[#1E293B]">{tx.requestCode}</th>
                <td className="whitespace-nowrap text-[#64748B]">{formatDateIndo(tx.requestDate)}</td>
                <td className="max-w-[180px] truncate">{tx.requesterName}</td>
                <td><StatusBadge status={tx.status} /></td>
                <td className="max-w-[220px] truncate">{tx.itemSummary || `${tx.itemCount || 1} Barang Disetujui`}</td>
                <td className="whitespace-nowrap text-right font-semibold text-[#1E293B] tabular-nums">{formatRupiah(tx.totalApprovedAmount || tx.totalAmount)}</td>
                <td className="whitespace-nowrap text-right"><div className="inline-flex gap-1">
                  <button onClick={() => setPrintA4Data({ type: 'outgoing', data: tx })} className="hd-button hd-button--secondary !min-h-[30px] !px-2"><Printer className="h-3.5 w-3.5" /><span>Cetak A4</span></button>
                  <button onClick={() => setSelectedTx({ type: 'outgoing', data: tx })} className="hd-button hd-button--secondary !min-h-[30px] !px-2">Detail</button>
                </div></td>
              </tr>)}</tbody>
            </table></div>
          ) : <StateMessage>Tidak ada riwayat transaksi barang keluar pada filter {periodLabel}{' '}{selectedOutlets.length ? `untuk ${selectedOutlets.length} outlet terpilih` : ''}.</StateMessage>}
        </div>
      )}

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <TransactionDetailModal
          isOpen={!!selectedTx}
          onClose={() => setSelectedTx(null)}
          type={selectedTx.type}
          data={selectedTx.data}
        />
      )}

      {/* Direct A4 Print Modal */}
      {printA4Data && (
        <PrintableTransactionA4
          isOpen={!!printA4Data}
          onClose={() => setPrintA4Data(null)}
          type={printA4Data.type}
          data={printA4Data.data}
        />
      )}
    </div>
  );
};
