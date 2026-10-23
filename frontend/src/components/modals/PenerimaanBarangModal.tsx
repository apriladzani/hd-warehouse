import React, { useState } from 'react';
import {
  X,
  ArrowDownToLine,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Printer,
} from 'lucide-react';
import { InventoryItem, Vendor } from '../../types.ts';
import { formatRupiah, localDateInputValue } from '../../lib/format.ts';
import { PrintableTransactionA4 } from './PrintableTransactionA4.tsx';

interface PenerimaanBarangModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  items: InventoryItem[];
  vendors: Vendor[];
  initialItemId?: number | null;
}

interface StagedReceiptItem {
  id: string;
  itemId?: number;
  itemName: string;
  vendorId?: number;
  vendorCode: string;
  vendorName: string;
  quantity: number;
  price: number;
  currentStock: number;
  subtotal: number;
  avgCostAfter?: number;
}

export const PenerimaanBarangModal: React.FC<PenerimaanBarangModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  items,
  vendors,
  initialItemId = null,
}) => {
  // Direct form inputs
  const [selectedItemId, setSelectedItemId] = useState<number | 'new'>(
    initialItemId ? initialItemId : items[0]?.id || 'new'
  );
  const [customItemName, setCustomItemName] = useState('');

  const [selectedVendorId, setSelectedVendorId] = useState<number | 'new'>(
    vendors[0]?.id || 'new'
  );
  const [customVendorCode, setCustomVendorCode] = useState('');
  const [customVendorName, setCustomVendorName] = useState('');

  const [quantity, setQuantity] = useState<number>(50);
  // PERATURAN: JANGAN mengambil harga dari harga katalog!
  // Harga katalog hanya digunakan untuk proses pembelian/request oleh user.
  // Untuk penerimaan barang, gunakan harga beli yang diinput secara manual pada setiap transaksi.
  const [price, setPrice] = useState<number | ''>('');

  const [transactionDate, setTransactionDate] = useState<string>(
    localDateInputValue()
  );
  const [paymentMethod, setPaymentMethod] = useState<string>('Transfer');

  // List of staged items for receiving batch
  const [stagedList, setStagedList] = useState<StagedReceiptItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Success print modal state
  const [completedTransaction, setCompletedTransaction] = useState<any | null>(null);
  const [showPrintA4, setShowPrintA4] = useState(false);

  if (!isOpen) return null;

  // Selected item reference
  const currentItem = selectedItemId !== 'new' ? items.find((i) => i.id === selectedItemId) : null;
  const currentVendor = selectedVendorId !== 'new' ? vendors.find((v) => v.id === selectedVendorId) : null;

  // Sync vendor when selected item changes (DO NOT touch price from catalog!)
  const handleItemSelect = (idStr: string) => {
    if (idStr === 'new') {
      setSelectedItemId('new');
    } else {
      const numId = Number(idStr);
      setSelectedItemId(numId);
      const matched = items.find((i) => i.id === numId);
      if (matched) {
        // PERATURAN: Harga beli tidak diambil dari katalog. Tetap gunakan input manual user.
        // If item has active vendors, select first active vendor
        if (matched.activeVendors && matched.activeVendors.length > 0) {
          setSelectedVendorId(matched.activeVendors[0].id);
        } else if (matched.vendorId && vendors.some((v) => v.id === matched.vendorId)) {
          setSelectedVendorId(matched.vendorId);
        }
      }
    }
  };

  const handleVendorSelect = (vStr: string) => {
    if (vStr === 'new') {
      setSelectedVendorId('new');
    } else {
      setSelectedVendorId(Number(vStr));
    }
  };

  // Live preview calculation for weighted average cost
  // RUMUS MURNI: Σ(Quantity × Harga Beli) / Σ Quantity (harga rata-rata sebelumnya jangan di kalkulasikan)
  const targetItemName =
    selectedItemId === 'new'
      ? customItemName.trim()
      : currentItem?.itemName.trim() || '';

  const stagedForThisItem = stagedList.filter((it) => {
    if (selectedItemId !== 'new' && it.itemId && it.itemId === Number(selectedItemId)) {
      return true;
    }
    if (targetItemName && it.itemName.toLowerCase() === targetItemName.toLowerCase()) {
      return true;
    }
    return false;
  });

  const stagedQty = stagedForThisItem.reduce((sum, it) => sum + it.quantity, 0);
  const stagedVal = stagedForThisItem.reduce((sum, it) => sum + it.subtotal, 0);

  const numPrice = Number(price) || 0;
  const numQty = Number(quantity) || 0;
  const currentInputSubtotal = numQty * numPrice;

  const totalItemVal = stagedVal + currentInputSubtotal;
  const totalItemQty = stagedQty + numQty;
  const previewAvgAfter = totalItemQty > 0 ? Math.round(totalItemVal / totalItemQty) : numPrice;

  const handleAddItemToReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const itemName =
      selectedItemId === 'new'
        ? customItemName.trim()
        : currentItem?.itemName.trim() || '';

    const vendorCode =
      selectedVendorId === 'new'
        ? customVendorCode.trim().toUpperCase()
        : currentVendor?.vendorCode.trim() || '';

    const vendorName =
      selectedVendorId === 'new'
        ? customVendorName.trim()
        : currentVendor?.vendorName.trim() || '';

    if (!itemName) {
      setErrorMessage('Nama barang wajib ditentukan!');
      return;
    }
    if (!vendorCode || !vendorName) {
      setErrorMessage('Vendor & kode vendor wajib ditentukan!');
      return;
    }
    if (!quantity || quantity <= 0) {
      setErrorMessage('Kuantitas barang harus lebih dari 0!');
      return;
    }
    const currentPrice = Number(price);
    if (price === '' || isNaN(currentPrice) || currentPrice <= 0) {
      setErrorMessage('Harga beli satuan wajib diinput manual (lebih dari Rp 0)!');
      return;
    }

    const newItem: StagedReceiptItem = {
      id: `${Date.now()}-${Math.random()}`,
      itemId: selectedItemId !== 'new' ? Number(selectedItemId) : undefined,
      itemName,
      vendorId: selectedVendorId !== 'new' ? Number(selectedVendorId) : undefined,
      vendorCode,
      vendorName,
      quantity: Number(quantity),
      price: currentPrice,
      currentStock: currentItem ? currentItem.currentStock : 0,
      subtotal: Number(quantity) * currentPrice, // Subtotal = Quantity × Harga Beli Input
      avgCostAfter: previewAvgAfter,
    };

    const updatedList = [...stagedList, newItem];

    // Helper key: strictly isolate per itemId or per normalized itemName
    const getItemKey = (it: { itemId?: number; itemName: string }) =>
      it.itemId ? `id_${it.itemId}` : `name_${it.itemName.trim().toLowerCase()}`;

    // Group strictly by item_id / item_name so every item is isolated:
    // Semua transaksi Ayam hanya dirata-ratakan dengan transaksi Ayam.
    // Semua transaksi Beras hanya dirata-ratakan dengan transaksi Beras.
    // Semua transaksi Packaging hanya dirata-ratakan dengan transaksi Packaging.
    const groupTotals = new Map<string, { totalVal: number; totalQty: number }>();
    for (const it of updatedList) {
      const k = getItemKey(it);
      const curr = groupTotals.get(k) || { totalVal: 0, totalQty: 0 };
      curr.totalVal += it.subtotal;
      curr.totalQty += it.quantity;
      groupTotals.set(k, curr);
    }

    const finalList = updatedList.map((it) => {
      const k = getItemKey(it);
      const stats = groupTotals.get(k);
      const avg = stats && stats.totalQty > 0 ? Math.round(stats.totalVal / stats.totalQty) : it.price;
      return { ...it, avgCostAfter: avg };
    });

    setStagedList(finalList);

    // Reset fields for next item
    setCustomItemName('');
    setQuantity(50);
  };

  const handleRemoveStagedItem = (id: string) => {
    setStagedList((prev) => prev.filter((it) => it.id !== id));
  };

  // Submit all received items
  const handleSubmitAll = async () => {
    setErrorMessage(null);
    let itemsToProcess = [...stagedList];

    // If list is empty but current form has valid input, auto-stage it
    if (itemsToProcess.length === 0) {
      const itemName =
        selectedItemId === 'new'
          ? customItemName.trim()
          : currentItem?.itemName.trim() || '';

      const vendorCode =
        selectedVendorId === 'new'
          ? customVendorCode.trim().toUpperCase()
          : currentVendor?.vendorCode.trim() || '';

      const vendorName =
        selectedVendorId === 'new'
          ? customVendorName.trim()
          : currentVendor?.vendorName.trim() || '';

      const numPrice = Number(price);
      if (!itemName || !vendorCode || !vendorName || quantity <= 0 || price === '' || isNaN(numPrice) || numPrice <= 0) {
        setErrorMessage('Silakan lengkapi barang, vendor, kuantitas, dan input manual harga beli satuan (lebih dari Rp 0).');
        return;
      }

      itemsToProcess = [
        {
          id: 'direct',
          itemId: selectedItemId !== 'new' ? Number(selectedItemId) : undefined,
          itemName,
          vendorId: selectedVendorId !== 'new' ? Number(selectedVendorId) : undefined,
          vendorCode,
          vendorName,
          quantity: Number(quantity),
          price: numPrice,
          currentStock: currentItem ? currentItem.currentStock : 0,
          subtotal: Number(quantity) * numPrice, // Subtotal = Quantity × Harga Beli Input
          avgCostAfter: previewAvgAfter || numPrice,
        },
      ];
    }

    // Group items by vendor or send under primary vendor
    const primaryVendor = itemsToProcess[0];

    try {
      setSubmitting(true);
      const payload = {
        vendorCode: primaryVendor.vendorCode,
        vendorName: primaryVendor.vendorName,
        paymentMethod,
        transactionDate,
        items: itemsToProcess.map((it) => ({
          itemId: it.itemId,
          itemName: it.itemName,
          price: it.price,
          quantity: it.quantity,
        })),
        createdBy: 'Staff Gudang',
      };

      const res = await fetch('/api/inventory/incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memproses penerimaan barang');

      // Prepared print data with accurate backend/preview avgCostAfter
      setCompletedTransaction({
        ...data.purchase,
        items: (data.purchase?.items && data.purchase.items.length > 0)
          ? data.purchase.items
          : itemsToProcess.map((it) => ({
              itemId: it.itemId,
              itemName: it.itemName,
              quantity: it.quantity,
              price: it.price,
              subtotal: it.subtotal,
              avgCostAfter: it.avgCostAfter || it.price,
            })),
      });

      onSuccess();
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan sistem saat penerimaan');
    } finally {
      setSubmitting(false);
    }
  };

  const totalReceiptValue =
    stagedList.length > 0
      ? stagedList.reduce((sum, it) => sum + it.subtotal, 0)
      : quantity * (Number(price) || 0);

  const totalReceiptQty =
    stagedList.length > 0
      ? stagedList.reduce((sum, it) => sum + it.quantity, 0)
      : quantity;

  return (
    <>
      <div className="hd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/55 backdrop-blur-xs overflow-y-auto">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="receiving-modal-title"
          className="hd-dialog bg-white w-full max-w-2xl rounded-xl border border-[#E2E8F0] overflow-hidden flex flex-col max-h-[94dvh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-3 border-b border-[#E2E8F0] bg-[#1E293B] text-white">
            <div className="flex items-center space-x-2 sm:space-x-3">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-[8px] sm:rounded-[10px] bg-[#F0002B] text-white flex items-center justify-center font-bold">
                <ArrowDownToLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div>
                <h2 id="receiving-modal-title" className="text-sm sm:text-base font-bold tracking-tight">
                  Penerimaan Barang Masuk (Receiving)
                </h2>
                <p className="text-[10px] sm:text-xs text-[#94A3B8]">
                  Pilih barang, tentukan vendor pemasok, kuantitas, dan harga beli satuan.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Tutup modal penerimaan"
              className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Success Screen with Direct Print Action */}
          {completedTransaction ? (
            <div className="p-4 sm:p-8 text-center space-y-4 overflow-y-auto">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[#EAF8F1] text-[#1B9357] rounded-full mx-auto flex items-center justify-center ">
                <CheckCircle2 className="w-7 h-7 sm:w-10 sm:h-10" />
              </div>

              <div>
                <h3 className="text-base sm:text-xl font-bold text-[#1E293B]">
                  Penerimaan Barang Berhasil Disimpan!
                </h3>
                <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md mx-auto">
                  Nomor Transaksi: <strong className="text-[#1E293B] font-mono">{completedTransaction.transactionCode}</strong>.
                  Stok barang telah otomatis diperbarui dan digabungkan ke katalog gudang.
                </p>
              </div>

              <div className="p-3 sm:p-4 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl max-w-lg mx-auto text-left text-[11px] sm:text-xs space-y-1.5 sm:space-y-2">
                <div className="flex justify-between font-semibold">
                  <span className="text-[#64748B]">Vendor:</span>
                  <span className="text-[#1E293B]">{completedTransaction.vendorName}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-[#64748B]">Total Nilai Barang:</span>
                  <span className="text-[#F0002B] font-bold">{formatRupiah(completedTransaction.totalAmount)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-[#64748B]">Status Stok:</span>
                  <span className="text-[#1B9357] font-bold">Tercatat ke Stok Utama (Unified Pool)</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 pt-2">
                <button
                  id="btn-print-immediate-a4"
                  onClick={() => setShowPrintA4(true)}
                  className="w-full sm:w-auto inline-flex items-center justify-center space-x-1.5 px-4 py-2 sm:px-6 sm:py-3 bg-[#F0002B] hover:bg-[#D80027] text-white text-[11px] sm:text-xs font-bold rounded-[10px] sm:rounded-xl  transition-all cursor-pointer min-h-[36px] sm:min-h-[36px]"
                >
                  <Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>Cetak Surat Penerimaan (Kertas A4)</span>
                </button>

                <button
                  onClick={() => {
                    setCompletedTransaction(null);
                    setStagedList([]);
                    onClose();
                  }}
                  className="w-full sm:w-auto px-4 py-2 sm:px-6 sm:py-3 bg-white hover:bg-gray-100 text-[#1E293B] text-[11px] sm:text-xs font-bold rounded-[10px] sm:rounded-xl border border-[#E2E8F0] transition-colors min-h-[36px] sm:min-h-[36px]"
                >
                  Tutup Selesai
                </button>
              </div>
            </div>
          ) : (
            /* Main Form Area */
            <div className="min-h-0 flex-1 p-4 sm:p-4 overflow-y-auto overscroll-contain space-y-4">
              {/* Error Alert */}
              {errorMessage && (
                <div className="p-2 sm:p-3 bg-red-50 border border-red-200 text-red-700 text-[10px] sm:text-xs font-semibold rounded-[10px] sm:rounded-[12px] flex items-center space-x-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <p className="text-xs leading-relaxed text-[#64748B]">
                Penerimaan dari vendor berbeda tetap menambah stok barang yang sama di Inventory.
              </p>

              {/* Form Input Row */}
              <form onSubmit={handleAddItemToReceipt} className="space-y-4">
                <div className="flex flex-col gap-3">
                  {/* PILIH BARANG */}
                  <div className="space-y-1 sm:space-y-1.5">
                    <label htmlFor="select-penerimaan-barang" className="text-xs font-semibold text-[#1E293B] flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="flex items-center space-x-1 sm:space-x-1.5">
                        <span>Pilih Barang</span>
                        <span className="text-[#F0002B]">*</span>
                      </span>
                    </label>

                    <div className="relative">
                      <select
                        id="select-penerimaan-barang"
                        value={selectedItemId}
                        onChange={(e) => handleItemSelect(e.target.value)}
                        className="w-full min-w-0 h-10 appearance-none pl-3 pr-10 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                      >
                        <optgroup label="Barang Katalog Terdaftar">
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.itemName} • (Stok: {it.currentStock} pcs)
                            </option>
                          ))}
                        </optgroup>
                        <option value="new">+ Input Barang Baru Lainnya...</option>
                      </select>
                    </div>

                    {selectedItemId === 'new' && (
                      <input
                        id="input-custom-item-name"
                        aria-label="Nama barang baru"
                        type="text"
                        value={customItemName}
                        onChange={(e) => setCustomItemName(e.target.value)}
                        placeholder="Ketik nama barang baru..."
                        className="w-full min-w-0 h-10 px-3 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                        required
                      />
                    )}
                  </div>

                  {/* PILIH VENDOR */}
                  <div className="space-y-1 sm:space-y-1.5">
                    <label htmlFor="select-penerimaan-vendor" className="text-xs font-semibold text-[#1E293B] flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="flex items-center space-x-1 sm:space-x-1.5">
                        <span>Pilih Vendor</span>
                        <span className="text-[#F0002B]">*</span>
                      </span>
                      {currentVendor && (
                        <span className="text-[10px] sm:text-[11px] font-mono font-bold text-[#1E293B]">
                          [{currentVendor.vendorCode}]
                        </span>
                      )}
                    </label>

                    <div className="relative">
                      <select
                        id="select-penerimaan-vendor"
                        value={selectedVendorId}
                        onChange={(e) => handleVendorSelect(e.target.value)}
                        className="w-full min-w-0 h-10 appearance-none pl-3 pr-10 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                      >
                        {/* Active vendors for selected item */}
                        {currentItem?.activeVendors && currentItem.activeVendors.length > 0 && (
                          <optgroup label="⭐ Vendor Rekanan Terdaftar">
                            {currentItem.activeVendors.map((v) => (
                              <option key={`active-${v.id}`} value={v.id}>
                                [{v.vendorCode}] {v.vendorName}
                              </option>
                            ))}
                          </optgroup>
                        )}

                        {/* Other vendors */}
                        <optgroup
                          label={
                            currentItem?.activeVendors && currentItem.activeVendors.length > 0
                              ? 'Vendor Lainnya'
                              : 'Vendor Terdaftar'
                          }
                        >
                          {vendors
                            .filter(
                              (v) =>
                                !currentItem?.activeVendors ||
                                !currentItem.activeVendors.some((av) => av.id === v.id)
                            )
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                [{v.vendorCode}] {v.vendorName}
                              </option>
                            ))}
                        </optgroup>
                        <option value="new">+ Input Vendor Baru Langsung...</option>
                      </select>
                    </div>

                    {selectedVendorId === 'new' && (
                      <div className="grid grid-cols-1 gap-2 mt-2">
                        <input
                          id="input-custom-vendor-code"
                        aria-label="Kode vendor baru"
                          type="text"
                          value={customVendorCode}
                          onChange={(e) => setCustomVendorCode(e.target.value.toUpperCase())}
                          placeholder="Kode (VND-xx)"
                          className="w-full min-w-0 h-10 px-3 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                          required
                        />
                        <input
                          id="input-custom-vendor-name"
                        aria-label="Nama vendor baru"
                          type="text"
                          value={customVendorName}
                          onChange={(e) => setCustomVendorName(e.target.value)}
                          placeholder="Nama Vendor"
                          className="w-full min-w-0 h-10 px-3 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                          required
                        />
                      </div>
                    )}
                  </div>

                  {/* KUANTITAS */}
                  <div className="space-y-1 sm:space-y-1.5">
                    <label htmlFor="input-penerimaan-quantity" className="block text-xs font-semibold text-[#1E293B]">
                      Jumlah Masuk <span className="text-[#F0002B]">*</span>
                    </label>
                    <div className="space-y-1.5">
                      <input
                        id="input-penerimaan-quantity"
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                        className="w-full min-w-0 h-10 px-3 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                        required
                      />
                      {currentItem && (
                        <div className="text-xs leading-relaxed text-[#64748B]">
                          Stok saat ini: <strong className="font-medium text-[#1E293B]">{currentItem.currentStock} pcs</strong>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          Setelah penerimaan ini: <strong className="font-medium text-[#1B9357]">{currentItem.currentStock + Number(quantity || 0)} pcs</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* HARGA BELI SATUAN (INPUT MANUAL) */}
                  <div className="space-y-1 sm:space-y-1.5">
                    <label htmlFor="input-penerimaan-price" className="text-xs font-semibold text-[#1E293B] flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="flex items-center space-x-1 sm:space-x-1.5">
                        <span>Harga Beli per Unit</span>
                        <span className="text-[#F0002B]">*</span>
                      </span>
                      <span className="text-xs text-[#64748B] font-normal">
                        Sesuai invoice vendor
                      </span>
                    </label>
                    <input
                      id="input-penerimaan-price"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Masukkan harga beli (Rp)"
                      value={price}
                      onChange={(e) => setPrice(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                      className="w-full min-w-0 h-10 px-3 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                      required
                    />

                    {/* Info Harga Katalog */}
                    {currentItem && (
                      <div className="flex flex-wrap items-center gap-x-1 text-xs text-[#64748B]">
                        <span>Harga katalog (referensi):</span>
                        <span className="font-mono font-semibold text-[#1E293B]">{formatRupiah(currentItem.price)}</span>
                      </div>
                    )}
                  </div>

                  {/* Tanggal & Metode Pembayaran */}
                  <div className="space-y-1 sm:space-y-1.5">
                    <label htmlFor="input-penerimaan-date" className="block text-xs font-semibold text-[#1E293B] flex items-center space-x-1 sm:space-x-1.5">
                      <span>Tanggal Penerimaan</span>
                    </label>
                    <input
                      id="input-penerimaan-date"
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      className="w-full min-w-0 h-10 px-3 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                    />
                  </div>

                  <div className="space-y-1 sm:space-y-1.5">
                    <label htmlFor="select-penerimaan-payment" className="block text-xs font-semibold text-[#1E293B] flex items-center space-x-1 sm:space-x-1.5">
                      <span>Metode Pembayaran</span>
                    </label>
                    <div className="relative">
                      <select
                        id="select-penerimaan-payment"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full min-w-0 h-10 appearance-none pl-3 pr-10 bg-white border border-[#E2E8F0] rounded-[10px] text-sm text-[#1E293B] outline-none focus:border-[#F0002B] focus:ring-2 focus:ring-[#F0002B]/10"
                      >
                        <option value="Transfer">Transfer Bank</option>
                        <option value="Tunai">Tunai / Cash</option>
                        <option value="Tempo">Tempo (Hutang Usaha)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Compact preview using the existing Inventory reference and preview values. */}
                <section aria-labelledby="receiving-average-heading" className="p-3 sm:p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[12px] space-y-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <h3 id="receiving-average-heading" className="text-sm font-semibold text-[#1E293B]">
                      Estimasi Harga Rata-rata
                    </h3>
                    <span className="text-xs text-[#64748B] break-words">
                      {currentItem ? currentItem.itemName : customItemName || 'Barang Belum Dipilih'}
                    </span>
                  </div>
                  <dl className="space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <dt className="text-xs sm:text-sm text-[#64748B]">Harga rata-rata sebelumnya</dt>
                      <dd className="text-sm font-semibold font-mono text-[#1E293B]">
                        {currentItem?.avgPurchasePrice ? `${formatRupiah(currentItem.avgPurchasePrice)} / item` : '—'}
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <dt className="text-xs sm:text-sm text-[#64748B]">Total nilai pembelian baru</dt>
                      <dd className="text-sm font-semibold font-mono text-[#1E293B]">{formatRupiah(totalItemVal)}</dd>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[8px] bg-[#EAF8F1] px-2.5 py-2">
                      <dt className="text-xs sm:text-sm font-medium text-[#1B9357]">Estimasi harga rata-rata terbaru</dt>
                      <dd className="text-sm sm:text-base font-bold font-mono text-[#1B9357]">
                        {previewAvgAfter > 0 ? `${formatRupiah(previewAvgAfter)} / item` : '—'}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs leading-relaxed text-[#64748B]">
                    Preview mengikuti input barang yang sama dalam batch ini. Nilai final dihitung saat disimpan.
                  </p>
                  <details className="text-xs text-[#64748B]">
                    <summary className="cursor-pointer w-fit rounded focus-visible:outline-2 focus-visible:outline-[#1E293B]">Rumus weighted average</summary>
                    <p className="mt-1.5 leading-relaxed">
                      Total nilai seluruh pembelian ÷ total quantity seluruh pembelian barang yang sama, termasuk dari vendor berbeda.
                    </p>
                  </details>
                </section>

                {/* Subtotal & Add Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-1 sm:px-2">
                  <div className="text-[10px] sm:text-xs text-[#64748B]">
                    Subtotal item ini:{' '}
                    <span className="text-[10px] text-gray-500 font-mono">
                      ({quantity} pcs × {formatRupiah(Number(price) || 0)}) ={' '}
                    </span>
                    <strong className="text-xs sm:text-sm font-bold text-[#F0002B] font-mono">
                      {formatRupiah(quantity * (Number(price) || 0))}
                    </strong>
                  </div>

                  <button
                    id="btn-tambah-ke-daftar-terima"
                    type="submit"
                    className="inline-flex items-center justify-center space-x-1 px-3 py-1.5 sm:px-4 sm:py-2 bg-white hover:bg-gray-50 text-[#1E293B] text-[10px] sm:text-xs font-bold rounded-[10px] sm:rounded-xl border border-[#E2E8F0]  transition-all cursor-pointer min-h-[32px] sm:min-h-[38px]"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#F0002B]" />
                    <span>+ Masukkan ke Daftar Batch</span>
                  </button>
                </div>
              </form>

              {/* Staged Items List if any */}
              {stagedList.length > 0 && (
                <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white">
                  <div className="p-2 sm:p-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between text-[10px] sm:text-xs font-bold text-[#1E293B]">
                    <span>Daftar Barang Diterima ({stagedList.length})</span>
                    <span className="text-[#F0002B] font-mono">{formatRupiah(totalReceiptValue)}</span>
                  </div>
                  <div className="divide-y divide-[#E2E8F0]">
                    {stagedList.map((item) => (
                      <div key={item.id} className="p-2 sm:p-3 flex items-center justify-between text-[10px] sm:text-xs">
                        <div className="space-y-0.5">
                          <div className="font-bold text-[#1E293B]">{item.itemName}</div>
                          <div className="text-[10px] sm:text-[11px] text-[#64748B] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>Vendor: <strong className="text-[#1E293B]">[{item.vendorCode}] {item.vendorName}</strong></span>
                            <span>•</span>
                            <span>Qty: <strong className="text-[#1E293B] font-mono">{item.quantity} pcs</strong> @ {formatRupiah(item.price)}</span>
                            {item.avgCostAfter && item.avgCostAfter > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-[#1B9357] font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                  Rata-Rata Setelahnya: <strong>{formatRupiah(item.avgCostAfter)}/item</strong>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 sm:space-x-3">
                          <span className="font-bold text-[#1E293B] font-mono">{formatRupiah(item.subtotal)}</span>
                          <button
                            onClick={() => handleRemoveStagedItem(item.id)}
                            className="p-1 text-red-500 hover:bg-red-50 rounded-[6px]"
                            title="Hapus"
                          >
                            <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer Actions */}
          {!completedTransaction && (
            <div className="shrink-0 px-4 sm:px-5 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <span className="text-[10px] sm:text-[11px] text-[#64748B] block uppercase font-bold tracking-wider">
                  Total Penerimaan ({totalReceiptQty} pcs)
                </span>
                <span className="text-sm sm:text-base font-bold text-[#F0002B] font-mono">
                  {formatRupiah(totalReceiptValue)}
                </span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={onClose}
                  className="h-10 px-4 bg-white hover:bg-gray-100 text-[#1E293B] text-xs sm:text-sm font-semibold rounded-[10px] border border-[#E2E8F0] transition-colors"
                >
                  Batal
                </button>
                <button
                  id="btn-confirm-receiving"
                  onClick={handleSubmitAll}
                  disabled={submitting}
                  className="flex-1 sm:flex-none h-10 inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 bg-[#F0002B] hover:bg-[#D80027] text-white text-xs sm:text-sm font-semibold rounded-[10px]  transition-colors cursor-pointer disabled:opacity-50"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>{submitting ? 'Menyimpan...' : 'Konfirmasi Penerimaan'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Direct A4 Print Modal if user triggers from success screen */}
      {showPrintA4 && completedTransaction && (
        <PrintableTransactionA4
          isOpen={showPrintA4}
          onClose={() => {
            setShowPrintA4(false);
            setCompletedTransaction(null);
            onClose();
          }}
          type="incoming"
          data={completedTransaction}
        />
      )}
    </>
  );
};
