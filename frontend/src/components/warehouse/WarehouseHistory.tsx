import React, { useState, useEffect, useMemo } from 'react';
import { DateFilter } from '../common/DateFilter.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatDateIndo, formatRupiah } from '../../lib/format.ts';
import { PurchaseTransaction, OutgoingHistoryTransaction } from '../../types.ts';
import { TransactionDetailModal } from '../modals/TransactionDetailModal.tsx';
import { PrintableTransactionA4 } from '../modals/PrintableTransactionA4.tsx';
import { OUTLETS } from '../../constants/outlets.ts';
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
} from 'lucide-react';

type PeriodFilterType = 'hari' | 'minggu' | 'bulan' | 'semua' | 'kustom';

export const WarehouseHistory: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing'>('incoming');
  const [activePeriod, setActivePeriod] = useState<PeriodFilterType>('semua');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([]);

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
  const filteredOutgoingList = useMemo(() => {
    if (!selectedOutlets.length) return outgoingList;
    return outgoingList.filter((tx) =>
      selectedOutlets.some((outlet) => (tx.requesterName || '').toLowerCase().includes(outlet.toLowerCase()))
    );
  }, [outgoingList, selectedOutlets]);

  // Aggregate stats based on current period filter
  const totalIncomingAmount = useMemo(() => {
    return incomingList.reduce((sum, tx) => sum + (Number(tx.totalAmount) || 0), 0);
  }, [incomingList]);

  const totalIncomingQty = useMemo(() => {
    return incomingList.reduce((sum, tx) => {
      if (Array.isArray(tx.items) && tx.items.length > 0) {
        return sum + tx.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      }
      return sum + (Number(tx.itemCount) || 1);
    }, 0);
  }, [incomingList]);

  const totalOutgoingAmount = useMemo(() => {
    return filteredOutgoingList.reduce(
      (sum, tx) => sum + (Number(tx.totalApprovedAmount || tx.totalAmount) || 0),
      0
    );
  }, [filteredOutgoingList]);

  const totalOutgoingQty = useMemo(() => {
    return filteredOutgoingList.reduce((sum, tx) => {
      if (Array.isArray(tx.items) && tx.items.length > 0) {
        return (
          sum +
          tx.items.reduce(
            (s, it) => (it.status === 'Approved' ? s + (Number(it.approvedQuantity) || 0) : s),
            0
          )
        );
      }
      return sum + (Number(tx.itemCount) || 1);
    }, 0);
  }, [filteredOutgoingList]);

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
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-[#17233D] tracking-tight">
            Riwayat Transaksi Gudang
          </h1>
          <p className="text-xs sm:text-sm text-[#60708C] mt-0.5">
            Arsip mutasi transaksi fisik barang masuk dan barang keluar.
          </p>
        </div>

        {/* Badge Periode Aktif */}
        <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-full bg-[#F8FAFC] border border-[#DDE5F0] text-[11px] sm:text-xs text-[#17233D] font-semibold self-start md:self-auto">
          <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#ED002B]" />
          <span>Periode: <strong className="text-[#17233D]">{periodLabel}</strong></span>
        </div>
      </div>

      {/* Quick Filter Bar: Hari, Minggu, Bulan, Semua & Custom Date Picker */}
      <div className="bg-white p-2 sm:p-4 rounded-[14px] sm:rounded-[22px] border border-[#DDE5F0] shadow-xs space-y-1.5 sm:space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-1.5 sm:gap-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-2">
            <span className="text-[10px] sm:text-xs font-bold text-[#60708C] mr-0.5 hidden sm:inline uppercase tracking-wider">
              Filter:
            </span>

            <button
              id="filter-preset-hari"
              type="button"
              onClick={() => handlePeriodChange('hari')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-[16px] text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'hari'
                  ? 'bg-[#ED002B] text-white shadow-xs'
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#60708C] hover:text-[#17233D] border border-[#DDE5F0]'
              }`}
            >
              📅 Hari Ini
            </button>

            <button
              id="filter-preset-minggu"
              type="button"
              onClick={() => handlePeriodChange('minggu')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-[16px] text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'minggu'
                  ? 'bg-[#ED002B] text-white shadow-xs'
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#60708C] hover:text-[#17233D] border border-[#DDE5F0]'
              }`}
            >
              📆 Minggu Ini
            </button>

            <button
              id="filter-preset-bulan"
              type="button"
              onClick={() => handlePeriodChange('bulan')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-[16px] text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'bulan'
                  ? 'bg-[#ED002B] text-white shadow-xs'
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#60708C] hover:text-[#17233D] border border-[#DDE5F0]'
              }`}
            >
              🗓️ Bulan Ini
            </button>

            <button
              id="filter-preset-semua"
              type="button"
              onClick={() => handlePeriodChange('semua')}
              className={`px-2 py-0.5 sm:px-3.5 sm:py-2 rounded-[8px] sm:rounded-[16px] text-[10px] sm:text-xs font-bold transition-all cursor-pointer min-h-[26px] sm:min-h-[38px] ${
                activePeriod === 'semua'
                  ? 'bg-[#17233D] text-white shadow-xs'
                  : 'bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[#60708C] hover:text-[#17233D] border border-[#DDE5F0]'
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
          className={`p-2.5 sm:p-5 rounded-[14px] sm:rounded-[22px] border transition-all cursor-pointer relative overflow-hidden ${
            activeTab === 'incoming'
              ? 'bg-white border-[#1B9357] ring-2 ring-[#1B9357]/20 shadow-xs'
              : 'bg-white border-[#DDE5F0] hover:border-[#1B9357]/50 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between mb-1 sm:mb-3">
            <div className="flex items-center space-x-1 sm:space-x-2.5">
              <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[8px] sm:rounded-[14px] bg-[#EAF8F1] text-[#1B9357] flex items-center justify-center font-bold">
                <ArrowDownLeft className="w-3 h-3 sm:w-5 sm:h-5" />
              </div>
              <div>
                <span className="text-[9px] sm:text-[11px] font-bold text-[#60708C] uppercase tracking-wider block">
                  Barang Masuk
                </span>
                <span className="text-[9px] sm:text-xs text-[#1B9357] font-semibold hidden sm:inline">
                  (Pembelian Vendor)
                </span>
              </div>
            </div>
            {activeTab === 'incoming' && (
              <span className="px-1.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-bold bg-[#EAF8F1] text-[#1B9357] border border-[#A7E4C4]">
                Aktif
              </span>
            )}
          </div>

          <div className="space-y-0.5 sm:space-y-1">
            <div className="text-xs sm:text-2xl lg:text-3xl font-black text-[#17233D] tracking-tight">
              {formatRupiah(totalIncomingAmount)}
            </div>
            <div className="flex flex-wrap items-center gap-x-1 sm:gap-x-2 text-[9px] sm:text-xs text-[#60708C]">
              <span className="font-bold text-[#17233D]">{incomingList.length} Trx</span>
              <span>•</span>
              <span className="font-semibold text-[#1B9357]">
                {totalIncomingQty.toLocaleString('id-ID')} unit
              </span>
            </div>
          </div>

          <div className="mt-1.5 sm:mt-4 pt-1 sm:pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-[9px] sm:text-xs font-semibold text-[#1B9357]">
            <span className="truncate">Buka daftar masuk</span>
            <span>→</span>
          </div>
        </div>

        {/* Card 2: Total Transaksi Barang Keluar */}
        <div
          onClick={() => setActiveTab('outgoing')}
          className={`p-2.5 sm:p-5 rounded-[14px] sm:rounded-[22px] border transition-all cursor-pointer relative overflow-hidden ${
            activeTab === 'outgoing'
              ? 'bg-white border-[#ED002B] ring-2 ring-[#ED002B]/20 shadow-xs'
              : 'bg-white border-[#DDE5F0] hover:border-[#ED002B]/50 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between mb-1 sm:mb-3">
            <div className="flex items-center space-x-1 sm:space-x-2.5">
              <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[8px] sm:rounded-[14px] bg-[#FDF2F4] text-[#ED002B] flex items-center justify-center font-bold">
                <ArrowUpRight className="w-3 h-3 sm:w-5 sm:h-5" />
              </div>
              <div>
                <span className="text-[9px] sm:text-[11px] font-bold text-[#60708C] uppercase tracking-wider block">
                  Barang Keluar
                </span>
                <span className="text-[9px] sm:text-xs text-[#ED002B] font-semibold hidden sm:inline">
                  (Disetujui Outlet)
                </span>
              </div>
            </div>
            {activeTab === 'outgoing' && (
              <span className="px-1.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-bold bg-[#FDF2F4] text-[#ED002B] border border-[#F9B7C2]">
                Aktif
              </span>
            )}
          </div>

          <div className="space-y-0.5 sm:space-y-1">
            <div className="text-xs sm:text-2xl lg:text-3xl font-black text-[#ED002B] tracking-tight">
              {formatRupiah(totalOutgoingAmount)}
            </div>
            <div className="flex flex-wrap items-center gap-x-1 sm:gap-x-2 text-[9px] sm:text-xs text-[#60708C]">
              <span className="font-bold text-[#17233D]">{filteredOutgoingList.length} Trx</span>
              <span>•</span>
              <span className="font-semibold text-[#ED002B]">
                {totalOutgoingQty.toLocaleString('id-ID')} unit
              </span>
            </div>
          </div>

          <div className="mt-1.5 sm:mt-4 pt-1 sm:pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-[9px] sm:text-xs font-semibold text-[#ED002B]">
            <span className="truncate">Buka daftar keluar</span>
            <span>→</span>
          </div>
        </div>

        {/* Card 3: Selisih Mutasi & Ringkasan Periode */}
        <div className="col-span-2 md:col-span-1 p-2.5 sm:p-5 rounded-[14px] sm:rounded-[22px] border border-[#DDE5F0] bg-[#F8FAFC] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-1.5 sm:space-x-2.5 mb-1 sm:mb-3">
              <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[8px] sm:rounded-[14px] bg-white border border-[#DDE5F0] text-[#17233D] flex items-center justify-center font-bold">
                <Scale className="w-3 h-3 sm:w-5 sm:h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[9px] sm:text-[11px] font-bold text-[#60708C] uppercase tracking-wider block">
                  Selisih Nilai Mutasi
                </span>
                <span className="text-[9px] sm:text-xs text-[#60708C] font-semibold truncate block">
                  {periodLabel}
                </span>
              </div>
            </div>

            <div className="space-y-0.5 sm:space-y-1">
              <div
                className={`text-xs sm:text-xl lg:text-2xl font-black tracking-tight ${
                  totalIncomingAmount - totalOutgoingAmount >= 0 ? 'text-[#17233D]' : 'text-[#ED002B]'
                }`}
              >
                {formatRupiah(totalIncomingAmount - totalOutgoingAmount)}
              </div>
              <div className="text-[9px] sm:text-xs text-[#60708C]">
                {totalIncomingAmount >= totalOutgoingAmount ? (
                  <span className="text-[#1B9357] font-semibold">
                    ▲ Surplus Nilai Masuk
                  </span>
                ) : (
                  <span className="text-[#ED002B] font-semibold">
                    ▼ Nilai Keluar Lebih Tinggi
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-1.5 sm:mt-4 pt-1 sm:pt-3 border-t border-[#DDE5F0] flex items-center justify-between text-[9px] sm:text-xs text-[#60708C]">
            <span>Volume Total</span>
            <span className="font-bold text-[#17233D]">
              {(totalIncomingQty + totalOutgoingQty).toLocaleString('id-ID')} unit
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs & Outlet Filter */}
      <div className="bg-white p-2.5 sm:p-4 rounded-[16px] sm:rounded-[22px] border border-[#DDE5F0] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
        {/* Tabs: [ Barang Masuk ] [ Barang Keluar ] */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 bg-[#F8FAFC] p-1 rounded-[14px] sm:rounded-[20px] border border-[#DDE5F0] w-full sm:w-auto">
          <button
            id="tab-barang-masuk"
            onClick={() => setActiveTab('incoming')}
            className={`flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-[12px] sm:rounded-[18px] text-[11px] sm:text-xs font-bold transition-colors cursor-pointer min-h-[34px] ${
              activeTab === 'incoming'
                ? 'bg-[#17233D] text-white shadow-xs'
                : 'text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            <ArrowDownLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Masuk ({incomingList.length})</span>
          </button>

          <button
            id="tab-barang-keluar"
            onClick={() => setActiveTab('outgoing')}
            className={`flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-[12px] sm:rounded-[18px] text-[11px] sm:text-xs font-bold transition-colors cursor-pointer min-h-[34px] ${
              activeTab === 'outgoing'
                ? 'bg-[#17233D] text-white shadow-xs'
                : 'text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            <ArrowUpRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Keluar ({filteredOutgoingList.length})</span>
          </button>
        </div>

        {/* Filter Outlet khusus tab Barang Keluar */}
        {activeTab === 'outgoing' && (
          <details className="relative w-full sm:w-auto">
            <summary id="filter-history-outlet" className="list-none flex items-center gap-1.5 w-full bg-[#F8FAFC] px-2.5 py-1.5 rounded-[12px] sm:rounded-[16px] border border-[#DDE5F0] cursor-pointer text-[11px] sm:text-xs font-semibold text-[#17233D] min-h-[30px] sm:min-h-[36px]">
              <Store className="w-3.5 h-3.5 text-[#ED002B] shrink-0" />
              {selectedOutlets.length ? `${selectedOutlets.length} outlet dipilih` : `Semua Outlet (${OUTLETS.length})`}
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 max-h-72 overflow-auto rounded-xl border border-[#DDE5F0] bg-white p-2 shadow-lg">
              <div className="flex justify-between gap-2 border-b border-[#DDE5F0] pb-2 mb-1 text-xs">
                <button type="button" onClick={() => setSelectedOutlets([...OUTLETS])} className="font-bold text-[#1D63D8]">Select All</button>
                <button type="button" onClick={() => setSelectedOutlets([])} className="font-semibold text-[#60708C]">Clear Selection</button>
              </div>
              {OUTLETS.map((outlet) => (
                <label key={outlet} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-[#17233D] hover:bg-[#F8FAFC] cursor-pointer">
                  <input type="checkbox" checked={selectedOutlets.includes(outlet)} onChange={() => setSelectedOutlets((current) => current.includes(outlet) ? current.filter((entry) => entry !== outlet) : [...current, outlet])} />
                  {outlet}
                </label>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Content for BARANG MASUK */}
      {activeTab === 'incoming' && (
        <div className="bg-white rounded-[18px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
          <div className="p-3 sm:p-4 border-b border-[#DDE5F0] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 bg-[#F8FAFC]/60">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-[11px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider">
                Pembelian Masuk ({incomingList.length})
              </span>
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#EAF8F1] text-[#1B9357] font-bold border border-[#A7E4C4]">
                {periodLabel}
              </span>
            </div>
            <div className="text-[11px] sm:text-xs text-[#17233D] font-bold">
              Subtotal: <span className="text-[#1B9357]">{formatRupiah(totalIncomingAmount)}</span> ({totalIncomingQty} unit)
            </div>
          </div>

          <div className="divide-y divide-[#DDE5F0]">
            {loading ? (
              <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">Memuat data barang masuk...</div>
            ) : incomingList.length > 0 ? (
              incomingList.map((tx) => (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTx({ type: 'incoming', data: tx })}
                  className="p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span className="font-bold text-sm sm:text-base text-[#17233D] tracking-tight">
                        {tx.transactionCode}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-semibold bg-[#EAF8F1] text-[#1B9357] border border-[#A7E4C4]">
                        Masuk
                      </span>
                      <span className="text-[10px] sm:text-xs text-[#60708C] px-1.5 py-0.5 rounded-full bg-[#F1F5F9]">
                        {tx.paymentMethod || 'Transfer'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-0.5 text-[11px] sm:text-xs text-[#60708C]">
                      <span className="font-semibold text-[#17233D]">{formatDateIndo(tx.transactionDate)}</span>
                      <span>•</span>
                      <span className="font-bold text-[#17233D]">{tx.vendorName || tx.vendorCode}</span>
                      <span>•</span>
                      <span className="text-[#17233D] font-medium truncate max-w-[200px] sm:max-w-sm">
                        {tx.itemSummary || `${tx.itemCount || 1} Barang`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end space-x-3 sm:space-x-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-[#DDE5F0]">
                    <div className="text-left sm:text-right">
                      <span className="text-[10px] sm:text-[11px] text-[#60708C] block uppercase font-semibold">Total Nominal</span>
                      <span className="text-xs sm:text-base font-bold text-[#17233D]">
                        {formatRupiah(tx.totalAmount)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 sm:space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPrintA4Data({ type: 'incoming', data: tx });
                        }}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 sm:px-3 sm:py-2 bg-[#F8FAFC] hover:bg-[#ED002B] text-[#17233D] hover:text-white text-[11px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] border border-[#DDE5F0] hover:border-[#ED002B] transition-colors cursor-pointer"
                        title="Cetak format kertas A4"
                      >
                        <Printer className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span className="hidden sm:inline">Cetak A4</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTx({ type: 'incoming', data: tx });
                        }}
                        className="px-2.5 py-1 sm:px-3.5 sm:py-2 bg-white hover:bg-[#F8FAFC] text-[#17233D] text-[11px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] border border-[#DDE5F0] transition-colors cursor-pointer"
                      >
                        Detail
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">
                Tidak ada transaksi barang masuk pada filter {periodLabel}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content for BARANG KELUAR */}
      {activeTab === 'outgoing' && (
        <div className="bg-white rounded-[18px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
          <div className="p-3 sm:p-4 border-b border-[#DDE5F0] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 bg-[#F8FAFC]/60">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-[11px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider">
                Barang Keluar ({filteredOutgoingList.length})
              </span>
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#FDF2F4] text-[#ED002B] font-bold border border-[#F9B7C2]">
                {periodLabel}
              </span>
              {selectedOutlets.length > 0 && (
                <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#17233D] font-bold border border-[#DDE5F0]">
                  Outlet: {selectedOutlets.length} dipilih
                </span>
              )}
            </div>
            <div className="text-[11px] sm:text-xs text-[#17233D] font-bold">
              Subtotal: <span className="text-[#ED002B]">{formatRupiah(totalOutgoingAmount)}</span> ({totalOutgoingQty} unit)
            </div>
          </div>

          <div className="divide-y divide-[#DDE5F0]">
            {loading ? (
              <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">Memuat data barang keluar...</div>
            ) : filteredOutgoingList.length > 0 ? (
              filteredOutgoingList.map((tx) => (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTx({ type: 'outgoing', data: tx })}
                  className="p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span className="font-bold text-sm sm:text-base text-[#17233D] tracking-tight">
                        {tx.requestCode}
                      </span>
                      <StatusBadge status={tx.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-0.5 text-[11px] sm:text-xs text-[#60708C]">
                      <span className="font-semibold text-[#17233D]">{formatDateIndo(tx.requestDate)}</span>
                      <span>•</span>
                      <span className="font-bold text-[#ED002B] flex items-center space-x-1">
                        <Store className="w-3 h-3 sm:w-3.5 sm:h-3.5 inline mr-0.5" />
                        <span>{tx.requesterName}</span>
                      </span>
                      <span>•</span>
                      <span className="text-[#17233D] font-medium truncate max-w-[200px] sm:max-w-sm">
                        {tx.itemSummary || `${tx.itemCount || 1} Barang Disetujui`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end space-x-3 sm:space-x-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-[#DDE5F0]">
                    <div className="text-left sm:text-right">
                      <span className="text-[10px] sm:text-[11px] text-[#60708C] block uppercase font-semibold">Total Nilai Keluar</span>
                      <span className="text-xs sm:text-base font-bold text-[#ED002B]">
                        {formatRupiah(tx.totalApprovedAmount || tx.totalAmount)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 sm:space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPrintA4Data({ type: 'outgoing', data: tx });
                        }}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 sm:px-3 sm:py-2 bg-[#F8FAFC] hover:bg-[#ED002B] text-[#17233D] hover:text-white text-[11px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] border border-[#DDE5F0] hover:border-[#ED002B] transition-colors cursor-pointer"
                        title="Cetak format kertas A4"
                      >
                        <Printer className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span className="hidden sm:inline">Cetak A4</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTx({ type: 'outgoing', data: tx });
                        }}
                        className="px-2.5 py-1 sm:px-3.5 sm:py-2 bg-white hover:bg-[#F8FAFC] text-[#17233D] text-[11px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] border border-[#DDE5F0] transition-colors cursor-pointer"
                      >
                        Detail
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">
                Tidak ada riwayat transaksi barang keluar pada filter {periodLabel}{' '}
                {selectedOutlets.length ? `untuk ${selectedOutlets.length} outlet terpilih` : ''}.
              </div>
            )}
          </div>
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
