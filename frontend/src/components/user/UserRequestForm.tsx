import React, { useEffect, useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  ShoppingBag,
  Store,
  Calendar,
  CreditCard,
  Search,
  RotateCcw,
  Boxes,
  Minus,
  Plus,
} from 'lucide-react';
import { User, InventoryItem } from '../../types.ts';
import { formatRupiah } from '../../lib/format.ts';
import { OUTLETS } from '../../constants/outlets.ts';

interface UserRequestFormProps {
  currentUser: User;
  onSuccess: () => void;
}

export const UserRequestForm: React.FC<UserRequestFormProps> = ({
  currentUser,
  onSuccess,
}) => {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form Headers requested by user: "Tgl... Otlet...."
  const [requestDate, setRequestDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [outletName, setOutletName] = useState<string>(OUTLETS[0]);
  const [paymentMethod, setPaymentMethod] = useState<string>('Transfer');

  // Quantities map: { [itemId: number]: number }
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'ordered' | 'meat' | 'staple' | 'sauce' | 'pack'>('all');

  // Outlet list from constants
  const outletOptions = OUTLETS;

  // Fetch available inventory items
  useEffect(() => {
    const fetchInventory = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/inventory');
        const data = await res.json();
        const items: InventoryItem[] = data.items || [];
        setInventory(items);

        // Initialize empty quantities
        const initQty: Record<number, number> = {};
        items.forEach((it) => {
          initQty[it.id] = 0;
        });
        setQuantities(initQty);
      } catch (err) {
        console.error('Failed to load inventory items:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchInventory();
  }, []);

  // Update quantity for a specific item
  const handleQuantityChange = (itemId: number, value: number) => {
    const sanitized = isNaN(value) ? 0 : Math.max(0, Math.floor(value));
    setQuantities((prev) => ({
      ...prev,
      [itemId]: sanitized,
    }));
  };

  const handleIncrement = (itemId: number) => {
    setQuantities((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || 0) + 1,
    }));
  };

  const handleDecrement = (itemId: number) => {
    setQuantities((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) - 1),
    }));
  };

  const handleResetAll = () => {
    const reset: Record<number, number> = {};
    inventory.forEach((it) => {
      reset[it.id] = 0;
    });
    setQuantities(reset);
  };

  // Helper to categorize items
  const getItemCategory = (name: string): 'meat' | 'staple' | 'sauce' | 'pack' => {
    const lower = name.toLowerCase();
    if (lower.includes('ayam') || lower.includes('kulit')) return 'meat';
    if (lower.includes('beras') || lower.includes('tepung') || lower.includes('minyak')) return 'staple';
    if (lower.includes('s.') || lower.includes('bbq') || lower.includes('geprek') || lower.includes('chili') || lower.includes('tomat') || lower.includes('pedas')) return 'sauce';
    return 'pack';
  };

  // Filtered items list
  const filteredItems = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch =
        item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.vendorName && item.vendorName.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      const qty = quantities[item.id] || 0;
      if (categoryFilter === 'ordered') {
        return qty > 0;
      }
      if (categoryFilter === 'meat') {
        return getItemCategory(item.itemName) === 'meat';
      }
      if (categoryFilter === 'staple') {
        return getItemCategory(item.itemName) === 'staple';
      }
      if (categoryFilter === 'sauce') {
        return getItemCategory(item.itemName) === 'sauce';
      }
      if (categoryFilter === 'pack') {
        return getItemCategory(item.itemName) === 'pack';
      }
      return true;
    });
  }, [inventory, searchQuery, categoryFilter, quantities]);

  // Compute summary metrics
  const orderSummary = useMemo(() => {
    let totalItemsCount = 0;
    let totalQuantity = 0;
    let totalAmount = 0;

    inventory.forEach((item) => {
      const qty = quantities[item.id] || 0;
      if (qty > 0) {
        totalItemsCount += 1;
        totalQuantity += qty;
        totalAmount += qty * item.price;
      }
    });

    return { totalItemsCount, totalQuantity, totalAmount };
  }, [inventory, quantities]);

  // Submit HD Request Order
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!outletName.trim()) {
      setError('Nama Outlet wajib diisi.');
      return;
    }

    // Collect all items where quantity > 0
    const orderedItems = inventory
      .filter((item) => (quantities[item.id] || 0) > 0)
      .map((item) => ({
        itemId: item.id,
        itemName: item.itemName,
        quantity: quantities[item.id],
        price: item.price,
      }));

    if (orderedItems.length === 0) {
      setError('Belum ada barang yang diisi quantity. Masukkan jumlah order pada kolom Qty.');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        userId: currentUser.id,
        requesterName: `${outletName.trim()} (${currentUser.name})`,
        paymentMethod,
        requestDate,
        items: orderedItems,
      };

      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mengajukan HD Request Order');
      }

      setSuccessMsg(
        `Berhasil! HD Request Order (${data.request?.requestCode || 'REQ-xxx'}) untuk ${outletName} telah terkirim ke Gudang.`
      );

      // Reset quantities
      handleResetAll();

      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem saat mengirim order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Form: Tgl & Outlet */}
      <div className="bg-white p-3.5 sm:p-5 rounded-[18px] sm:rounded-[22px] border border-[#DDE5F0] shadow-xs space-y-2.5 sm:space-y-3.5">
        <div className="flex items-center justify-between gap-2 border-b border-[#DDE5F0] pb-2.5 sm:pb-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="px-2 py-0.5 bg-[#ED002B]/10 text-[#ED002B] text-[10px] sm:text-[11px] font-extrabold rounded-full tracking-wider uppercase">
              HD Order
            </span>
            <h2 className="text-sm sm:text-lg font-bold text-[#17233D] tracking-tight">
              Daftar Permintaan Barang
            </h2>
          </div>

          <div className="flex items-center space-x-1 text-[11px] sm:text-xs text-[#60708C] shrink-0">
            <span className="hidden sm:inline">Pemohon:</span>
            <strong className="text-[#17233D] bg-[#F8FAFC] px-2 py-0.5 rounded-full border border-[#DDE5F0] max-w-[130px] sm:max-w-none truncate block">
              {currentUser.name}
            </strong>
          </div>
        </div>

        {/* Input Tgl, Outlet, & Metode Pembayaran (Ultra Compact & Mobile-Friendly) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-3.5 pt-0.5">
          {/* Kolom Tanggal */}
          <div className="col-span-1">
            <label className="block text-[9px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider mb-0.5 sm:mb-1 flex items-center space-x-1">
              <Calendar className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#ED002B] shrink-0" />
              <span className="truncate">Tgl Order</span>
            </label>
            <input
              id="input-hd-tgl"
              type="date"
              value={requestDate}
              onChange={(e) => setRequestDate(e.target.value)}
              className="w-full px-2 py-0.5 sm:px-3.5 sm:py-2 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[16px] text-[10px] sm:text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B] h-[30px] sm:h-[40px]"
            />
          </div>

          {/* Kolom Outlet */}
          <div className="col-span-1">
            <label className="block text-[9px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider mb-0.5 sm:mb-1 flex items-center space-x-1">
              <Store className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#ED002B] shrink-0" />
              <span className="truncate">Outlet</span>
            </label>
            <div className="relative">
              <select
                id="select-hd-outlet"
                value={outletName}
                onChange={(e) => setOutletName(e.target.value)}
                className="w-full px-2 py-0.5 sm:px-3.5 sm:py-2 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[16px] text-[10px] sm:text-xs font-bold text-[#17233D] outline-none focus:border-[#ED002B] cursor-pointer h-[30px] sm:h-[40px] truncate"
              >
                {outletOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Kolom Metode Pembayaran */}
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[9px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider mb-0.5 sm:mb-1 flex items-center space-x-1">
              <CreditCard className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#ED002B] shrink-0" />
              <span className="truncate">Metode Pembayaran</span>
            </label>
            <select
              id="select-hd-payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-2 py-0.5 sm:px-3.5 sm:py-2 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[16px] text-[10px] sm:text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B] cursor-pointer h-[30px] sm:h-[40px]"
            >
              <option value="Transfer">Transfer Bank</option>
              <option value="Tempo">Tempo / Invoice Outlet</option>
              <option value="Cash">Cash / Kas Kecil</option>
            </select>
          </div>
        </div>
      </div>

      {/* Alert Messages */}
      {error && (
        <div className="p-4 bg-[#FDE8EC] border border-[#F8B6C2] rounded-[18px] text-xs font-semibold text-[#ED002B] flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-[#EAF8F1] border border-[#A7E4C4] rounded-[18px] text-xs font-semibold text-[#1B9357] flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Filter Chips & Search Bar */}
      <div className="bg-white p-3 sm:p-4 rounded-[18px] sm:rounded-[22px] border border-[#DDE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
        {/* Search */}
        <div className="relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#60708C] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari item barang..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[16px] text-xs text-[#17233D] outline-none focus:border-[#ED002B]"
          />
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full no-scrollbar">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
              categoryFilter === 'all'
                ? 'bg-[#17233D] text-white'
                : 'bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            Semua ({inventory.length})
          </button>
          <button
            type="button"
            onClick={() => setCategoryFilter('ordered')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
              categoryFilter === 'ordered'
                ? 'bg-[#ED002B] text-white'
                : 'bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            Diorder ({orderSummary.totalItemsCount})
          </button>
          <button
            type="button"
            onClick={() => setCategoryFilter('meat')}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              categoryFilter === 'meat'
                ? 'bg-[#17233D] text-white'
                : 'bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            Ayam &amp; Kulit
          </button>
          <button
            type="button"
            onClick={() => setCategoryFilter('staple')}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              categoryFilter === 'staple'
                ? 'bg-[#17233D] text-white'
                : 'bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            Bahan Pokok
          </button>
          <button
            type="button"
            onClick={() => setCategoryFilter('sauce')}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              categoryFilter === 'sauce'
                ? 'bg-[#17233D] text-white'
                : 'bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            Saus &amp; Bumbu
          </button>
          <button
            type="button"
            onClick={() => setCategoryFilter('pack')}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              categoryFilter === 'pack'
                ? 'bg-[#17233D] text-white'
                : 'bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D]'
            }`}
          >
            Packaging
          </button>
          {orderSummary.totalItemsCount > 0 && (
            <button
              type="button"
              onClick={handleResetAll}
              className="ml-auto text-xs text-[#60708C] hover:text-[#ED002B] flex items-center space-x-1 pl-2 whitespace-nowrap shrink-0"
              title="Reset semua quantity ke 0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Qty</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Container: Mobile Card List + Desktop Table */}
      <div className="bg-white rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
        {/* Subheader */}
        <div className="p-3.5 sm:p-4 border-b border-[#DDE5F0] bg-[#F8FAFC]/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-[#17233D] uppercase tracking-wider">
              Daftar Barang HD Request
            </span>
            <span className="text-[11px] text-[#60708C] hidden sm:inline">
              (Cukup isi kolom Qty langsung untuk memilih barang)
            </span>
          </div>

          <span className="text-[11px] font-semibold text-[#60708C]">
            Menampilkan: <strong className="text-[#17233D]">{filteredItems.length}</strong> barang
          </span>
        </div>

        {/* 1. Mobile Cards View (sm:hidden) */}
        <div className="sm:hidden divide-y divide-[#DDE5F0]">
          {loading ? (
            <div className="py-12 text-center text-[#60708C] text-sm">Memuat daftar barang HD...</div>
          ) : filteredItems.length > 0 ? (
            filteredItems.map((item) => {
              const qty = quantities[item.id] || 0;
              const subtotal = qty * item.price;
              const isSelected = qty > 0;

              return (
                <div
                  key={item.id}
                  className={`p-3.5 transition-colors ${
                    isSelected ? 'bg-[#FFF8F8]' : 'bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-[#17233D] text-sm leading-snug">
                        {item.itemName}
                      </h4>
                      <div className="flex items-center space-x-2 mt-0.5 text-[11px] text-[#60708C]">
                        <span>Vendor: {item.vendorName || 'Supplier HD'}</span>
                        <span>•</span>
                        <span
                          className={`font-semibold ${
                            item.currentStock > 15
                              ? 'text-[#1B9357]'
                              : item.currentStock > 0
                              ? 'text-[#B88700]'
                              : 'text-[#ED002B]'
                          }`}
                        >
                          Stok: {item.currentStock}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-[#17233D] block">
                        {formatRupiah(item.price)}
                      </span>
                      <span className="text-[10px] text-[#60708C] block">/ unit</span>
                    </div>
                  </div>

                  {/* Stepper counter & Subtotal */}
                  <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-dashed border-[#DDE5F0] gap-1.5">
                    <div className="inline-flex items-center bg-[#F8FAFC] border border-[#DDE5F0] rounded-[8px] p-0.5 shadow-2xs">
                      <button
                        type="button"
                        onClick={() => handleDecrement(item.id)}
                        disabled={qty <= 0}
                        aria-label={`Kurangi ${item.itemName}`}
                        className="w-5 h-5 rounded-[5px] flex items-center justify-center text-[#60708C] active:bg-white disabled:opacity-30"
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={qty === 0 ? '' : qty}
                        onChange={(e) =>
                          handleQuantityChange(
                            item.id,
                            e.target.value === '' ? 0 : parseInt(e.target.value) || 0
                          )
                        }
                        placeholder="0"
                        className="w-7 text-center font-bold text-[11px] text-[#17233D] bg-transparent outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleIncrement(item.id)}
                        aria-label={`Tambah ${item.itemName}`}
                        className="w-5 h-5 rounded-[5px] flex items-center justify-center text-[#ED002B] active:bg-[#FFF2F4]"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[8px] text-[#60708C] block uppercase font-bold tracking-wider">Subtotal</span>
                      <span className={`text-[11px] font-bold ${isSelected ? 'text-[#ED002B]' : 'text-[#60708C]'}`}>
                        {formatRupiah(subtotal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-8 text-center text-[#60708C] text-sm">
              Tidak ada barang yang cocok dengan filter.
            </div>
          )}
        </div>

        {/* 2. Desktop Table (hidden sm:block) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#DDE5F0] text-[11px] font-bold text-[#60708C] uppercase tracking-wider">
                <th className="py-3.5 px-4">Item Barang</th>
                <th className="py-3.5 px-3 text-center">Stok Gudang</th>
                <th className="py-3.5 px-4 text-right">Harga (HB)</th>
                <th className="py-3.5 px-4 text-center w-40">Qty (Order)</th>
                <th className="py-3.5 px-4 text-right">Total Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE5F0] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#60708C]">
                    Memuat daftar barang HD...
                  </td>
                </tr>
              ) : filteredItems.length > 0 ? (
                filteredItems.map((item) => {
                  const qty = quantities[item.id] || 0;
                  const subtotal = qty * item.price;
                  const isSelected = qty > 0;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-[#FFF8F8] hover:bg-[#FFF2F4]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      {/* Item Column */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#17233D] text-sm">
                          {item.itemName}
                        </div>
                        <div className="text-[11px] text-[#60708C] flex items-center space-x-1 mt-0.5">
                          <span>Vendor: {item.vendorName || 'Supplier HD'}</span>
                        </div>
                      </td>

                      {/* Stok Gudang */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            item.currentStock > 15
                              ? 'bg-[#EAF8F1] text-[#1B9357]'
                              : item.currentStock > 0
                              ? 'bg-[#FFF8E6] text-[#B88700]'
                              : 'bg-[#FDE8EC] text-[#ED002B]'
                          }`}
                        >
                          <Boxes className="w-3 h-3 mr-1" />
                          {item.currentStock}
                        </span>
                      </td>

                      {/* Harga HB */}
                      <td className="py-3 px-4 text-right font-medium text-[#17233D]">
                        {formatRupiah(item.price)}
                      </td>

                      {/* Kolom Input Qty: langsung masukin quantity aja */}
                      <td className="py-3 px-4 text-center">
                        <div className="inline-flex items-center space-x-1 bg-white border border-[#DDE5F0] rounded-[16px] p-1 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => handleDecrement(item.id)}
                            disabled={qty <= 0}
                            className="w-7 h-7 rounded-[12px] flex items-center justify-center text-[#60708C] hover:bg-[#F8FAFC] hover:text-[#17233D] disabled:opacity-30"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={qty === 0 ? '' : qty}
                            onChange={(e) =>
                              handleQuantityChange(
                                item.id,
                                e.target.value === '' ? 0 : parseInt(e.target.value) || 0
                              )
                            }
                            placeholder="0"
                            className="w-14 text-center font-extrabold text-sm text-[#17233D] bg-transparent outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleIncrement(item.id)}
                            className="w-7 h-7 rounded-[12px] flex items-center justify-center text-[#ED002B] hover:bg-[#FFF2F4]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      {/* Total Subtotal */}
                      <td className="py-3 px-4 text-right font-bold text-sm">
                        <span className={isSelected ? 'text-[#ED002B]' : 'text-[#60708C]'}>
                          {formatRupiah(subtotal)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#60708C]">
                    Tidak ada barang yang cocok dengan pencarian filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating / Sticky Order Summary & Submit Bar (Floating above mobile bottom nav) */}
      <div className="sticky bottom-16 md:bottom-4 z-30 bg-white/95 backdrop-blur-md p-2 sm:p-5 rounded-[14px] sm:rounded-[22px] border sm:border-2 border-[#DDE5F0] shadow-md sm:shadow-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4">
        <div className="grid grid-cols-3 sm:flex sm:items-center sm:space-x-4 divide-x divide-[#DDE5F0]">
          <div className="text-center sm:text-left pr-1 sm:pr-0">
            <span className="text-[8px] sm:text-[10px] text-[#60708C] block uppercase font-bold tracking-wider">
              Item
            </span>
            <div className="text-[11px] sm:text-base font-extrabold text-[#17233D] mt-0.5">
              {orderSummary.totalItemsCount} <span className="text-[8px] sm:text-xs font-medium text-[#60708C]">jenis</span>
            </div>
          </div>

          <div className="text-center sm:text-left px-1 sm:px-0 sm:pl-4">
            <span className="text-[8px] sm:text-[10px] text-[#60708C] block uppercase font-bold tracking-wider">
              Total Qty
            </span>
            <div className="text-[11px] sm:text-base font-extrabold text-[#17233D] mt-0.5">
              {orderSummary.totalQuantity} <span className="text-[8px] sm:text-xs font-medium text-[#60708C]">unit</span>
            </div>
          </div>

          <div className="text-center sm:text-left pl-1 sm:pl-4">
            <span className="text-[8px] sm:text-[10px] text-[#60708C] block uppercase font-bold tracking-wider">
              Total Nilai
            </span>
            <div className="text-[11px] sm:text-lg font-black text-[#ED002B] mt-0.5 truncate">
              {formatRupiah(orderSummary.totalAmount)}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 sm:space-x-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleResetAll}
            disabled={orderSummary.totalItemsCount === 0 || submitting}
            className="px-2 sm:px-4 py-1 sm:py-2.5 bg-white text-[#60708C] hover:text-[#ED002B] text-[10px] sm:text-xs font-bold rounded-[10px] sm:rounded-[18px] border border-[#DDE5F0] disabled:opacity-40 transition-colors min-h-[30px] sm:min-h-[44px]"
          >
            Reset
          </button>
          <button
            id="btn-submit-hd-order"
            type="button"
            onClick={handleSubmitOrder}
            disabled={orderSummary.totalItemsCount === 0 || submitting}
            className="flex-1 sm:flex-none px-2.5 sm:px-6 py-1 sm:py-2.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[11px] sm:text-sm font-bold rounded-[10px] sm:rounded-[18px] shadow-xs sm:shadow-sm flex items-center justify-center space-x-1 sm:space-x-2 transition-all disabled:opacity-50 min-h-[30px] sm:min-h-[44px]"
          >
            <ShoppingBag className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">
              {submitting
                ? 'Mengirim...'
                : `Ajukan Order (${orderSummary.totalItemsCount})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
