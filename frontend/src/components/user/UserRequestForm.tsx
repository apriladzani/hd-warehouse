import { Toolbar } from '../common/UI.tsx';
import { StateMessage } from '../common/UI.tsx';
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
import { localDateInputValue } from '../../lib/format.ts';

const CATEGORY_PRIORITY = ['Raw Material', 'Support Material', 'Packaging'];

const compareInventoryItems = (left: InventoryItem, right: InventoryItem) => {
  const leftCategory = CATEGORY_PRIORITY.indexOf(left.category);
  const rightCategory = CATEGORY_PRIORITY.indexOf(right.category);
  const categoryOrder = (leftCategory < 0 ? CATEGORY_PRIORITY.length : leftCategory)
    - (rightCategory < 0 ? CATEGORY_PRIORITY.length : rightCategory);
  return categoryOrder || left.itemCode.localeCompare(right.itemCode, undefined, { numeric: true, sensitivity: 'base' });
};

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
  const [outletAssignmentLoading, setOutletAssignmentLoading] = useState(true);

  // Form Headers requested by user: "Tgl... Otlet...."
  const [requestDate, setRequestDate] = useState<string>(
    localDateInputValue()
  );
  const [outletName, setOutletName] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Transfer');

  // Quantities map: { [itemId: number]: number }
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Fetch available inventory items
  useEffect(() => {
    const fetchInventory = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/inventory');
        const data = await res.json();
        const itemMap = new Map<number, InventoryItem>();
        (Array.isArray(data.items) ? data.items as InventoryItem[] : []).forEach((item) => {
          if (Number.isFinite(Number(item.id)) && !itemMap.has(Number(item.id))) itemMap.set(Number(item.id), item);
        });
        const items = Array.from(itemMap.values()).sort(compareInventoryItems);
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

    const fetchOutletAssignment = async () => {
      setOutletAssignmentLoading(true);
      const credentials = currentUser as User & { password?: string };
      try {
        const response = await fetch('/api/outlet/profile', { headers: {
          'X-Auth-Email': currentUser.email,
          'X-Auth-Password': credentials.password || '',
        } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Penempatan outlet tidak dapat dimuat.');
        setOutletName(result.outletName || '');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Penempatan outlet tidak dapat dimuat.');
      } finally {
        setOutletAssignmentLoading(false);
      }
    };
    fetchOutletAssignment();
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

  const categoryOptions = useMemo(() => Array.from(new Set(inventory.map((item) => item.category)))
    .sort((left, right) => {
      const leftOrder = CATEGORY_PRIORITY.indexOf(left);
      const rightOrder = CATEGORY_PRIORITY.indexOf(right);
      return (leftOrder < 0 ? CATEGORY_PRIORITY.length : leftOrder) - (rightOrder < 0 ? CATEGORY_PRIORITY.length : rightOrder)
        || left.localeCompare(right);
    }), [inventory]);

  // Filtered items list
  const filteredItems = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch =
        item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.vendorName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.vendorCode || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      const qty = quantities[item.id] || 0;
      if (categoryFilter === 'ordered') {
        return qty > 0;
      }
      return categoryFilter === 'all' || item.category === categoryFilter;
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

    if (outletAssignmentLoading || !outletName.trim()) {
      setError('Akun ini belum memiliki penempatan outlet. Hubungi Admin.');
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

      const credentials = currentUser as User & { password?: string };
      const payload = {
        paymentMethod,
        requestDate,
        items: orderedItems,
      };

      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Email': currentUser.email,
          'X-Auth-Password': credentials.password || '',
        },
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
    <div className="hd-outlet-request-form space-y-4">
      {/* Header Form: Tgl & Outlet */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-[#E2E8F0] space-y-2.5 sm:space-y-3.5">
        <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2.5 sm:pb-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="px-2 py-0.5 bg-[#F0002B]/10 text-[#F0002B] text-[10px] sm:text-[11px] font-bold rounded-full tracking-wider uppercase">
              HD Order
            </span>
            <h2 className="text-sm sm:text-lg font-bold text-[#1E293B] tracking-tight">
              Daftar Permintaan Barang
            </h2>
          </div>

          <div className="flex items-center space-x-1 text-[11px] sm:text-xs text-[#64748B] shrink-0">
            <span className="hidden sm:inline">Pemohon:</span>
            <strong className="text-[#1E293B] bg-[#F8FAFC] px-2 py-0.5 rounded-full border border-[#E2E8F0] max-w-[130px] sm:max-w-none truncate block">
              {currentUser.name}
            </strong>
          </div>
        </div>

        {/* Input Tgl, Outlet, & Metode Pembayaran (Ultra Compact & Mobile-Friendly) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-3.5 pt-0.5">
          {/* Kolom Tanggal */}
          <div className="col-span-1">
            <label className="block text-[10px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider mb-0.5 sm:mb-1 flex items-center space-x-1">
              <Calendar className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#F0002B] shrink-0" />
              <span className="truncate">Tgl Order</span>
            </label>
            <input
              id="input-hd-tgl"
              type="date"
              value={requestDate}
              onChange={(e) => setRequestDate(e.target.value)}
              className="w-full px-2 py-0.5 sm:px-3.5 sm:py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] sm:rounded-xl text-[10px] sm:text-xs font-semibold text-[#1E293B] outline-none focus:border-[#F0002B] h-[30px] sm:h-[40px]"
            />
          </div>

          {/* Kolom Outlet */}
          <div className="col-span-1">
            <label className="block text-[10px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider mb-0.5 sm:mb-1 flex items-center space-x-1">
              <Store className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#F0002B] shrink-0" />
              <span className="truncate">Outlet</span>
            </label>
            <div id="outlet-assignment-display" aria-live="polite" className="flex h-[30px] items-center truncate rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-2 text-[11px] font-bold text-[#1E293B] sm:h-[40px] sm:px-3.5 sm:text-xs">
              {outletAssignmentLoading ? 'Memuat penempatan…' : outletName || 'Belum ditempatkan'}
            </div>
          </div>

          {/* Kolom Metode Pembayaran */}
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[10px] sm:text-xs font-bold text-[#64748B] uppercase tracking-wider mb-0.5 sm:mb-1 flex items-center space-x-1">
              <CreditCard className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#F0002B] shrink-0" />
              <span className="truncate">Metode Pembayaran</span>
            </label>
            <select
              id="select-hd-payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-2 py-0.5 sm:px-3.5 sm:py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] sm:rounded-xl text-[10px] sm:text-xs font-semibold text-[#1E293B] outline-none focus:border-[#F0002B] cursor-pointer h-[30px] sm:h-[40px]"
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
        <div className="p-4 bg-[#FDE8EC] border border-[#F8B6C2] rounded-xl text-xs font-semibold text-[#F0002B] flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-[#EAF8F1] border border-[#A7E4C4] rounded-xl text-xs font-semibold text-[#1B9357] flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Filter Chips & Search Bar */}
      <Toolbar>
        {/* Search */}
        <div className="hd-outlet-request-search relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama atau kode barang..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs text-[#1E293B] outline-none focus:border-[#F0002B]"
          />
        </div>

        {/* Category Filters */}
        <div className="hd-outlet-request-filters flex flex-wrap items-center gap-1.5 max-w-full">
          <div className="hd-category-chip-scroll inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-[#E2E8F0] bg-white p-0.5 no-scrollbar">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              aria-pressed={categoryFilter === 'all'}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${categoryFilter === 'all' ? 'bg-[#1E293B] text-white' : 'text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#1E293B]'}`}
            >
              Semua
            </button>
            {categoryOptions.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryFilter(category)}
                aria-pressed={categoryFilter === category}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${categoryFilter === category ? 'bg-[#1E293B] text-white' : 'text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#1E293B]'}`}
              >
                {category}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCategoryFilter('ordered')}
            aria-pressed={categoryFilter === 'ordered'}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${categoryFilter === 'ordered' ? 'border-[#F0002B] bg-[#FFF1F3] text-[#C8102E]' : 'border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC]'}`}
          >
            Diorder ({orderSummary.totalItemsCount})
          </button>
          {orderSummary.totalItemsCount > 0 && (
            <button
              type="button"
              onClick={handleResetAll}
              className="ml-auto text-xs text-[#64748B] hover:text-[#F0002B] flex items-center space-x-1 pl-2 whitespace-nowrap shrink-0"
              title="Reset semua quantity ke 0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Qty</span>
            </button>
          )}
        </div>
      </Toolbar>

      {/* Main Container: Mobile Card List + Desktop Table */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden ">
        {/* Subheader */}
        <div className="p-3.5 sm:p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-[#1E293B] uppercase tracking-wider">
              Daftar Barang HD Request
            </span>
            <span className="text-[11px] text-[#64748B] hidden sm:inline">
              (Cukup isi kolom Qty langsung untuk memilih barang)
            </span>
          </div>

          <span className="text-[11px] font-semibold text-[#64748B]">
            Menampilkan: <strong className="text-[#1E293B]">{filteredItems.length}</strong> barang
          </span>
        </div>

        {/* 1. Mobile Cards View (sm:hidden) */}
        <div className="hd-outlet-request-list sm:hidden divide-y divide-[#E2E8F0]">
          {loading ? (
            <StateMessage kind="loading">Memuat daftar barang HD...</StateMessage>
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
                      <h4 className="font-bold text-[#1E293B] text-sm leading-snug">
                        {item.itemName}
                      </h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[#64748B]">
                        <span className="font-mono font-semibold text-[#475569]">{item.itemCode}</span>
                        <span>·</span>
                        <span>{item.category}</span>
                        <span>·</span>
                        <span>Satuan: pcs</span>
                        <span>·</span>
                        <span
                          className={`font-semibold ${
                            item.currentStock > 15
                              ? 'text-[#1B9357]'
                              : item.currentStock > 0
                              ? 'text-[#B88700]'
                              : 'text-[#F0002B]'
                          }`}
                        >
                          Stok: {item.currentStock}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-[#1E293B] block">
                        {formatRupiah(item.price)}
                      </span>
                      <span className="text-[10px] text-[#64748B] block">Harga katalog / pcs</span>
                    </div>
                  </div>

                  {/* Stepper counter & Subtotal */}
                  <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-dashed border-[#E2E8F0] gap-1.5">
                    <div className="hd-qty-stepper inline-flex items-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] p-0.5 ">
                      <button
                        type="button"
                        onClick={() => handleDecrement(item.id)}
                        disabled={qty <= 0}
                        aria-label={`Kurangi ${item.itemName}`}
                        className="hd-qty-stepper-button w-5 h-5 rounded-[5px] flex items-center justify-center text-[#64748B] active:bg-white disabled:opacity-30"
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
                        className="hd-qty-stepper-input w-7 text-center font-bold text-[11px] text-[#1E293B] bg-transparent outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleIncrement(item.id)}
                        aria-label={`Tambah ${item.itemName}`}
                        className="hd-qty-stepper-button w-5 h-5 rounded-[5px] flex items-center justify-center text-[#F0002B] active:bg-[#FFF2F4]"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] text-[#64748B] block uppercase font-bold tracking-wider">Subtotal</span>
                      <span className={`text-[11px] font-bold ${isSelected ? 'text-[#F0002B]' : 'text-[#64748B]'}`}>
                        {formatRupiah(subtotal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <StateMessage>Tidak ada barang yang cocok dengan filter.</StateMessage>
          )}
        </div>

        {/* 2. Desktop Table (hidden sm:block) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                <th className="py-3.5 px-4">Item Barang</th>
                <th className="py-3.5 px-3 text-center">Stok Gudang</th>
                <th className="py-3.5 px-4 text-center">Satuan</th>
                <th className="py-3.5 px-4 text-right">Harga Katalog</th>
                <th className="py-3.5 px-4 text-center w-40">Qty (Order)</th>
                <th className="py-3.5 px-4 text-right">Total Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6}><StateMessage kind="loading">Memuat daftar barang HD...</StateMessage></td>
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
                        <div className="font-bold text-[#1E293B] text-sm">
                          {item.itemName}
                        </div>
                        <div className="text-[11px] text-[#64748B] flex flex-wrap items-center gap-x-1.5 mt-0.5">
                          <span className="font-mono font-semibold text-[#475569]">{item.itemCode}</span>
                          <span>·</span>
                          <span>{item.category}</span>
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
                              : 'bg-[#FDE8EC] text-[#F0002B]'
                          }`}
                        >
                          <Boxes className="w-3 h-3 mr-1" />
                          {item.currentStock}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center text-[#64748B]">pcs</td>

                      {/* Harga HB */}
                      <td className="py-3 px-4 text-right font-medium text-[#1E293B]">
                        {formatRupiah(item.price)}
                      </td>

                      {/* Kolom Input Qty: langsung masukin quantity aja */}
                      <td className="py-3 px-4 text-center">
                        <div className="inline-flex items-center space-x-1 bg-white border border-[#E2E8F0] rounded-xl p-1 ">
                          <button
                            type="button"
                            onClick={() => handleDecrement(item.id)}
                            disabled={qty <= 0}
                            className="w-7 h-7 rounded-[12px] flex items-center justify-center text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#1E293B] disabled:opacity-30"
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
                            className="w-14 text-center font-bold text-sm text-[#1E293B] bg-transparent outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleIncrement(item.id)}
                            className="w-7 h-7 rounded-[12px] flex items-center justify-center text-[#F0002B] hover:bg-[#FFF2F4]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      {/* Total Subtotal */}
                      <td className="py-3 px-4 text-right font-bold text-sm">
                        <span className={isSelected ? 'text-[#F0002B]' : 'text-[#64748B]'}>
                          {formatRupiah(subtotal)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6}><StateMessage>Tidak ada barang yang cocok dengan pencarian filter.</StateMessage></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sticky order summary keeps the submit action in reach. */}
      <div className="hd-order-summary sticky bottom-3 md:bottom-4 z-20 bg-white p-3 sm:px-4 sm:py-3 rounded-xl border border-[#E2E8F0] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <div className="grid grid-cols-3 sm:flex sm:items-center divide-x divide-[#E2E8F0] min-w-0">
          <div className="min-w-0 text-center sm:text-left pr-2 sm:pr-4">
            <span className="text-[11px] text-[#64748B] block font-medium">
              Item
            </span>
            <div className="text-base sm:text-lg font-semibold text-[#1E293B] mt-0.5 tabular-nums">
              {orderSummary.totalItemsCount} <span className="text-[10px] sm:text-xs font-medium text-[#64748B]">jenis</span>
            </div>
          </div>

          <div className="min-w-0 text-center sm:text-left px-2 sm:px-4">
            <span className="text-[11px] text-[#64748B] block font-medium">
              Total Qty
            </span>
            <div className="text-base sm:text-lg font-semibold text-[#1E293B] mt-0.5 tabular-nums">
              {orderSummary.totalQuantity} <span className="text-[10px] sm:text-xs font-medium text-[#64748B]">unit</span>
            </div>
          </div>

          <div className="min-w-0 text-center sm:text-left pl-2 sm:pl-4">
            <span className="text-[11px] text-[#64748B] block font-medium">
              Total Nilai
            </span>
            <div className="text-base sm:text-lg font-semibold text-[#F0002B] mt-0.5 truncate tabular-nums">
              {formatRupiah(orderSummary.totalAmount)}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 w-full sm:w-auto shrink-0">
          <button
            type="button"
            onClick={handleResetAll}
            disabled={orderSummary.totalItemsCount === 0 || submitting}
            className="h-9 px-3 bg-white text-[#64748B] hover:text-[#F0002B] text-xs font-semibold rounded-lg border border-[#E2E8F0] disabled:bg-[#F8FAFC] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors"
          >
            Reset
          </button>
          <button
            id="btn-submit-hd-order"
            type="button"
            onClick={handleSubmitOrder}
            disabled={orderSummary.totalItemsCount === 0 || submitting}
            className="h-9 shrink-0 px-3 sm:px-4 bg-[#F0002B] hover:bg-[#D80027] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:bg-[#C24155] disabled:text-white disabled:cursor-not-allowed"
          >
            <ShoppingBag className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span className="whitespace-nowrap">
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
