import { StateMessage } from '../common/UI.tsx';
import { Button, Toolbar } from '../common/UI.tsx';
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
import { InventoryItem, User, Vendor } from '../../types.ts';
import { StockStatusBadge } from '../common/StockStatusBadge.tsx';
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

type InventorySection = 'stok' | 'vendors' | 'katalog' | 'opname';

interface WarehouseInventoryProps {
  currentUser: User;
  activeSection?: InventorySection;
  onSectionChange?: (section: InventorySection) => void;
}

export const WarehouseInventory: React.FC<WarehouseInventoryProps> = ({ currentUser, activeSection = 'stok', onSectionChange }) => {
  const [activeTab, setActiveTab] = useState<InventorySection>(activeSection);
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

  useEffect(() => {
    setActiveTab(activeSection);
  }, [activeSection]);

  const selectSection = (section: InventorySection) => {
    setActiveTab(section);
    onSectionChange?.(section);
  };

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
    <div className="space-y-4">
      {/* Top Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#1E293B] tracking-tight">
            Inventory
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
            Kelola stok, barang, vendor, dan penerimaan gudang.
          </p>
        </div>

        {/* Action Buttons */}
        {activeTab !== 'opname' && <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Primary Penerimaan Button */}
          <Button
            id="btn-open-penerimaan-modal"
            onClick={() => handleOpenReceive()}
            variant="primary"
          >
            <ArrowDownToLine className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span>Penerimaan Barang</span>
          </Button>

          {/* CRUD Barang */}
          <Button
            id="btn-open-crud-barang"
            onClick={handleOpenCreateItem}
            variant="primary"
          >
            <Package className="w-3 h-3 sm:w-4 sm:h-4 text-[#FFB800] shrink-0" />
            <span>Barang Baru</span>
          </Button>

          {/* CRUD Vendor */}
          <Button
            id="btn-open-crud-vendor"
            onClick={handleOpenCreateVendor}
            variant="secondary"
          >
            <Building2 className="w-3 h-3 sm:w-4 sm:h-4 text-[#F0002B] shrink-0" />
            <span>Kelola Vendor</span>
          </Button>
        </div>}
      </div>

      {/* Info Notice: Unified Stock Rule */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl p-2.5 sm:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-1.5 sm:gap-3 text-xs">
        <div className="flex items-center space-x-2 sm:space-x-2.5">
          <Layers className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-[#2563EB] shrink-0" />
          <div>
            <span className="font-bold text-[10px] sm:text-xs text-[#1E40AF]">Stok terintegrasi</span>
            <p className="text-[10px] sm:text-xs text-[#1E3A8A] mt-0.5">
              Barang dari berbagai vendor terhubung ke satu stok. Harga beli rata-rata dan harga jual dicatat terpisah.
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
      <div className="flex items-center space-x-1 sm:space-x-2 border-b border-[#E2E8F0] pb-0.5 sm:pb-1 overflow-x-auto text-[10px] sm:text-xs">
        <button
          id="tab-stok-barang"
          onClick={() => selectSection('stok')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'stok'
              ? 'border-[#F0002B] text-[#F0002B] bg-[#F0002B]/5'
              : 'border-transparent text-[#64748B] hover:text-[#1E293B]'
          }`}
        >
          Daftar Stok ({items.length})
        </button>

        <button
          id="tab-master-vendor"
          onClick={() => selectSection('vendors')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'vendors'
              ? 'border-[#F0002B] text-[#F0002B] bg-[#F0002B]/5'
              : 'border-transparent text-[#64748B] hover:text-[#1E293B]'
          }`}
        >
          Master Vendor ({vendors.length})
        </button>

        <button
          id="tab-katalog-barang"
          onClick={() => selectSection('katalog')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'katalog'
              ? 'border-[#F0002B] text-[#F0002B] bg-[#F0002B]/5'
              : 'border-transparent text-[#64748B] hover:text-[#1E293B]'
          }`}
        >
          Katalog Master Barang
        </button>

        <button
          id="tab-stock-opname"
          onClick={() => selectSection('opname')}
          className={`px-2.5 py-1.5 sm:px-4 sm:py-2.5 font-bold rounded-t-[8px] sm:rounded-t-[12px] transition-colors cursor-pointer border-b-2 whitespace-nowrap ${
            activeTab === 'opname'
              ? 'border-[#F0002B] text-[#F0002B] bg-[#F0002B]/5'
              : 'border-transparent text-[#64748B] hover:text-[#1E293B]'
          }`}
        >
          Stock Opname
        </button>
      </div>

      {/* Search Input Bar */}
      {activeTab !== 'opname' && <Toolbar>
        <div className="relative w-full max-w-md">
          <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
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
            className="w-full pl-8 pr-2.5 py-1 sm:pl-10 sm:pr-4 sm:py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] sm:rounded-xl text-[10px] sm:text-xs text-[#1E293B] outline-none focus:border-[#F0002B]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {activeTab === 'stok' && (
            <details className="relative">
              <summary className="list-none cursor-pointer rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[10px] sm:text-xs font-semibold text-[#1E293B]">
                Kategori: {selectedCategories.length ? `${selectedCategories.length} dipilih` : 'Semua Kategori'}
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-lg">
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-xs font-semibold text-[#1E293B] hover:bg-[#F8FAFC]">
                  <input
                    type="checkbox"
                    checked={!selectedCategories.length || selectedCategories.length === INVENTORY_CATEGORIES.length}
                    onChange={() => setSelectedCategories([])}
                  />
                  Semua Kategori
                </label>
                <div className="border-t border-[#E2E8F0] pt-1">
                  {INVENTORY_CATEGORIES.map((category) => (
                    <label key={category.code} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-xs text-[#1E293B] hover:bg-[#F8FAFC]">
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
                      {category.name} <span className="text-[#64748B]">({category.code})</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          )}
          <span className="text-[10px] sm:text-xs text-[#64748B]">Menampilkan <strong>{activeTab === 'vendors' ? filteredVendors.length : filteredItems.length}</strong> data</span>
        </div>
      </Toolbar>}

      {activeTab === 'opname' && <WarehouseStockOpname items={items} loading={loading} currentUser={currentUser} onRefresh={fetchData} />}

      {/* TAB 1: STOK BARANG (UNIFIED LIST) */}
      {activeTab === 'stok' && (
        <div className="hd-table-surface">
          {loading ? <StateMessage kind="loading">Memuat stok persediaan gudang...</StateMessage> : filteredItems.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-left text-xs">
                <thead><tr><th className="w-24">Kode Barang</th><th>Nama Barang</th><th className="w-32">Kategori</th><th className="w-16">Satuan</th><th className="w-16 text-right">Stok</th><th className="w-32 text-left">Status</th><th className="w-32 text-right">Harga Katalog</th><th className="w-36 text-right">Harga Rata-rata</th><th className="w-36 text-right">Aksi</th></tr></thead>
                <tbody>{filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap font-mono text-[11px]">{item.itemCode}</td>
                    <td className="font-semibold text-[#1E293B]">{item.itemName}</td>
                    <td>{item.category}</td><td className="text-[#64748B]">pcs</td>
                    <td className="text-right font-semibold tabular-nums text-[#1E293B]">{Number(item.currentStock).toLocaleString('id-ID')}</td>
                    <td className="text-left"><StockStatusBadge currentStock={item.currentStock} /></td>
                    <td className="whitespace-nowrap text-right font-medium tabular-nums">{formatRupiah(item.price)}</td>
                    <td className="whitespace-nowrap text-right text-[#64748B] tabular-nums">{item.avgPurchasePrice && item.avgPurchasePrice > 0 ? formatRupiah(item.avgPurchasePrice) : '—'}</td>
                    <td className="whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="primary" className="!min-h-7 !px-2 !py-1 !text-[11px]" onClick={() => handleOpenReceive(item.id)} title="Catat penerimaan stok"><ArrowDownToLine className="h-3 w-3" />Terima</Button>
                        <button onClick={() => handleOpenItemEdit(item)} className="hd-icon-button hd-button--ghost" title="Edit Barang" aria-label={`Edit ${item.itemName}`}><Edit2 className="mx-auto h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDeleteItem(item)} className="hd-icon-button hd-button--ghost text-rose-600" title="Hapus Barang" aria-label={`Hapus ${item.itemName}`}><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <StateMessage>Tidak ada barang ditemukan pada pencarian ini.</StateMessage>}
        </div>
      )}

      {/* TAB 2: MASTER VENDOR & KODE VENDOR (CRUD) */}
      {activeTab === 'vendors' && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden ">
          <div className="p-2.5 sm:p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]/60 flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] sm:text-xs font-bold text-[#1E293B] uppercase tracking-wider block">
                Master Data Vendor ({filteredVendors.length} Rekanan)
              </span>
              <p className="text-[10px] sm:text-[11px] text-[#64748B]">
                Kelola kode vendor dan nama vendor pengadaan bahan baku.
              </p>
            </div>

            <button
              onClick={() => setIsVendorModalOpen(true)}
              className="inline-flex items-center space-x-1 px-2 py-1 sm:px-3.5 sm:py-1.5 bg-[#F0002B] hover:bg-[#D80027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[12px]  cursor-pointer shrink-0"
            >
              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>+ Vendor</span>
            </button>
          </div>

          <div className="divide-y divide-[#E2E8F0]">
            {filteredVendors.length > 0 ? (
              filteredVendors.map((vendor, idx) => (
                <div
                  key={vendor.id}
                  className="p-2.5 sm:p-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors gap-2"
                >
                  <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                    <span className="w-4 sm:w-5 text-center text-[10px] sm:text-xs font-mono text-[#64748B]">{idx + 1}</span>
                    <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-[6px] sm:rounded-[10px] bg-slate-100 flex items-center justify-center text-[#1E293B] font-mono font-bold text-[10px] sm:text-xs shrink-0">
                      {vendor.vendorCode}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-xs sm:text-sm text-[#1E293B] truncate">{vendor.vendorName}</h4>
                      <span className="text-[10px] sm:text-xs text-[#64748B] font-mono block truncate">Kode: {vendor.vendorCode}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
                    <button
                      onClick={() => handleOpenVendorEdit(vendor)}
                      className="px-2 py-0.5 sm:px-3 sm:py-1.5 bg-white hover:bg-slate-100 text-[#1E293B] text-[10px] sm:text-xs font-semibold rounded-[6px] sm:rounded-[10px] border border-[#E2E8F0] transition-colors"
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
              <StateMessage>Tidak ada data vendor ditemukan.</StateMessage>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: KATALOG MASTER BARANG (CRUD) */}
      {activeTab === 'katalog' && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden ">
          <div className="p-2.5 sm:p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]/60 flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] sm:text-xs font-bold text-[#1E293B] uppercase tracking-wider block">
                Katalog Master Barang ({filteredItems.length} Item)
              </span>
              <p className="text-[10px] sm:text-[11px] text-[#64748B]">
                Kelola nama barang, harga baku standar, dan vendor default.
              </p>
            </div>

            <button
              onClick={handleOpenCreateItem}
              className="inline-flex items-center space-x-1 px-2 py-1 sm:px-3.5 sm:py-1.5 bg-[#F0002B] hover:bg-[#D80027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[12px]  cursor-pointer shrink-0"
            >
              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>+ Barang</span>
            </button>
          </div>

          <div className="divide-y divide-[#E2E8F0]">
            {filteredItems.map((item, idx) => (
              <div
                key={item.id}
                className="p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3 hover:bg-[#F8FAFC] transition-colors"
              >
                <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                  <span className="w-4 sm:w-5 text-center text-[10px] sm:text-xs font-mono text-[#64748B]">{idx + 1}</span>
                  <div className="min-w-0">
                    <h4 className="font-bold text-xs sm:text-sm text-[#1E293B] truncate">{item.itemName}</h4>
                    <span className="text-[10px] sm:text-xs text-[#64748B] flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span>Kategori: <strong className="text-[#1E293B]">{item.category}</strong></span>
                      <span>•</span>
                      <span>Kode: <strong className="font-mono text-[#1E293B]">{item.itemCode}</strong></span>
                      <span>•</span>
                      <span>Harga Katalog: <strong className="text-[#1E293B] font-mono">{formatRupiah(item.price)}</strong></span>
                      <span>•</span>
                      <span>Harga Rata-Rata: <strong className="text-blue-700 font-mono">{item.avgPurchasePrice && item.avgPurchasePrice > 0 ? formatRupiah(item.avgPurchasePrice) : '-'}</strong></span>
                      <span>•</span>
                      <span>Stok: <strong>{item.currentStock} pcs</strong></span>
                    </span>
                    <div className="mt-1 flex items-center space-x-1.5 text-[10px]">
                      <span className="text-[#64748B]">Vendor Default:</span>
                      {item.vendorName ? (
                        <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] sm:text-[10px] font-semibold">
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
                        <span className="text-gray-400 italic text-[10px]">Tanpa Vendor Terikat</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-1.5 sm:space-x-2 border-t sm:border-t-0 pt-1 sm:pt-0 border-[#E2E8F0]">
                  <button
                    onClick={() => handleOpenItemEdit(item)}
                    className="px-2 py-0.5 sm:px-3 sm:py-1.5 bg-white hover:bg-slate-100 text-[#1E293B] text-[10px] sm:text-xs font-semibold rounded-[6px] sm:rounded-[10px] border border-[#E2E8F0] transition-colors"
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
