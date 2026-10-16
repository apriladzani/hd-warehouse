import React, { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Boxes,
  Building2,
  Package,
  ArrowDownToLine,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Layers,
  Sparkles,
} from 'lucide-react';
import { InventoryItem, Vendor } from '../../types.ts';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatRupiah } from '../../lib/format.ts';
import { VendorManagementModal } from '../modals/VendorManagementModal.tsx';
import { ItemManagementModal } from '../modals/ItemManagementModal.tsx';
import { PenerimaanBarangModal } from '../modals/PenerimaanBarangModal.tsx';
import { WarehouseBarangMasukModal } from '../modals/WarehouseBarangMasukModal.tsx';
import { WarehouseStockOpname } from './WarehouseStockOpname.tsx';

const INVENTORY_CATEGORIES = [
  { name: 'Raw Material', code: 'RM' },
  { name: 'Support Material', code: 'SM' },
  { name: 'Packaging', code: 'PKG' },
] as const;

export const WarehouseInventory: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'stok' | 'vendors' | 'katalog' | 'opname'>('stok');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Modals state
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isPenerimaanModalOpen, setIsPenerimaanModalOpen] = useState(false);
  const [selectedReceiveItemId, setSelectedReceiveItemId] = useState<number | null>(null);
  const [editingItemTarget, setEditingItemTarget] = useState<InventoryItem | null>(null);
  const [editingVendorTarget, setEditingVendorTarget] = useState<Vendor | null>(null);

  // Backwards compatibility HD R&S modal
  const [isLegacyModalOpen, setIsLegacyModalOpen] = useState(false);
  const [legacyModalStep, setLegacyModalStep] = useState<1 | 2 | 3 | 4>(4);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [itemsRes, vendorsRes] = await Promise.all([
        fetch('/api/inventory'),
        fetch('/api/vendors'),
      ]);
      const itemsData = await itemsRes.json();
      const vendorsData = await vendorsRes.json();

      setItems(itemsData.items || []);
      setVendors(vendorsData.vendors || []);
    } catch (err) {
      console.error('Failed to load inventory data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredItems = items.filter(
    (item) => {
      const categoryMatches = !selectedCategories.length || selectedCategories.includes(item.category);
      const query = searchQuery.toLowerCase();
      return categoryMatches && (
        item.itemName.toLowerCase().includes(query) ||
        item.itemCode.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query) ||
        (item.vendorName && item.vendorName.toLowerCase().includes(query)) ||
        (item.vendorCode && item.vendorCode.toLowerCase().includes(query)) ||
        (item.vendorsSupplied && item.vendorsSupplied.some((v) => v.toLowerCase().includes(query)))
      );
    }
  );

  const filteredVendors = vendors.filter(
    (v) =>
      v.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.vendorCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpenReceive = (itemId?: number) => {
    setSelectedReceiveItemId(itemId || null);
    setIsPenerimaanModalOpen(true);
  };

  const handleOpenItemEdit = (item: InventoryItem) => {
    setEditingItemTarget(item);
    setIsItemModalOpen(true);
  };

  const handleOpenCreateItem = () => {
    setEditingItemTarget(null);
    setIsItemModalOpen(true);
  };

  const handleOpenVendorEdit = (vendor: Vendor) => {
    setEditingVendorTarget(vendor);
    setIsVendorModalOpen(true);
  };

  const handleOpenCreateVendor = () => {
    setEditingVendorTarget(null);
    setIsVendorModalOpen(true);
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    const confirmDelete = window.confirm(
      `Yakin ingin menghapus barang "${item.itemName}" dari katalog stok?`
    );
    if (!confirmDelete) return;

    try {
      const res = await fetch(`/api/inventory/items/${item.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus barang');

      fetchData();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus barang');
    }
  };

  const handleDeleteVendor = async (vendor: Vendor) => {
    const confirmDelete = window.confirm(
      `Yakin ingin menghapus vendor "${vendor.vendorName}" (${vendor.vendorCode}) dari sistem?`
    );
    if (!confirmDelete) return;

    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus vendor');

      fetchData();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus vendor');
    }
  };

  const handleUnlinkItemVendor = async (item: InventoryItem) => {
    const confirmUnlink = window.confirm(
      `Yakin ingin menghapus keterikatan vendor dari barang "${item.itemName}"?`
    );
    if (!confirmUnlink) return;

    try {
      const res = await fetch(`/api/inventory/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal melepaskan vendor dari barang');

      fetchData();
    } catch (err: any) {
      alert(err.message || 'Gagal melepaskan vendor');
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-[#17233D] tracking-tight">
            Warehouse Inventory &amp; Logistik
          </h1>
          <p className="text-xs sm:text-sm text-[#60708C] mt-0.5">
            Manajemen CRUD Vendor &amp; Kode Vendor, CRUD Master Barang, serta Penerimaan Barang Masuk.
          </p>
        </div>

        {/* Action Buttons */}
        {activeTab !== 'opname' && <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Primary Penerimaan Button */}
          <button
            id="btn-open-penerimaan-modal"
            onClick={() => handleOpenReceive()}
            className="inline-flex items-center space-x-1 sm:space-x-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] shadow-sm transition-all cursor-pointer min-h-[30px] sm:min-h-[42px]"
          >
            <ArrowDownToLine className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span>+ Penerimaan Masuk</span>
          </button>

          {/* CRUD Barang */}
          <button
            id="btn-open-crud-barang"
            onClick={handleOpenCreateItem}
            className="inline-flex items-center space-x-1 px-2 py-1.5 sm:px-3.5 sm:py-2.5 bg-white hover:bg-[#F8FAFC] text-[#17233D] text-[10px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] border border-[#DDE5F0] shadow-xs transition-all cursor-pointer min-h-[30px] sm:min-h-[42px]"
          >
            <Package className="w-3 h-3 sm:w-4 sm:h-4 text-[#FFB800] shrink-0" />
            <span>+ Barang Baru</span>
          </button>

          {/* CRUD Vendor */}
          <button
            id="btn-open-crud-vendor"
            onClick={handleOpenCreateVendor}
            className="inline-flex items-center space-x-1 px-2 py-1.5 sm:px-3.5 sm:py-2.5 bg-white hover:bg-[#F8FAFC] text-[#17233D] text-[10px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] border border-[#DDE5F0] shadow-xs transition-all cursor-pointer min-h-[30px] sm:min-h-[42px]"
          >
            <Building2 className="w-3 h-3 sm:w-4 sm:h-4 text-[#ED002B] shrink-0" />
            <span>Kelola Vendor</span>
          </button>
        </div>}
      </div>

      {/* Info Notice: Unified Stock Rule */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-[14px] sm:rounded-[18px] p-2.5 sm:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-1.5 sm:gap-3 text-xs">
        <div className="flex items-center space-x-2 sm:space-x-2.5">
          <Layers className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-[#2563EB] shrink-0" />
          <div>
            <span className="font-bold text-[10px] sm:text-xs text-[#1E40AF]">Kebijakan Penyatuan Stok &amp; Perhitungan Harga:</span>
            <p className="text-[9px] sm:text-xs text-[#1E3A8A] mt-0.5">
              Barang yang sama dari vendor berbeda digabungkan ke satu katalog stok. <strong>Harga Katalog</strong> digunakan untuk request Outlet, sedangkan <strong>Harga Rata-Rata Beli</strong> dihitung terpisah menggunakan metode <strong>Weighted Average (Σ(Qty × Harga Beli) / Σ Qty)</strong>.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            setLegacyModalStep(4);
            setIsLegacyModalOpen(true);
          }}
          className="text-[10px] sm:text-xs font-bold text-[#2563EB] hover:text-[#1D4ED8] underline shrink-0 cursor-pointer"
        >
          Lihat Mode Form Cepat HD R&amp;S →
        </button>
      </div>

      {/* Sub Tabs Navigator */}
      <div className="flex items-center space-x-1 sm:space-x-2 border-b border-[#DDE5F0] pb-0.5 sm:pb-1 overflow-x-auto text-[10px] sm:text-xs">
        <button
          id="tab-stok-barang"
          onClick={() => setActiveTab('stok')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'stok'
              ? 'border-[#ED002B] text-[#ED002B] bg-[#ED002B]/5'
              : 'border-transparent text-[#60708C] hover:text-[#17233D]'
          }`}
        >
          Daftar Stok ({items.length})
        </button>

        <button
          id="tab-master-vendor"
          onClick={() => setActiveTab('vendors')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'vendors'
              ? 'border-[#ED002B] text-[#ED002B] bg-[#ED002B]/5'
              : 'border-transparent text-[#60708C] hover:text-[#17233D]'
          }`}
        >
          Master Vendor ({vendors.length})
        </button>

        <button
          id="tab-katalog-barang"
          onClick={() => setActiveTab('katalog')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'katalog'
              ? 'border-[#ED002B] text-[#ED002B] bg-[#ED002B]/5'
              : 'border-transparent text-[#60708C] hover:text-[#17233D]'
          }`}
        >
          Katalog Master Barang
        </button>

        <button
          id="tab-stock-opname"
          onClick={() => setActiveTab('opname')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'opname'
              ? 'border-[#ED002B] text-[#ED002B] bg-[#ED002B]/5'
              : 'border-transparent text-[#60708C] hover:text-[#17233D]'
          }`}
        >
          Stock Opname
        </button>
      </div>

      {/* Search Input Bar */}
      {activeTab !== 'opname' && <div className="bg-white p-2.5 sm:p-4 rounded-[14px] sm:rounded-[20px] border border-[#DDE5F0] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
        <div className="relative w-full max-w-md">
          <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#60708C] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="input-cari-inventory"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeTab === 'vendors'
                ? 'Cari nama vendor atau kode vendor (VND-xx)...'
                : 'Cari nama barang, vendor pengirim, kode vendor...'
            }
            className="w-full pl-8 pr-2.5 py-1 sm:pl-10 sm:pr-4 sm:py-2 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[14px] text-[10px] sm:text-xs text-[#17233D] outline-none focus:border-[#ED002B]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {activeTab === 'stok' && (
            <details className="relative">
              <summary className="list-none cursor-pointer rounded-[10px] border border-[#DDE5F0] bg-[#F8FAFC] px-3 py-2 text-[10px] sm:text-xs font-semibold text-[#17233D]">
                Kategori: {selectedCategories.length ? `${selectedCategories.length} dipilih` : 'Semua Kategori'}
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-[#DDE5F0] bg-white p-2 shadow-lg">
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-xs font-semibold text-[#17233D] hover:bg-[#F8FAFC]">
                  <input
                    type="checkbox"
                    checked={!selectedCategories.length || selectedCategories.length === INVENTORY_CATEGORIES.length}
                    onChange={() => setSelectedCategories([])}
                  />
                  Semua Kategori
                </label>
                <div className="border-t border-[#DDE5F0] pt-1">
                  {INVENTORY_CATEGORIES.map((category) => (
                    <label key={category.code} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-xs text-[#17233D] hover:bg-[#F8FAFC]">
                      <input
                        type="checkbox"
                        checked={!selectedCategories.length || selectedCategories.includes(category.name)}
                        onChange={() => setSelectedCategories((selected) => {
                          const current = selected.length ? selected : INVENTORY_CATEGORIES.map((entry) => entry.name);
                          return current.includes(category.name)
                            ? current.filter((entry) => entry !== category.name)
                            : [...current, category.name];
                        })}
                      />
                      {category.name} <span className="text-[#60708C]">({category.code})</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          )}
          <span className="text-[10px] sm:text-xs text-[#60708C]">Menampilkan <strong>{activeTab === 'vendors' ? filteredVendors.length : filteredItems.length}</strong> data</span>
        </div>
      </div>}

      {activeTab === 'opname' && <WarehouseStockOpname items={items} loading={loading} />}

      {/* TAB 1: STOK BARANG (UNIFIED LIST) */}
      {activeTab === 'stok' && (
        <div className="bg-white rounded-[18px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
          <div className="p-3 sm:p-4 border-b border-[#DDE5F0] bg-[#F8FAFC]/60 flex items-center justify-between text-[10px] sm:text-xs font-bold text-[#60708C] uppercase tracking-wider">
            <span>Barang &amp; Rekanan Vendor</span>
            <span className="hidden sm:inline">Stok Akumulasi &amp; Tindakan</span>
          </div>

          <div className="divide-y divide-[#DDE5F0]">
            {loading ? (
              <div className="py-6 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">Memuat stok persediaan gudang...</div>
            ) : filteredItems.length > 0 ? (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 hover:bg-[#F8FAFC] transition-colors"
                >
                  {/* Left: Info Barang */}
                  <div className="space-y-0.5 sm:space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1 sm:gap-3">
                      <h3 className="font-bold text-xs sm:text-base text-[#17233D] tracking-tight truncate">
                        {item.itemName}
                      </h3>
                      <StatusBadge status={item.status} />
                      <span className="px-1.5 py-0.5 rounded bg-[#EFF6FF] border border-[#BFDBFE] text-[9px] sm:text-[10px] font-bold text-[#1E40AF]">{item.category}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[9px] sm:text-[10px] font-mono font-bold text-[#17233D]">{item.itemCode}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-4 gap-y-1 text-[10px] sm:text-xs">
                      <span className="inline-flex items-center space-x-1 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                        <span className="text-[#64748B]">Harga Katalog:</span>
                        <strong className="text-[#17233D] font-mono">{formatRupiah(item.price)}</strong>
                        <span className="text-[9px] text-[#64748B]">(Request)</span>
                      </span>

                      <span className="inline-flex items-center space-x-1 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                        <span className="text-blue-700">Harga Rata-Rata:</span>
                        <strong className="text-[#1E40AF] font-mono">
                          {item.avgPurchasePrice && item.avgPurchasePrice > 0
                            ? `${formatRupiah(item.avgPurchasePrice)}/item`
                            : '-'}
                        </strong>
                        <span className="text-[9px] text-blue-600 font-medium">(Weighted Avg)</span>
                      </span>
                    </div>

                    {/* Vendors that supplied this item (Multi-vendor verification) */}
                    <div className="pt-0.5">
                      <span className="text-[9px] sm:text-[11px] text-[#60708C] font-medium mr-1">
                        Pemasok:
                      </span>
                      {item.vendorsSupplied && item.vendorsSupplied.length > 0 ? (
                        <div className="inline-flex flex-wrap gap-0.5 sm:gap-1 align-middle">
                          {item.vendorsSupplied.map((vLabel, idx) => (
                            <span
                              key={idx}
                              className="px-1 py-0.2 rounded bg-[#F1F5F9] border border-[#CBD5E1] text-[9px] sm:text-[11px] font-semibold text-[#17233D]"
                            >
                              {vLabel}
                            </span>
                          ))}
                        </div>
                      ) : item.vendorName ? (
                        <span className="px-1 py-0.2 rounded bg-[#F1F5F9] border border-[#CBD5E1] text-[9px] sm:text-[11px] font-semibold text-[#17233D]">
                          [{item.vendorCode || 'VND'}] {item.vendorName}
                        </span>
                      ) : (
                        <span className="text-[9px] sm:text-[11px] text-gray-400 italic">Vendor Umum</span>
                      )}
                    </div>
                  </div>

                  {/* Right: Stok & Actions */}
                  <div className="flex items-center justify-between sm:justify-end space-x-2 sm:space-x-6 border-t sm:border-t-0 pt-1.5 sm:pt-0 border-[#DDE5F0]">
                    <div className="text-left sm:text-right">
                      <span className="text-[8px] sm:text-[10px] text-[#60708C] block uppercase font-bold tracking-wider">
                        Total Stok
                      </span>
                      <div className="flex items-center space-x-1 sm:space-x-1.5 mt-0.5">
                        <Boxes className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#60708C]" />
                        <span className="text-xs sm:text-base font-black text-[#17233D]">
                          {item.currentStock} pcs
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1 sm:space-x-1.5">
                      <button
                        onClick={() => handleOpenReceive(item.id)}
                        className="inline-flex items-center space-x-1 px-2 py-1 sm:px-3 sm:py-1.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[12px] shadow-xs transition-all cursor-pointer"
                        title="Catat penerimaan stok masuk untuk barang ini"
                      >
                        <ArrowDownToLine className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span>Terima</span>
                      </button>

                      <button
                        onClick={() => handleOpenItemEdit(item)}
                        className="p-1 sm:p-1.5 text-[#60708C] hover:text-[#17233D] hover:bg-slate-100 rounded-[6px] sm:rounded-[10px] transition-colors"
                        title="Edit Barang"
                      >
                        <Edit2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>

                      <button
                        onClick={() => handleDeleteItem(item)}
                        className="p-1 sm:p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-[6px] sm:rounded-[10px] transition-colors"
                        title="Hapus Barang"
                      >
                        <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">
                Tidak ada barang ditemukan pada pencarian ini.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MASTER VENDOR & KODE VENDOR (CRUD) */}
      {activeTab === 'vendors' && (
        <div className="bg-white rounded-[18px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
          <div className="p-2.5 sm:p-4 border-b border-[#DDE5F0] bg-[#F8FAFC]/60 flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] sm:text-xs font-bold text-[#17233D] uppercase tracking-wider block">
                Master Data Vendor ({filteredVendors.length} Rekanan)
              </span>
              <p className="text-[9px] sm:text-[11px] text-[#60708C]">
                Kelola kode vendor dan nama vendor pengadaan bahan baku.
              </p>
            </div>

            <button
              onClick={() => setIsVendorModalOpen(true)}
              className="inline-flex items-center space-x-1 px-2 py-1 sm:px-3.5 sm:py-1.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[12px] shadow-xs cursor-pointer shrink-0"
            >
              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>+ Vendor</span>
            </button>
          </div>

          <div className="divide-y divide-[#DDE5F0]">
            {filteredVendors.length > 0 ? (
              filteredVendors.map((vendor, idx) => (
                <div
                  key={vendor.id}
                  className="p-2.5 sm:p-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors gap-2"
                >
                  <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                    <span className="w-4 sm:w-5 text-center text-[9px] sm:text-xs font-mono text-[#60708C]">{idx + 1}</span>
                    <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[6px] sm:rounded-[10px] bg-slate-100 flex items-center justify-center text-[#17233D] font-mono font-bold text-[9px] sm:text-xs shrink-0">
                      {vendor.vendorCode}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-xs sm:text-sm text-[#17233D] truncate">{vendor.vendorName}</h4>
                      <span className="text-[9px] sm:text-xs text-[#60708C] font-mono block truncate">Kode: {vendor.vendorCode}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
                    <button
                      onClick={() => handleOpenVendorEdit(vendor)}
                      className="px-2 py-0.5 sm:px-3 sm:py-1.5 bg-white hover:bg-slate-100 text-[#17233D] text-[9px] sm:text-xs font-semibold rounded-[6px] sm:rounded-[10px] border border-[#DDE5F0] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteVendor(vendor)}
                      className="p-1 sm:p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-[6px] sm:rounded-[10px] border border-red-200 transition-colors"
                      title="Hapus Vendor"
                    >
                      <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 sm:py-12 text-center text-[#60708C] text-xs sm:text-sm">
                Tidak ada data vendor ditemukan.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: KATALOG MASTER BARANG (CRUD) */}
      {activeTab === 'katalog' && (
        <div className="bg-white rounded-[14px] sm:rounded-[22px] border border-[#DDE5F0] overflow-hidden shadow-xs">
          <div className="p-2.5 sm:p-4 border-b border-[#DDE5F0] bg-[#F8FAFC]/60 flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] sm:text-xs font-bold text-[#17233D] uppercase tracking-wider block">
                Katalog Master Barang ({filteredItems.length} Item)
              </span>
              <p className="text-[9px] sm:text-[11px] text-[#60708C]">
                Kelola nama barang, harga baku standar, dan vendor default.
              </p>
            </div>

            <button
              onClick={handleOpenCreateItem}
              className="inline-flex items-center space-x-1 px-2 py-1 sm:px-3.5 sm:py-1.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[12px] shadow-xs cursor-pointer shrink-0"
            >
              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>+ Barang</span>
            </button>
          </div>

          <div className="divide-y divide-[#DDE5F0]">
            {filteredItems.map((item, idx) => (
              <div
                key={item.id}
                className="p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3 hover:bg-[#F8FAFC] transition-colors"
              >
                <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                  <span className="w-4 sm:w-5 text-center text-[9px] sm:text-xs font-mono text-[#60708C]">{idx + 1}</span>
                  <div className="min-w-0">
                    <h4 className="font-bold text-xs sm:text-sm text-[#17233D] truncate">{item.itemName}</h4>
                    <span className="text-[9px] sm:text-xs text-[#60708C] flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span>Kategori: <strong className="text-[#17233D]">{item.category}</strong></span>
                      <span>•</span>
                      <span>Kode: <strong className="font-mono text-[#17233D]">{item.itemCode}</strong></span>
                      <span>•</span>
                      <span>Harga Katalog: <strong className="text-[#17233D] font-mono">{formatRupiah(item.price)}</strong></span>
                      <span>•</span>
                      <span>Harga Rata-Rata: <strong className="text-blue-700 font-mono">{item.avgPurchasePrice && item.avgPurchasePrice > 0 ? formatRupiah(item.avgPurchasePrice) : '-'}</strong></span>
                      <span>•</span>
                      <span>Stok: <strong>{item.currentStock} pcs</strong></span>
                    </span>
                    <div className="mt-1 flex items-center space-x-1.5 text-[10px]">
                      <span className="text-[#64748B]">Vendor Default:</span>
                      {item.vendorName ? (
                        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[9px] sm:text-[10px] font-semibold">
                          <span>[{item.vendorCode || 'VND'}] {item.vendorName}</span>
                          <button
                            type="button"
                            onClick={() => handleUnlinkItemVendor(item)}
                            className="text-red-500 hover:text-red-700 font-bold ml-1 cursor-pointer text-xs"
                            title="Hapus keterikatan vendor dari barang ini"
                          >
                            ×
                          </button>
                        </span>
                      ) : (
                        <span className="text-gray-400 italic text-[9px]">Tanpa Vendor Terikat</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-1.5 sm:space-x-2 border-t sm:border-t-0 pt-1 sm:pt-0 border-[#DDE5F0]">
                  <button
                    onClick={() => handleOpenItemEdit(item)}
                    className="px-2 py-0.5 sm:px-3 sm:py-1.5 bg-white hover:bg-slate-100 text-[#17233D] text-[9px] sm:text-xs font-semibold rounded-[6px] sm:rounded-[10px] border border-[#DDE5F0] transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteItem(item)}
                    className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-[6px] sm:rounded-[10px] transition-colors"
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

      {/* MODAL 1: Vendor Management (CRUD Vendor & Kode) */}
      {isVendorModalOpen && (
        <VendorManagementModal
          isOpen={isVendorModalOpen}
          onClose={() => {
            setIsVendorModalOpen(false);
            setEditingVendorTarget(null);
          }}
          vendors={vendors}
          onRefresh={fetchData}
          initialEditingVendor={editingVendorTarget}
        />
      )}

      {/* MODAL 2: Item Management (CRUD Barang) */}
      {isItemModalOpen && (
        <ItemManagementModal
          isOpen={isItemModalOpen}
          onClose={() => {
            setIsItemModalOpen(false);
            setEditingItemTarget(null);
          }}
          items={items}
          vendors={vendors}
          onRefresh={fetchData}
          initialEditingItem={editingItemTarget}
        />
      )}

      {/* MODAL 3: Penerimaan Barang Masuk (Pilih Barang, Vendor, Qty, Harga) */}
      {isPenerimaanModalOpen && (
        <PenerimaanBarangModal
          isOpen={isPenerimaanModalOpen}
          onClose={() => {
            setIsPenerimaanModalOpen(false);
            setSelectedReceiveItemId(null);
          }}
          onSuccess={() => {
            fetchData();
          }}
          items={items}
          vendors={vendors}
          initialItemId={selectedReceiveItemId}
        />
      )}

      {/* MODAL 4: Backwards Compatibility HD R&S Modal */}
      {isLegacyModalOpen && (
        <WarehouseBarangMasukModal
          isOpen={isLegacyModalOpen}
          onClose={() => setIsLegacyModalOpen(false)}
          onSuccess={() => {
            fetchData();
            setIsLegacyModalOpen(false);
          }}
          existingVendors={vendors}
          existingItems={items}
          defaultStep={legacyModalStep}
        />
      )}
    </div>
  );
};
