import React, { useState, useEffect } from 'react';
import {
  X,
  Package,
  Plus,
  Edit2,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  Coins,
  Boxes,
} from 'lucide-react';
import { InventoryItem, Vendor } from '../../types.ts';
import { formatRupiah } from '../../lib/format.ts';
import { ITEM_CATEGORIES, ItemCategory } from '../../constants/itemCategories.ts';
import { StockStatusBadge } from '../common/StockStatusBadge.tsx';

interface ItemManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  vendors: Vendor[];
  onRefresh: () => void;
  initialEditingItem?: InventoryItem | null;
}

export const ItemManagementModal: React.FC<ItemManagementModalProps> = ({
  isOpen,
  onClose,
  items,
  vendors,
  onRefresh,
  initialEditingItem = null,
}) => {
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(initialEditingItem);
  const [isCreating, setIsCreating] = useState(false);

  // Form inputs
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<ItemCategory | ''>('');
  const [formPrice, setFormPrice] = useState<number | ''>('');
  const [formVendorIds, setFormVendorIds] = useState<number[]>([]);
  const [selectedVendorToAdd, setSelectedVendorToAdd] = useState<number | ''>('');

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync initial editing item if prop changes
  useEffect(() => {
    if (initialEditingItem) {
      startEdit(initialEditingItem);
    }
  }, [initialEditingItem]);

  if (!isOpen) return null;

  const filteredItems = items.filter(
    (i) =>
      i.itemName.toLowerCase().includes(search.toLowerCase()) ||
      i.itemCode.toLowerCase().includes(search.toLowerCase()) ||
      i.category.toLowerCase().includes(search.toLowerCase()) ||
      (i.activeVendors &&
        i.activeVendors.some(
          (v) =>
            v.vendorName.toLowerCase().includes(search.toLowerCase()) ||
            v.vendorCode.toLowerCase().includes(search.toLowerCase())
        )) ||
      (i.vendorsSupplied &&
        i.vendorsSupplied.some((v) => v.toLowerCase().includes(search.toLowerCase()))) ||
      (i.vendorName && i.vendorName.toLowerCase().includes(search.toLowerCase())) ||
      (i.vendorCode && i.vendorCode.toLowerCase().includes(search.toLowerCase()))
  );

  const startCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormCategory('');
    setFormPrice('');
    setFormVendorIds([]);
    setSelectedVendorToAdd('');
    setIsCreating(true);
    setMessage(null);
  };

  const startEdit = (item: InventoryItem) => {
    setIsCreating(false);
    setEditingItem(item);
    setFormName(item.itemName);
    setFormCategory(item.category);
    setFormPrice(item.price);

    const initialVendorIds =
      item.activeVendors && item.activeVendors.length > 0
        ? item.activeVendors.map((v) => v.id)
        : item.vendorId
        ? [item.vendorId]
        : [];
    setFormVendorIds(initialVendorIds);
    setSelectedVendorToAdd('');
    setMessage(null);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingItem(null);
    setFormName('');
    setFormCategory('');
    setFormPrice('');
    setFormVendorIds([]);
    setSelectedVendorToAdd('');
    setMessage(null);
  };

  // Add vendor relation to item
  const handleAddVendorToForm = async () => {
    if (selectedVendorToAdd === '') return;
    const vId = Number(selectedVendorToAdd);
    if (formVendorIds.includes(vId)) return;

    const nextVendorIds = [...formVendorIds, vId];
    setFormVendorIds(nextVendorIds);
    setSelectedVendorToAdd('');

    // If currently editing an existing item, persist directly to backend
    if (editingItem) {
      try {
        await fetch(`/api/inventory/items/${editingItem.id}/vendors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendorId: vId }),
        });
        onRefresh();
      } catch (err) {
        console.error('Failed to link vendor directly:', err);
      }
    }
  };

  // Unlink vendor relation from item
  const handleRemoveVendorFromForm = async (vendorIdToRemove: number) => {
    const nextVendorIds = formVendorIds.filter((id) => id !== vendorIdToRemove);
    setFormVendorIds(nextVendorIds);

    // If currently editing an existing item, immediately unlink in database
    if (editingItem) {
      try {
        const res = await fetch(`/api/inventory/items/${editingItem.id}/vendors/${vendorIdToRemove}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          const removedVendor = vendors.find((v) => v.id === vendorIdToRemove);
          setMessage({
            type: 'success',
            text: `Vendor ${removedVendor?.vendorName || ''} berhasil dilepas dari barang ini.`,
          });
          onRefresh();
        }
      } catch (err) {
        console.error('Failed to unlink vendor:', err);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim()) {
      setMessage({ type: 'error', text: 'Nama barang wajib diisi!' });
      return;
    }

    if (!formCategory) {
      setMessage({ type: 'error', text: 'Kategori barang wajib dipilih.' });
      return;
    }

    if (formPrice === '' || isNaN(Number(formPrice)) || Number(formPrice) < 0) {
      setMessage({ type: 'error', text: 'Harga katalog harus diisi angka yang valid (minimal Rp 0)!' });
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);

      const parsedPrice = Number(formPrice);

      if (editingItem) {
        // Update item
        const res = await fetch(`/api/inventory/items/${editingItem.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemName: formName.trim(),
            category: formCategory,
            price: parsedPrice,
            vendorIds: formVendorIds,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mengubah data barang');

        setMessage({ type: 'success', text: `Barang "${formName}" berhasil diperbarui!` });
      } else {
        // Create item baru
        const res = await fetch('/api/inventory/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemName: formName.trim(),
            category: formCategory,
            price: parsedPrice,
            vendorIds: formVendorIds,
            vendorId: formVendorIds[0] || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menambahkan barang baru');

        setMessage({ type: 'success', text: `Barang "${formName}" berhasil ditambahkan ke katalog!` });
      }

      onRefresh();
      cancelForm();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Terjadi kesalahan sistem' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    const confirmDelete = window.confirm(
      `Yakin ingin menghapus barang "${item.itemName}" dari katalog sistem?`
    );
    if (!confirmDelete) return;

    try {
      setSubmitting(true);
      setMessage(null);
      const res = await fetch(`/api/inventory/items/${item.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus barang');

      setMessage({ type: 'success', text: `Barang "${item.itemName}" berhasil dihapus.` });
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Gagal menghapus barang' });
    } finally {
      setSubmitting(false);
    }
  };

  // Vendors that are not yet linked to this item
  const availableVendorsToAdd = vendors.filter((v) => !formVendorIds.includes(v.id));

  return (
    <div className="hd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/55 backdrop-blur-xs overflow-y-auto">
      <div
        className="hd-dialog bg-white w-full max-w-3xl rounded-xl border border-[#E2E8F0] overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-[10px] bg-[#F0002B]/10 text-[#F0002B] flex items-center justify-center font-bold">
              <Package className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#1E293B]">
                Kelola Barang
              </h2>
              <p className="text-[11px] sm:text-xs text-[#64748B]">
                Kelola master barang dan vendor. Stok bertambah melalui transaksi penerimaan dari vendor.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#64748B] hover:text-[#1E293B] rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={`px-4 sm:px-6 py-2.5 flex items-center space-x-2 text-xs font-semibold ${
              message.type === 'success'
                ? 'bg-[#EAF8F1] text-[#1B9357] border-b border-[#A7E4C4]'
                : 'bg-red-50 text-red-600 border-b border-red-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-5">
          {/* Top Actions Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama barang atau vendor..."
                className="w-full pl-9 pr-3 py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[12px] text-xs text-[#1E293B] outline-none focus:border-[#F0002B]"
              />
            </div>

            {!isCreating && !editingItem && (
              <button
                id="btn-add-new-item"
                onClick={startCreate}
                className="inline-flex items-center justify-center space-x-1.5 px-4 py-2 bg-[#F0002B] hover:bg-[#D80027] text-white text-xs font-bold rounded-[12px]  transition-all cursor-pointer min-h-[36px]"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Barang Baru</span>
              </button>
            )}
          </div>

          {/* Form Create / Edit Section */}
          {(isCreating || editingItem) && (
            <form
              onSubmit={handleSubmit}
              className="p-4 sm:p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F0002B]"></span>
                  <span className="text-xs sm:text-sm font-bold text-[#1E293B]">
                    {editingItem ? `Edit Barang: ${editingItem.itemName}` : 'Tambah Barang Baru ke Katalog'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={cancelForm}
                  className="text-xs text-[#64748B] hover:text-[#1E293B] underline cursor-pointer"
                >
                  Batal
                </button>
              </div>

              {/* Input Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1. Nama Barang */}
                <div className="sm:col-span-1">
                  <label className="block text-xs font-bold text-[#1E293B] mb-1">
                    Nama Barang <span className="text-[#F0002B]">*</span>
                  </label>
                  <input
                    id="input-item-name"
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Contoh: Ayam Mentah (kg)"
                    className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-[12px] text-xs font-semibold text-[#1E293B] outline-none focus:border-[#F0002B]"
                    required
                  />
                </div>

                {/* 2. Kategori & Kode Barang */}
                <div className="sm:col-span-1">
                  <label htmlFor="input-item-category" className="block text-xs font-bold text-[#1E293B] mb-1">
                    Kategori <span className="text-[#F0002B]">*</span>
                  </label>
                  <select
                    id="input-item-category"
                    value={formCategory}
                    onChange={(event) => setFormCategory(event.target.value as ItemCategory | '')}
                    className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-[12px] text-xs font-semibold text-[#1E293B] outline-none focus:border-[#F0002B]"
                    required
                  >
                    <option value="">Pilih kategori</option>
                    {ITEM_CATEGORIES.map((category) => <option key={category.code} value={category.name}>{category.name} ({category.code})</option>)}
                  </select>
                  <p className="mt-1 text-[10px] text-[#64748B]">Kode: <strong className="font-mono text-[#1E293B]">{editingItem && formCategory === editingItem.category ? editingItem.itemCode : editingItem ? 'Diperbarui saat disimpan' : 'Dibuat otomatis saat disimpan'}</strong></p>
                </div>

                {/* 3. Harga Katalog */}
                <div className="sm:col-span-1">
                  <label className="block text-xs font-bold text-[#1E293B] mb-1 flex items-center justify-between">
                    <span>
                      Harga Katalog (Rp) <span className="text-[#F0002B]">*</span>
                    </span>
                    <span className="text-[10px] text-[#64748B] font-normal">Untuk Request Outlet</span>
                  </label>
                  <input
                    id="input-item-price"
                    type="number"
                    min="0"
                    step="any"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Contoh: 38000"
                    className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-[12px] text-xs font-mono font-bold text-[#1E293B] outline-none focus:border-[#F0002B]"
                    required
                  />
                </div>

              </div>

              {/* 4. Vendor Rekanan (Multi-Vendor dengan Chip & Dropdown) */}
              <div className="bg-white p-3.5 border border-[#E2E8F0] rounded-xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div>
                    <label className="block text-xs font-bold text-[#1E293B] flex items-center space-x-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#2563EB]" />
                      <span>Vendor Rekanan</span>
                    </label>
                    <p className="text-[10px] text-[#64748B]">
                      Satu barang dapat memiliki banyak vendor. Vendor yang terhubung akan muncul saat penerimaan barang.
                    </p>
                  </div>
                  <span className="text-[11px] font-bold text-[#64748B] self-start sm:self-auto">
                    {formVendorIds.length} Vendor Terhubung
                  </span>
                </div>

                {/* Active Vendor Chips */}
                <div className="flex flex-wrap items-center gap-1.5 min-h-[32px] p-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px]">
                  {formVendorIds.length > 0 ? (
                    formVendorIds.map((vId) => {
                      const vObj = vendors.find((v) => v.id === vId);
                      if (!vObj) return null;
                      return (
                        <span
                          key={vId}
                          className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-[#CBD5E1] rounded-full text-xs font-medium text-[#1E293B]  hover:border-[#94A3B8] transition-colors"
                        >
                          <span className="font-mono text-[10px] font-bold text-[#2563EB]">
                            [{vObj.vendorCode}]
                          </span>
                          <span className="truncate max-w-[150px] sm:max-w-xs">{vObj.vendorName}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveVendorFromForm(vId)}
                            className="w-4 h-4 rounded-full bg-slate-100 hover:bg-red-100 hover:text-red-600 text-slate-500 inline-flex items-center justify-center text-xs font-bold transition-colors cursor-pointer ml-1"
                            title={`Lepas ${vObj.vendorName} dari barang ini`}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-xs text-[#94A3B8] italic">
                      Belum ada vendor terhubung. Pilih vendor di bawah untuk menghubungkan.
                    </span>
                  )}
                </div>

                {/* Add Vendor Selector Dropdown */}
                <div className="flex items-center space-x-2 pt-1">
                  <select
                    id="select-add-vendor-relation"
                    value={selectedVendorToAdd}
                    onChange={(e) =>
                      setSelectedVendorToAdd(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="flex-1 px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-[10px] text-xs font-medium text-[#1E293B] outline-none focus:border-[#F0002B]"
                  >
                    <option value="">-- Pilih Vendor Rekanan untuk Dihubungkan --</option>
                    {availableVendorsToAdd.map((v) => (
                      <option key={v.id} value={v.id}>
                        [{v.vendorCode}] {v.vendorName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddVendorToForm}
                    disabled={selectedVendorToAdd === ''}
                    className="inline-flex items-center space-x-1 px-3.5 py-1.5 bg-[#1E293B] hover:bg-[#233355] text-white text-xs font-bold rounded-[10px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 min-h-[32px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Hubungkan</span>
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="px-4 py-2 text-xs font-semibold text-[#64748B] hover:bg-gray-200 rounded-[12px] transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  id="btn-submit-item-form"
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-[#F0002B] hover:bg-[#D80027] text-white text-xs font-bold rounded-[12px]  cursor-pointer disabled:opacity-50 transition-all min-h-[36px]"
                >
                  {submitting ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Tambah Barang'}
                </button>
              </div>
            </form>
          )}

          {/* Table Items */}
          <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs min-w-[820px]">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] font-bold">
                    <th className="py-2.5 px-3 w-10 text-center">No</th>
                    <th className="py-2.5 px-3">Nama Barang</th>
                    <th className="py-2.5 px-3 w-28">Kategori</th>
                    <th className="py-2.5 px-3 w-24">Kode Barang</th>
                    <th className="py-2.5 px-3 w-32 text-right">Harga Katalog</th>
                    <th className="py-2.5 px-3 w-20 text-right">Stok</th>
                    <th className="py-2.5 px-3 w-36">Status</th>
                    <th className="py-2.5 px-3">Vendor Rekanan Aktif</th>
                    <th className="py-2.5 px-3 w-20 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredItems.length > 0 ? (
                    filteredItems.map((it, idx) => (
                      <tr key={it.id} className="hover:bg-[#F8FAFC]/80 transition-colors">
                        <td className="py-2.5 px-3 text-center text-[#64748B] font-mono">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#1E293B]">
                          {it.itemName}
                        </td>
                        <td className="py-2.5 px-3 text-[#64748B]">{it.category}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-[#1E293B]">{it.itemCode}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#1E293B] font-bold">
                          {formatRupiah(it.price)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#1E293B] tabular-nums">{Number(it.currentStock).toLocaleString('id-ID')}</td>
                        <td className="py-2.5 px-3"><StockStatusBadge currentStock={it.currentStock} /></td>
                        <td className="py-2.5 px-3 text-[#64748B]">
                          {it.activeVendors && it.activeVendors.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {it.activeVendors.map((av) => (
                                <span
                                  key={av.id}
                                  className="inline-flex items-center px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-[6px] text-[10px] text-[#1E293B] font-medium"
                                  title={av.vendorName}
                                >
                                  <span className="font-mono text-[#2563EB] mr-1">[{av.vendorCode}]</span>
                                  <span className="truncate max-w-[120px]">{av.vendorName}</span>
                                </span>
                              ))}
                            </div>
                          ) : it.vendorsSupplied && it.vendorsSupplied.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {it.vendorsSupplied.map((vLabel, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-[6px] text-[10px] text-[#1E293B]"
                                >
                                  {vLabel}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-400 italic">Belum ada vendor terhubung</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end space-x-1">
                            <button
                              onClick={() => startEdit(it)}
                              className="p-1.5 text-[#64748B] hover:text-[#1E293B] hover:bg-slate-100 rounded-[8px] transition-colors cursor-pointer"
                              title="Edit Barang & Vendor"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(it)}
                              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-[8px] transition-colors cursor-pointer"
                              title="Hapus Barang"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-[#64748B]">
                        Tidak ada barang ditemukan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center justify-between">
          <span className="text-xs text-[#64748B]">
            Total <strong>{items.length}</strong> barang di katalog
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-gray-100 text-[#1E293B] text-xs font-bold rounded-[12px] border border-[#E2E8F0] transition-colors cursor-pointer"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
