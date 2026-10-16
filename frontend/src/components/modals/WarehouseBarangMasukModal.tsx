import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Minus,
  Trash2,
  Building2,
  AlertCircle,
  CheckCircle2,
  PackageCheck,
  ArrowRight,
  Boxes,
  ClipboardList,
  Search,
  RotateCcw,
  Calendar,
  CreditCard,
  FileText,
  Scale,
} from 'lucide-react';
import { Vendor, InventoryItem } from '../../types.ts';
import { formatRupiah } from '../../lib/format.ts';

interface WarehouseBarangMasukModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingVendors: Vendor[];
  existingItems: InventoryItem[];
  defaultStep?: 1 | 2 | 3 | 4;
}

interface IncomingItemDraft {
  itemId?: number;
  itemName: string;
  price: number;
  quantity: number;
  subtotal: number;
  vendorCode?: string;
  vendorName?: string;
}

export const WarehouseBarangMasukModal: React.FC<WarehouseBarangMasukModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingVendors,
  existingItems,
  defaultStep = 4,
}) => {
  // Step 4: HD R&S (Gudang) Penerimaan / Receiving List (Vendor | Item | HB | qty | total value)
  // Step 1: Input Vendor (Kode Vendor & Nama Vendor)
  // Step 2: Input Barang (Nama Barang, Harga, Dropdown Vendor)
  // Step 3: Tambah Stok Dropdown (Pilih Barang dari Dropdown & Isi Quantity)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(defaultStep);

  // --- STEP 1 STATE: Input Vendor ---
  const [step1VendorCode, setStep1VendorCode] = useState('');
  const [step1VendorName, setStep1VendorName] = useState('');

  // --- STEP 2 STATE: Input Barang + Dropdown Vendor ---
  const [step2SelectedVendorId, setStep2SelectedVendorId] = useState<number | ''>('');
  const [step2ItemName, setStep2ItemName] = useState('');
  const [step2Price, setStep2Price] = useState<number | ''>('');
  const [step2InitialStock, setStep2InitialStock] = useState<number>(0);

  // --- STEP 3 STATE: Dropdown Pilih Barang & Isi Quantity ---
  const [step3SelectedItemId, setStep3SelectedItemId] = useState<number | ''>('');
  const [step3Price, setStep3Price] = useState<number | ''>('');
  const [step3SelectedVendorId, setStep3SelectedVendorId] = useState<number | ''>('');
  const [step3Quantity, setStep3Quantity] = useState<number>(100);
  const [step3PaymentMethod, setStep3PaymentMethod] = useState<string>('Transfer');
  const [step3TransactionDate, setStep3TransactionDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [stagedItems, setStagedItems] = useState<IncomingItemDraft[]>([]);

  // --- STEP 4 STATE: HD R&S Receiving List ---
  const [step4Date, setStep4Date] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [step4PaymentMethod, setStep4PaymentMethod] = useState<string>('Transfer');
  const [step4Notes, setStep4Notes] = useState<string>('');
  const [step4Quantities, setStep4Quantities] = useState<Record<number, number>>({});
  const [step4Search, setStep4Search] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Internal lists
  const [vendorsList, setVendorsList] = useState<Vendor[]>(existingVendors);
  const [itemsList, setItemsList] = useState<InventoryItem[]>(existingItems);

  useEffect(() => {
    setVendorsList(existingVendors);
    setItemsList(existingItems);
  }, [existingVendors, existingItems]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMsg(null);
      setCurrentStep(defaultStep);

      // Auto-select initial values
      if (vendorsList.length > 0 && step2SelectedVendorId === '') {
        setStep2SelectedVendorId(vendorsList[0].id);
      }
      if (itemsList.length > 0 && step3SelectedItemId === '') {
        setStep3SelectedItemId(itemsList[0].id);
      }

      // Initialize Step 4 quantities
      const initQ: Record<number, number> = {};
      itemsList.forEach((it) => {
        initQ[it.id] = 0;
      });
      setStep4Quantities(initQ);
    }
  }, [isOpen, defaultStep]);

  // Selected item in Step 3
  const currentSelectedItem = itemsList.find((i) => i.id === Number(step3SelectedItemId));

  // Sync Step 3 vendor when selected item changes (DO NOT take price from catalog!)
  useEffect(() => {
    if (step3SelectedItemId) {
      const it = itemsList.find((i) => i.id === Number(step3SelectedItemId));
      if (it) {
        if (it.vendorId) {
          setStep3SelectedVendorId(it.vendorId);
        } else if (vendorsList.length > 0) {
          setStep3SelectedVendorId(vendorsList[0].id);
        }
      }
    }
  }, [step3SelectedItemId, itemsList, vendorsList]);

  // Check if item in Step 2 already exists in catalog
  const matchedCatalogItemStep2 = useMemo(() => {
    if (!step2ItemName.trim()) return null;
    return (
      itemsList.find(
        (i) => i.itemName.trim().toLowerCase() === step2ItemName.trim().toLowerCase()
      ) || null
    );
  }, [step2ItemName, itemsList]);

  // ============================================================================
  // HANDLER STEP 1: SIMPAN VENDOR DULU (Kode Vendor & Nama Vendor)
  // ============================================================================
  const handleSaveStep1Vendor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!step1VendorCode.trim() || !step1VendorName.trim()) {
      setError('Kode Vendor dan Nama Vendor wajib diisi.');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorCode: step1VendorCode.trim(),
          vendorName: step1VendorName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyimpan vendor');
      }

      const savedVendor: Vendor = data.vendor;
      setVendorsList((prev) => {
        const exists = prev.some((v) => v.id === savedVendor.id);
        return exists ? prev : [...prev, savedVendor];
      });

      setSuccessMsg(`Vendor "${savedVendor.vendorName}" (${savedVendor.vendorCode}) berhasil disimpan!`);
      setStep2SelectedVendorId(savedVendor.id);

      setTimeout(() => {
        setSuccessMsg(null);
        setCurrentStep(2);
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan vendor');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // HANDLER STEP 2: NAMA BARANG DAN DROPDOWN SI VENDORNYA
  // ============================================================================
  const handleSaveStep2Item = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!step2SelectedVendorId) {
      setError('Pilih vendor dari dropdown terlebih dahulu (atau input di Langkah 1).');
      return;
    }
    if (!step2ItemName.trim()) {
      setError('Nama barang wajib diisi.');
      return;
    }
    const numPrice = Number(step2Price);
    if (isNaN(numPrice) || numPrice <= 0) {
      setError('Harga barang harus lebih besar dari 0.');
      return;
    }

    const selectedVendor = vendorsList.find((v) => v.id === Number(step2SelectedVendorId));
    if (!selectedVendor) {
      setError('Vendor yang dipilih tidak valid.');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/inventory/master-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorCode: selectedVendor.vendorCode,
          vendorName: selectedVendor.vendorName,
          itemName: step2ItemName.trim(),
          price: numPrice,
          initialStock: step2InitialStock || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mendaftarkan barang');
      }

      const savedItem: InventoryItem = {
        ...data.item,
        vendorName: selectedVendor.vendorName,
        vendorCode: selectedVendor.vendorCode,
        status: data.item.currentStock > 15 ? 'Available' : 'Low Stock',
      };

      setItemsList((prev) => {
        const idx = prev.findIndex((i) => i.id === savedItem.id);
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = savedItem;
          return updated;
        }
        return [...prev, savedItem];
      });

      setSuccessMsg(`Barang "${savedItem.itemName}" berhasil didaftarkan ke vendor ${selectedVendor.vendorName}!`);
      setStep3SelectedItemId(savedItem.id);

      setTimeout(() => {
        setSuccessMsg(null);
        setCurrentStep(3);
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Gagal mendaftarkan master barang');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // HANDLER STEP 3: PILIH BARANGNYA (DROPDOWN) & ISI QUANTITY
  // ============================================================================
  const handleAddStagedItem = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentSelectedItem) {
      setError('Pilih barang dari dropdown terlebih dahulu.');
      return;
    }
    if (step3Quantity <= 0) {
      setError('Quantity barang harus minimal 1.');
      return;
    }

    const numPrice = Number(step3Price);
    if (step3Price === '' || isNaN(numPrice) || numPrice <= 0) {
      setError('Harga beli satuan wajib diinput secara manual (lebih dari Rp 0)!');
      return;
    }
    const effectivePrice = numPrice;
    const chosenVendor =
      vendorsList.find((v) => v.id === Number(step3SelectedVendorId)) || {
        vendorCode: currentSelectedItem.vendorCode || 'VND-001',
        vendorName: currentSelectedItem.vendorName || 'Vendor Mandiri',
      };

    const existingIdx = stagedItems.findIndex((it) => it.itemId === currentSelectedItem.id);
    if (existingIdx > -1) {
      const updated = [...stagedItems];
      updated[existingIdx].quantity += step3Quantity;
      updated[existingIdx].price = effectivePrice;
      updated[existingIdx].subtotal = updated[existingIdx].quantity * effectivePrice;
      updated[existingIdx].vendorCode = chosenVendor.vendorCode;
      updated[existingIdx].vendorName = chosenVendor.vendorName;
      setStagedItems(updated);
    } else {
      setStagedItems([
        ...stagedItems,
        {
          itemId: currentSelectedItem.id,
          itemName: currentSelectedItem.itemName,
          price: effectivePrice,
          quantity: step3Quantity,
          subtotal: step3Quantity * effectivePrice,
          vendorCode: chosenVendor.vendorCode,
          vendorName: chosenVendor.vendorName,
        },
      ]);
    }
    setStep3Quantity(100);
  };

  const handleRemoveStagedItem = (index: number) => {
    setStagedItems(stagedItems.filter((_, i) => i !== index));
  };

  const handleSubmitStep3Incoming = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    let itemsToSubmit = stagedItems;
    if (itemsToSubmit.length === 0 && currentSelectedItem && step3Quantity > 0) {
      const numPrice = Number(step3Price);
      if (step3Price === '' || isNaN(numPrice) || numPrice <= 0) {
        setError('Harga beli satuan wajib diinput secara manual (lebih dari Rp 0)!');
        return;
      }
      const effectivePrice = numPrice;
      const chosenVendor =
        vendorsList.find((v) => v.id === Number(step3SelectedVendorId)) || {
          vendorCode: currentSelectedItem.vendorCode || 'VND-001',
          vendorName: currentSelectedItem.vendorName || 'Vendor Mandiri',
        };

      itemsToSubmit = [
        {
          itemId: currentSelectedItem.id,
          itemName: currentSelectedItem.itemName,
          price: effectivePrice,
          quantity: step3Quantity,
          subtotal: step3Quantity * effectivePrice,
          vendorCode: chosenVendor.vendorCode,
          vendorName: chosenVendor.vendorName,
        },
      ];
    }

    if (itemsToSubmit.length === 0) {
      setError('Silakan pilih barang dan masukkan quantity terlebih dahulu.');
      return;
    }

    try {
      setLoading(true);
      const vendorGroups: Record<string, IncomingItemDraft[]> = {};
      itemsToSubmit.forEach((item) => {
        const vKey = item.vendorCode || 'VND-001';
        if (!vendorGroups[vKey]) {
          vendorGroups[vKey] = [];
        }
        vendorGroups[vKey].push(item);
      });

      for (const [vCode, grpItems] of Object.entries(vendorGroups)) {
        const first = grpItems[0];
        const vName = first.vendorName || 'Vendor Mandiri';

        const payload = {
          vendorCode: vCode,
          vendorName: vName,
          paymentMethod: step3PaymentMethod,
          transactionDate: step3TransactionDate,
          createdBy: 'Staff Gudang',
          items: grpItems.map((it) => ({
            itemId: it.itemId,
            itemName: it.itemName,
            price: it.price,
            quantity: it.quantity,
          })),
        };

        const res = await fetch('/api/inventory/incoming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Gagal menyimpan transaksi barang masuk');
        }
      }

      setSuccessMsg('Berhasil menyimpan transaksi barang masuk!');
      setStagedItems([]);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Gagal mencatat barang masuk');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // HANDLER STEP 4: HD R&S (GUDANG) PENERIMAAN / RECEIVING LIST
  // User Requirement: "HD R&S (Gudang) Penerimaan/receiving: Vendor|Item|HB|qty total value"
  // "buat ngajuin barangnya dibuatnya list aja, jadi langsung masukin quantity aja. ini jg barang buat di gudang"
  // ============================================================================
  const handleStep4QtyChange = (itemId: number, qty: number) => {
    const val = isNaN(qty) ? 0 : Math.max(0, Math.floor(qty));
    setStep4Quantities((prev) => ({
      ...prev,
      [itemId]: val,
    }));
  };

  const handleStep4Increment = (itemId: number) => {
    setStep4Quantities((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || 0) + 1,
    }));
  };

  const handleStep4Decrement = (itemId: number) => {
    setStep4Quantities((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) - 1),
    }));
  };

  const handleStep4Reset = () => {
    const r: Record<number, number> = {};
    itemsList.forEach((it) => {
      r[it.id] = 0;
    });
    setStep4Quantities(r);
  };

  // Filtered items for Step 4
  const filteredStep4Items = useMemo(() => {
    return itemsList.filter((item) => {
      const q = step4Search.toLowerCase();
      return (
        item.itemName.toLowerCase().includes(q) ||
        (item.vendorName && item.vendorName.toLowerCase().includes(q)) ||
        (item.vendorCode && item.vendorCode.toLowerCase().includes(q))
      );
    });
  }, [itemsList, step4Search]);

  // Step 4 summary
  const step4Summary = useMemo(() => {
    let count = 0;
    let totalQty = 0;
    let totalVal = 0;

    itemsList.forEach((it) => {
      const q = step4Quantities[it.id] || 0;
      if (q > 0) {
        count += 1;
        totalQty += q;
        totalVal += q * it.price;
      }
    });

    return { count, totalQty, totalVal };
  }, [itemsList, step4Quantities]);

  const handleSubmitStep4Receiving = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const receivedItems = itemsList
      .filter((it) => (step4Quantities[it.id] || 0) > 0)
      .map((it) => ({
        itemId: it.id,
        itemName: it.itemName,
        vendorCode: it.vendorCode,
        vendorName: it.vendorName,
        price: it.price,
        quantity: step4Quantities[it.id],
      }));

    if (receivedItems.length === 0) {
      setError('Belum ada item barang yang diisi quantity masuk.');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/inventory/hd-receiving', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionDate: step4Date,
          paymentMethod: step4PaymentMethod,
          notes: step4Notes,
          items: receivedItems,
          createdBy: 'Staff Gudang',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyimpan penerimaan HD R&S');
      }

      setSuccessMsg(
        `Berhasil! Penerimaan ${receivedItems.length} barang HD R&S telah dicatat dan stok gudang bertambah.`
      );
      handleStep4Reset();

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Gagal memproses penerimaan HD R&S');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-[#17233D]/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl rounded-[20px] sm:rounded-[24px] border border-[#DDE5F0] shadow-xl overflow-hidden flex flex-col max-h-[96vh] sm:max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-[#DDE5F0] flex items-center justify-between bg-white shrink-0">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 bg-[#ED002B]/10 text-[#ED002B] text-[10px] sm:text-[11px] font-extrabold rounded-full tracking-wider uppercase">
                Gudang
              </span>
              <span className="text-[11px] sm:text-xs text-[#60708C] font-semibold truncate">
                Penerimaan &amp; Registrasi
              </span>
            </div>
            <h2 className="text-base sm:text-xl font-bold text-[#17233D] tracking-tight mt-1">
              HD R&amp;S Penerimaan / Receiving
            </h2>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#60708C] hover:text-[#17233D] hover:bg-[#F8FAFC] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation (4 Modes) */}
        <div className="px-3 sm:px-6 pt-2 sm:pt-3 bg-[#F8FAFC] border-b border-[#DDE5F0] shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 pb-2.5 sm:pb-3">
            {/* Step 4: HD R&S Penerimaan List Mode */}
            <button
              type="button"
              id="step-tab-4"
              onClick={() => setCurrentStep(4)}
              className={`flex items-center space-x-2 p-2.5 rounded-[16px] text-xs font-bold transition-all border text-left ${
                currentStep === 4
                  ? 'bg-white text-[#ED002B] border-[#ED002B] shadow-xs'
                  : 'bg-white/60 text-[#60708C] border-[#DDE5F0] hover:bg-white hover:text-[#17233D]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                  currentStep === 4 ? 'bg-[#ED002B] text-white' : 'bg-[#DDE5F0] text-[#60708C]'
                }`}
              >
                ★
              </div>
              <div className="truncate">
                <span className="block leading-none">HD R&amp;S (List Mode)</span>
                <span className="text-[10px] font-medium text-[#60708C] truncate">Penerimaan Cepat</span>
              </div>
            </button>

            {/* Step 1: Input Vendor */}
            <button
              type="button"
              id="step-tab-1"
              onClick={() => setCurrentStep(1)}
              className={`flex items-center space-x-2 p-2.5 rounded-[16px] text-xs font-bold transition-all border text-left ${
                currentStep === 1
                  ? 'bg-white text-[#ED002B] border-[#ED002B] shadow-xs'
                  : 'bg-white/60 text-[#60708C] border-[#DDE5F0] hover:bg-white hover:text-[#17233D]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                  currentStep === 1 ? 'bg-[#ED002B] text-white' : 'bg-[#DDE5F0] text-[#60708C]'
                }`}
              >
                1
              </div>
              <div className="truncate">
                <span className="block leading-none">1. Input Vendor</span>
                <span className="text-[10px] font-medium text-[#60708C] truncate">Kode &amp; Nama Vendor</span>
              </div>
            </button>

            {/* Step 2: Input Barang */}
            <button
              type="button"
              id="step-tab-2"
              onClick={() => setCurrentStep(2)}
              className={`flex items-center space-x-2 p-2.5 rounded-[16px] text-xs font-bold transition-all border text-left ${
                currentStep === 2
                  ? 'bg-white text-[#ED002B] border-[#ED002B] shadow-xs'
                  : 'bg-white/60 text-[#60708C] border-[#DDE5F0] hover:bg-white hover:text-[#17233D]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                  currentStep === 2 ? 'bg-[#ED002B] text-white' : 'bg-[#DDE5F0] text-[#60708C]'
                }`}
              >
                2
              </div>
              <div className="truncate">
                <span className="block leading-none">2. Input Barang</span>
                <span className="text-[10px] font-medium text-[#60708C] truncate">Dropdown Vendor</span>
              </div>
            </button>

            {/* Step 3: Dropdown Tambah Stok */}
            <button
              type="button"
              id="step-tab-3"
              onClick={() => setCurrentStep(3)}
              className={`flex items-center space-x-2 p-2.5 rounded-[16px] text-xs font-bold transition-all border text-left ${
                currentStep === 3
                  ? 'bg-white text-[#ED002B] border-[#ED002B] shadow-xs'
                  : 'bg-white/60 text-[#60708C] border-[#DDE5F0] hover:bg-white hover:text-[#17233D]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                  currentStep === 3 ? 'bg-[#ED002B] text-white' : 'bg-[#DDE5F0] text-[#60708C]'
                }`}
              >
                3
              </div>
              <div className="truncate">
                <span className="block leading-none">3. Tambah Stok</span>
                <span className="text-[10px] font-medium text-[#60708C] truncate">Pilih Dropdown</span>
              </div>
            </button>
          </div>
        </div>

        {/* Modal Body Container */}
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 bg-[#FDE8EC] border border-[#F8B6C2] rounded-[18px] text-xs font-semibold text-[#ED002B] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-[#EAF8F1] border border-[#A7E4C4] rounded-[18px] text-xs font-semibold text-[#1B9357] flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* ============================================================================ */}
          {/* STEP 4: HD R&S (GUDANG) PENERIMAAN/RECEIVING (LIST MODE)                       */}
          {/* Columns: Vendor | Item | HB | qty | total value                              */}
          {/* ============================================================================ */}
          {currentStep === 4 && (
            <div className="space-y-4">
              {/* Header Details */}
              <div className="p-4 rounded-[20px] bg-[#F8FAFC] border border-[#DDE5F0] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-[#17233D] uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#ED002B]" />
                    <span>Tanggal Penerimaan (Tgl)</span>
                  </label>
                  <input
                    type="date"
                    value={step4Date}
                    onChange={(e) => setStep4Date(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#DDE5F0] rounded-[14px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#17233D] uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-[#ED002B]" />
                    <span>Metode Pembayaran</span>
                  </label>
                  <select
                    value={step4PaymentMethod}
                    onChange={(e) => setStep4PaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#DDE5F0] rounded-[14px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B] cursor-pointer"
                  >
                    <option value="Transfer">Transfer</option>
                    <option value="Tempo">Tempo / Faktur Vendor</option>
                    <option value="Cash">Cash / Kas Gudang</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#17233D] uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#ED002B]" />
                    <span>No. Surat Jalan / Catatan</span>
                  </label>
                  <input
                    type="text"
                    value={step4Notes}
                    onChange={(e) => setStep4Notes(e.target.value)}
                    placeholder="Contoh: SJ-2026/09/HD-01"
                    className="w-full px-3 py-2 bg-white border border-[#DDE5F0] rounded-[14px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                  />
                </div>
              </div>

              {/* Search & Action Bar */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative w-full max-w-xs">
                  <Search className="w-3.5 h-3.5 text-[#60708C] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={step4Search}
                    onChange={(e) => setStep4Search(e.target.value)}
                    placeholder="Cari item atau vendor..."
                    className="w-full pl-8 pr-3 py-1.5 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[14px] text-xs text-[#17233D] outline-none focus:border-[#ED002B]"
                  />
                </div>

                {step4Summary.count > 0 && (
                  <button
                    type="button"
                    onClick={handleStep4Reset}
                    className="text-xs text-[#60708C] hover:text-[#ED002B] flex items-center space-x-1 font-semibold"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Qty (0)</span>
                  </button>
                )}
              </div>

              {/* 1. Mobile Cards View for Step 4 (sm:hidden) */}
              <div className="sm:hidden divide-y divide-[#DDE5F0] rounded-[20px] border border-[#DDE5F0] overflow-hidden bg-white max-h-96 overflow-y-auto">
                {filteredStep4Items.length > 0 ? (
                  filteredStep4Items.map((item) => {
                    const qty = step4Quantities[item.id] || 0;
                    const totalVal = qty * item.price;
                    const isFilled = qty > 0;

                    return (
                      <div
                        key={item.id}
                        className={`p-3.5 transition-colors ${
                          isFilled ? 'bg-[#FFF8F8]' : 'bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-[#17233D] text-sm leading-snug">
                              {item.itemName}
                            </h4>
                            <div className="flex items-center space-x-2 mt-0.5 text-[11px] text-[#60708C]">
                              <span className="truncate">Vendor: {item.vendorName || 'Supplier HD'}</span>
                              <span>•</span>
                              <span>Stok: {item.currentStock}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-bold text-[#17233D] block">
                              {formatRupiah(item.price)}
                            </span>
                            <span className="text-[10px] text-[#60708C] block">HB / unit</span>
                          </div>
                        </div>

                        {/* Stepper counter & Total Value */}
                        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-dashed border-[#DDE5F0]">
                          <div className="inline-flex items-center bg-[#F8FAFC] border border-[#DDE5F0] rounded-[14px] p-0.5 shadow-2xs">
                            <button
                              type="button"
                              onClick={() => handleStep4Decrement(item.id)}
                              disabled={qty <= 0}
                              aria-label={`Kurangi penerimaan ${item.itemName}`}
                              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[#60708C] active:bg-white disabled:opacity-30"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              value={qty === 0 ? '' : qty}
                              onChange={(e) =>
                                handleStep4QtyChange(
                                  item.id,
                                  e.target.value === '' ? 0 : parseInt(e.target.value) || 0
                                )
                              }
                              placeholder="0"
                              className="w-12 text-center font-black text-sm text-[#17233D] outline-none bg-transparent"
                            />
                            <button
                              type="button"
                              onClick={() => handleStep4Increment(item.id)}
                              aria-label={`Tambah penerimaan ${item.itemName}`}
                              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[#ED002B] active:bg-[#FFF2F4]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] text-[#60708C] block uppercase font-bold">Total Value</span>
                            <span className={`text-sm font-black ${isFilled ? 'text-[#ED002B]' : 'text-[#60708C]'}`}>
                              {formatRupiah(totalVal)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-[#60708C] text-xs">
                    Tidak ada barang ditemukan.
                  </div>
                )}
              </div>

              {/* 2. Desktop Table View (hidden sm:block) */}
              <div className="hidden sm:block rounded-[20px] border border-[#DDE5F0] overflow-hidden bg-white shadow-2xs">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#F8FAFC] border-b border-[#DDE5F0] text-[11px] font-bold text-[#60708C] uppercase tracking-wider z-10">
                      <tr>
                        <th className="py-3 px-3">Vendor</th>
                        <th className="py-3 px-3">Item Barang</th>
                        <th className="py-3 px-3 text-right">HB (Harga Beli)</th>
                        <th className="py-3 px-3 text-center w-36">Qty Masuk</th>
                        <th className="py-3 px-3 text-right">Total Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DDE5F0] text-xs">
                      {filteredStep4Items.length > 0 ? (
                        filteredStep4Items.map((item) => {
                          const qty = step4Quantities[item.id] || 0;
                          const totalVal = qty * item.price;
                          const isFilled = qty > 0;

                          return (
                            <tr
                              key={item.id}
                              className={`transition-colors ${
                                isFilled ? 'bg-[#FFF8F8] hover:bg-[#FFF2F4]' : 'hover:bg-[#F8FAFC]'
                              }`}
                            >
                              {/* Vendor Column */}
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-[#17233D]">{item.vendorName || 'Supplier HD'}</div>
                                <span className="text-[10px] text-[#60708C] font-mono">
                                  {item.vendorCode || 'VND-HD'}
                                </span>
                              </td>

                              {/* Item Column */}
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-[#17233D]">{item.itemName}</div>
                                <div className="text-[10px] text-[#60708C]">
                                  Stok saat ini: {item.currentStock}
                                </div>
                              </td>

                              {/* HB Column */}
                              <td className="py-2.5 px-3 text-right font-medium text-[#17233D]">
                                {formatRupiah(item.price)}
                              </td>

                              {/* Qty Column */}
                              <td className="py-2.5 px-3 text-center">
                                <div className="inline-flex items-center space-x-1 bg-white border border-[#DDE5F0] rounded-[14px] p-0.5 shadow-2xs">
                                  <button
                                    type="button"
                                    onClick={() => handleStep4Decrement(item.id)}
                                    disabled={qty <= 0}
                                    className="w-6 h-6 rounded-[10px] flex items-center justify-center text-[#60708C] hover:bg-[#F8FAFC] disabled:opacity-30"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    value={qty === 0 ? '' : qty}
                                    onChange={(e) =>
                                      handleStep4QtyChange(
                                        item.id,
                                        e.target.value === '' ? 0 : parseInt(e.target.value) || 0
                                      )
                                    }
                                    placeholder="0"
                                    className="w-12 text-center font-bold text-xs text-[#17233D] outline-none bg-transparent"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleStep4Increment(item.id)}
                                    className="w-6 h-6 rounded-[10px] flex items-center justify-center text-[#ED002B] hover:bg-[#FFF2F4]"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>

                              {/* Total Value */}
                              <td className="py-2.5 px-3 text-right font-bold">
                                <span className={isFilled ? 'text-[#ED002B]' : 'text-[#60708C]'}>
                                  {formatRupiah(totalVal)}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-[#60708C]">
                            Tidak ada barang ditemukan.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bottom Summary Bar for Step 4 */}
              <div className="p-3.5 sm:p-4 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[20px] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="grid grid-cols-3 sm:flex sm:items-center sm:space-x-4 divide-x divide-[#DDE5F0] text-xs">
                  <div className="text-center sm:text-left pr-2 sm:pr-0">
                    <span className="text-[10px] text-[#60708C] block uppercase font-bold">Barang</span>
                    <strong className="text-xs sm:text-sm text-[#17233D]">{step4Summary.count} Item</strong>
                  </div>
                  <div className="text-center sm:text-left px-2 sm:px-0 sm:pl-4">
                    <span className="text-[10px] text-[#60708C] block uppercase font-bold">Total Qty</span>
                    <strong className="text-xs sm:text-sm text-[#17233D]">{step4Summary.totalQty} Unit</strong>
                  </div>
                  <div className="text-center sm:text-left pl-2 sm:pl-4">
                    <span className="text-[10px] text-[#60708C] block uppercase font-bold">Total Value</span>
                    <strong className="text-xs sm:text-sm text-[#ED002B] truncate block">{formatRupiah(step4Summary.totalVal)}</strong>
                  </div>
                </div>

                <div className="flex items-center space-x-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 sm:px-4 py-2.5 bg-white text-[#60708C] text-xs font-semibold rounded-[18px] border border-[#DDE5F0] min-h-[44px]"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitStep4Receiving}
                    disabled={step4Summary.count === 0 || loading}
                    className="flex-1 sm:flex-none px-4 sm:px-6 py-2.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs font-bold rounded-[18px] shadow-sm flex items-center justify-center space-x-2 disabled:opacity-40 transition-all min-h-[44px]"
                  >
                    <ClipboardList className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {loading
                        ? 'Menyimpan...'
                        : `Simpan Penerimaan (${step4Summary.count} Item)`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================================ */}
          {/* LANGKAH 1: INPUT NAMA VENDOR DAN KODE VENDOR DULU                            */}
          {/* ============================================================================ */}
          {currentStep === 1 && (
            <form onSubmit={handleSaveStep1Vendor} className="space-y-4">
              <div className="p-5 rounded-[20px] bg-[#F8FAFC] border border-[#DDE5F0] space-y-4">
                <div className="flex items-center space-x-2 text-xs font-bold text-[#17233D] uppercase tracking-wider">
                  <Building2 className="w-4 h-4 text-[#ED002B]" />
                  <span>Langkah 1: Input Kode Vendor dan Nama Vendor</span>
                </div>
                <p className="text-xs text-[#60708C]">
                  Daftarkan identitas vendor terlebih dahulu sebelum menginput barang yang disuplai oleh vendor ini.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#60708C] mb-1">
                      Kode Vendor
                    </label>
                    <input
                      id="input-step1-vendor-code"
                      type="text"
                      required
                      value={step1VendorCode}
                      onChange={(e) => setStep1VendorCode(e.target.value)}
                      placeholder="Contoh: VND-002"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#60708C] mb-1">
                      Nama Vendor
                    </label>
                    <input
                      id="input-step1-vendor-name"
                      type="text"
                      required
                      value={step1VendorName}
                      onChange={(e) => setStep1VendorName(e.target.value)}
                      placeholder="Contoh: PT Sinar Abadi"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                    />
                  </div>
                </div>
              </div>

              {vendorsList.length > 0 && (
                <div className="p-4 rounded-[18px] bg-white border border-[#DDE5F0] text-xs">
                  <span className="font-semibold text-[#60708C] block mb-2">
                    Vendor yang Sudah Terdaftar ({vendorsList.length}):
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {vendorsList.map((v) => (
                      <span
                        key={v.id}
                        className="px-2.5 py-1 bg-[#F8FAFC] border border-[#DDE5F0] rounded-full text-[11px] text-[#17233D] font-medium"
                      >
                        <strong>{v.vendorCode}</strong> - {v.vendorName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="text-xs font-semibold text-[#60708C] hover:text-[#17233D]"
                >
                  Lewati ke Langkah 2 (Vendor sudah ada) →
                </button>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-white text-[#60708C] text-xs font-semibold rounded-[18px] border border-[#DDE5F0]"
                  >
                    Batal
                  </button>
                  <button
                    id="btn-simpan-vendor-step1"
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs font-bold rounded-[18px] shadow-sm flex items-center space-x-1.5 transition-colors"
                  >
                    <span>{loading ? 'Menyimpan...' : 'Simpan Vendor & Lanjut'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ============================================================================ */}
          {/* LANGKAH 2: NAMA BARANG DAN DROPDOWN SI VENDORNYA                             */}
          {/* ============================================================================ */}
          {currentStep === 2 && (
            <form onSubmit={handleSaveStep2Item} className="space-y-4">
              <div className="p-5 rounded-[20px] bg-[#F8FAFC] border border-[#DDE5F0] space-y-4">
                <div className="flex items-center space-x-2 text-xs font-bold text-[#17233D] uppercase tracking-wider">
                  <PackageCheck className="w-4 h-4 text-[#ED002B]" />
                  <span>Langkah 2: Input Nama Barang dan Dropdown si Vendornya</span>
                </div>
                <p className="text-xs text-[#60708C]">
                  Pilih vendor melalui dropdown, lalu masukkan nama barang dan harga satuan.
                </p>

                {/* Dropdown Si Vendornya */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-[#17233D]">
                      Pilih Vendor (Dropdown Vendor)
                    </label>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      className="text-xs font-semibold text-[#ED002B] hover:underline"
                    >
                      + Tambah Vendor Baru
                    </button>
                  </div>

                  <select
                    id="dropdown-step2-vendor"
                    value={step2SelectedVendorId}
                    onChange={(e) => setStep2SelectedVendorId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full px-4 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B] cursor-pointer"
                  >
                    <option value="">-- [ Pilih Vendor dari Dropdown ] --</option>
                    {vendorsList.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vendorCode} - {v.vendorName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Nama Barang & Harga */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-[#60708C] mb-1">
                      Nama Barang
                    </label>
                    <input
                      id="input-step2-item-name"
                      type="text"
                      required
                      value={step2ItemName}
                      onChange={(e) => setStep2ItemName(e.target.value)}
                      placeholder="Contoh: Ayam Mentah (kg)"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#60708C] mb-1">
                      Harga Satuan (HB - Rp)
                    </label>
                    <input
                      id="input-step2-price"
                      type="number"
                      required
                      min="1"
                      value={step2Price}
                      onChange={(e) => setStep2Price(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Contoh: 38000"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                    />
                  </div>

                  {matchedCatalogItemStep2 && Number(step2Price) > 0 && (
                    <div className="sm:col-span-2 p-3 bg-blue-50 border border-blue-200 rounded-[16px] text-xs text-blue-900 flex items-start space-x-2">
                      <Scale className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <div className="leading-snug">
                        <span className="font-bold text-blue-800 block">Penyimpanan Master Katalog:</span>
                        <p className="mt-0.5 text-[11px] text-blue-700">
                          Barang <strong>&quot;{matchedCatalogItemStep2.itemName}&quot;</strong> saat ini memiliki harga katalog <strong>{formatRupiah(matchedCatalogItemStep2.price)}</strong>.<br />
                          Harga katalog akan diperbarui menjadi <strong>{formatRupiah(Number(step2Price))}</strong> (hanya digunakan untuk request Outlet). Harga rata-rata pembelian dihitung terpisah secara otomatis dari riwayat transaksi penerimaan.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#60708C] mb-1">
                    Stok Awal (Opsional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={step2InitialStock}
                    onChange={(e) => setStep2InitialStock(Number(e.target.value) || 0)}
                    className="w-full max-w-xs px-3.5 py-2 bg-white border border-[#DDE5F0] rounded-[16px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="text-xs font-semibold text-[#60708C] hover:text-[#17233D]"
                >
                  ← Kembali ke Langkah 1 (Input Vendor)
                </button>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-white text-[#60708C] text-xs font-semibold rounded-[18px] border border-[#DDE5F0]"
                  >
                    Batal
                  </button>
                  <button
                    id="btn-simpan-barang-step2"
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs font-bold rounded-[18px] shadow-sm flex items-center space-x-1.5 transition-colors"
                  >
                    <span>{loading ? 'Menyimpan...' : 'Simpan Barang & Lanjut'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ============================================================================ */}
          {/* LANGKAH 3: PILIH BARANG DARI DROPDOWN DAN ISI QUANTITY                        */}
          {/* ============================================================================ */}
          {currentStep === 3 && (
            <form onSubmit={handleSubmitStep3Incoming} className="space-y-4">
              <div className="p-5 rounded-[20px] bg-[#F8FAFC] border border-[#DDE5F0] space-y-4">
                <div className="flex items-center space-x-2 text-xs font-bold text-[#17233D] uppercase tracking-wider">
                  <Boxes className="w-4 h-4 text-[#ED002B]" />
                  <span>Langkah 3: Pilih Barangnya via Dropdown dan Tinggal Isi Quantity</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-xs font-bold text-[#17233D] mb-1">
                      Pilih Barang (Dropdown Barang)
                    </label>
                    <select
                      id="dropdown-step3-barang"
                      value={step3SelectedItemId}
                      onChange={(e) => setStep3SelectedItemId(e.target.value ? Number(e.target.value) : '')}
                      className="w-full px-4 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-bold text-[#17233D] outline-none focus:border-[#ED002B] cursor-pointer"
                    >
                      <option value="">-- [ Pilih Barang dari Dropdown ] --</option>
                      {itemsList.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.itemName} (HB: {formatRupiah(i.price)}) — Vendor: {i.vendorName || 'HD'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#17233D] mb-1">
                      Vendor Pemasok / Pengirim
                    </label>
                    <select
                      id="dropdown-step3-vendor"
                      value={step3SelectedVendorId}
                      onChange={(e) => setStep3SelectedVendorId(e.target.value ? Number(e.target.value) : '')}
                      className="w-full px-4 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B] cursor-pointer"
                    >
                      <option value="">-- [ Pilih Vendor Pengirim ] --</option>
                      {vendorsList.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.vendorCode} - {v.vendorName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#17233D] mb-1 flex items-center justify-between">
                      <span>Harga Beli Satuan (HB - Input Manual)</span>
                      <span className="text-[10px] text-amber-700 font-normal">Wajib Input Manual</span>
                    </label>
                    <input
                      id="input-step3-price"
                      type="number"
                      min="0"
                      step="any"
                      value={step3Price}
                      onChange={(e) => setStep3Price(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Masukkan harga beli riil dari vendor..."
                      className="w-full px-4 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-bold text-[#17233D] outline-none focus:border-[#ED002B]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#17233D] mb-1">
                      Tinggal Isi Quantity (Jumlah Masuk)
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        id="input-step3-quantity"
                        type="number"
                        required
                        min="1"
                        value={step3Quantity}
                        onChange={(e) => setStep3Quantity(Math.max(1, parseInt(e.target.value) || 1))}
                        className="flex-1 px-4 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-sm font-bold text-[#17233D] outline-none focus:border-[#ED002B]"
                      />
                      <button
                        type="button"
                        onClick={handleAddStagedItem}
                        className="px-4 py-2.5 bg-[#17233D] hover:bg-[#202f50] text-white text-xs font-bold rounded-[18px] transition-colors shrink-0"
                      >
                        + Tambah ke List
                      </button>
                    </div>
                  </div>

                  {currentSelectedItem && (
                    <div className="sm:col-span-2 p-3 bg-slate-50 border border-[#CBD5E1] rounded-[16px] text-xs text-[#334155] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[#64748B]">Harga Katalog (Khusus Request Outlet):</span>
                        <strong className="text-[#17233D] font-mono">{formatRupiah(currentSelectedItem.price)}</strong>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 pt-1">
                        <span className="text-[#64748B]">Harga Rata-Rata Beli Saat Ini:</span>
                        <strong className="text-[#2563EB] font-mono">
                          {currentSelectedItem.avgPurchasePrice && currentSelectedItem.avgPurchasePrice > 0
                            ? `${formatRupiah(currentSelectedItem.avgPurchasePrice)}/item`
                            : 'Belum ada riwayat'}
                        </strong>
                      </div>
                      {Number(step3Price) > 0 && (
                        <div className="text-[11px] text-[#059669] font-medium pt-1 border-t border-slate-200">
                          Subtotal = {step3Quantity} pcs × {formatRupiah(Number(step3Price))} = <strong>{formatRupiah(step3Quantity * Number(step3Price))}</strong>.
                          <div className="text-[10px] text-[#64748B] font-normal mt-0.5">
                            * Harga katalog tidak akan berubah. Harga rata-rata pembelian item ini diperbarui otomatis dengan metode Weighted Average: Σ(Quantity × Harga Beli) / Σ Quantity.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-[#60708C] mb-1">
                      Metode Pembayaran
                    </label>
                    <select
                      value={step3PaymentMethod}
                      onChange={(e) => setStep3PaymentMethod(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                    >
                      <option value="Transfer">Transfer Bank</option>
                      <option value="Tempo">Tempo / Faktur</option>
                      <option value="Cash">Cash</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#60708C] mb-1">
                      Tanggal Transaksi
                    </label>
                    <input
                      type="date"
                      value={step3TransactionDate}
                      onChange={(e) => setStep3TransactionDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-[#DDE5F0] rounded-[18px] text-xs font-semibold text-[#17233D] outline-none focus:border-[#ED002B]"
                    />
                  </div>
                </div>
              </div>

              {stagedItems.length > 0 && (
                <div className="rounded-[18px] border border-[#DDE5F0] overflow-hidden">
                  <div className="p-3 bg-[#F8FAFC] border-b border-[#DDE5F0] flex items-center justify-between text-xs">
                    <span className="font-bold text-[#17233D]">
                      Daftar Barang yang Akan Masuk ({stagedItems.length})
                    </span>
                    <span className="font-bold text-[#ED002B]">
                      Total:{' '}
                      {formatRupiah(stagedItems.reduce((acc, curr) => acc + curr.subtotal, 0))}
                    </span>
                  </div>
                  <div className="divide-y divide-[#DDE5F0]">
                    {stagedItems.map((it, idx) => (
                      <div
                        key={idx}
                        className="p-3 flex items-center justify-between bg-white text-xs"
                      >
                        <div>
                          <div className="font-bold text-[#17233D]">{it.itemName}</div>
                          <div className="text-[#60708C] text-[11px]">
                            +{it.quantity} pcs @ {formatRupiah(it.price)} • {it.vendorName}
                          </div>
                        </div>

                        <div className="flex items-center space-x-3">
                          <span className="font-bold text-[#17233D]">
                            {formatRupiah(it.subtotal)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveStagedItem(idx)}
                            className="text-[#60708C] hover:text-[#ED002B] p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="text-xs font-semibold text-[#60708C] hover:text-[#17233D]"
                >
                  ← Kembali ke Langkah 2 (Input Barang)
                </button>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-white text-[#60708C] text-xs font-semibold rounded-[18px] border border-[#DDE5F0]"
                  >
                    Batal
                  </button>
                  <button
                    id="btn-simpan-barang-masuk"
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs font-bold rounded-[18px] shadow-sm transition-colors"
                  >
                    {loading ? 'Menyimpan...' : '[ Simpan Barang Masuk ]'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
