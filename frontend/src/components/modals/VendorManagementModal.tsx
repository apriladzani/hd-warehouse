import React, { useState } from 'react';
import { X, Building2, Plus, Edit2, Trash2, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import { Vendor } from '../../types.ts';

interface VendorManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendors: Vendor[];
  onRefresh: () => void;
  initialEditingVendor?: Vendor | null;
}

export const VendorManagementModal: React.FC<VendorManagementModalProps> = ({
  isOpen,
  onClose,
  vendors,
  onRefresh,
  initialEditingVendor,
}) => {
  const [search, setSearch] = useState('');
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(initialEditingVendor || null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states
  const [formCode, setFormCode] = useState(initialEditingVendor ? initialEditingVendor.vendorCode : '');
  const [formName, setFormName] = useState(initialEditingVendor ? initialEditingVendor.vendorName : '');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    if (initialEditingVendor) {
      setEditingVendor(initialEditingVendor);
      setFormCode(initialEditingVendor.vendorCode);
      setFormName(initialEditingVendor.vendorName);
      setIsCreating(false);
    }
  }, [initialEditingVendor]);

  if (!isOpen) return null;

  const filteredVendors = vendors.filter(
    (v) =>
      v.vendorName.toLowerCase().includes(search.toLowerCase()) ||
      v.vendorCode.toLowerCase().includes(search.toLowerCase())
  );

  const startCreate = () => {
    setEditingVendor(null);
    setFormCode(`VND-${String(vendors.length + 1).padStart(2, '0')}`);
    setFormName('');
    setIsCreating(true);
    setMessage(null);
  };

  const startEdit = (v: Vendor) => {
    setIsCreating(false);
    setEditingVendor(v);
    setFormCode(v.vendorCode);
    setFormName(v.vendorName);
    setMessage(null);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingVendor(null);
    setFormCode('');
    setFormName('');
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCode.trim() || !formName.trim()) {
      setMessage({ type: 'error', text: 'Kode vendor dan nama vendor wajib diisi!' });
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);

      if (editingVendor) {
        // Update
        const res = await fetch(`/api/vendors/${editingVendor.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendorCode: formCode, vendorName: formName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mengubah vendor');

        setMessage({ type: 'success', text: `Vendor ${formName} berhasil diperbarui!` });
      } else {
        // Create
        const res = await fetch('/api/vendors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendorCode: formCode, vendorName: formName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menambahkan vendor');

        setMessage({ type: 'success', text: `Vendor ${formName} berhasil ditambahkan!` });
      }

      onRefresh();
      cancelForm();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Terjadi kesalahan sistem' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (v: Vendor) => {
    const confirmDelete = window.confirm(
      `Yakin ingin menghapus vendor "${v.vendorName}" [${v.vendorCode}]?`
    );
    if (!confirmDelete) return;

    try {
      setSubmitting(true);
      setMessage(null);
      const res = await fetch(`/api/vendors/${v.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus vendor');

      setMessage({ type: 'success', text: `Vendor ${v.vendorName} berhasil dihapus.` });
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Gagal menghapus vendor' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div
        className="bg-white w-full max-w-2xl rounded-[22px] border border-[#DDE5F0] shadow-xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 sm:px-5 py-2.5 sm:py-4 border-b border-[#DDE5F0] bg-[#F8FAFC]">
          <div className="flex items-center space-x-2 sm:space-x-2.5">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-[8px] sm:rounded-[10px] bg-[#ED002B]/10 text-[#ED002B] flex items-center justify-center font-bold">
              <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-base font-bold text-[#17233D]">
                Kelola Vendor &amp; Kode Vendor (CRUD)
              </h2>
              <p className="text-[10px] sm:text-xs text-[#60708C]">
                Tambah, lihat, perbarui kode vendor, dan kelola mitra pemasok.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 sm:p-1.5 text-[#60708C] hover:text-[#17233D] rounded-full hover:bg-gray-200 transition-colors"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Notification banner */}
        {message && (
          <div
            className={`px-3.5 sm:px-5 py-2 sm:py-3 flex items-center space-x-2 text-[10px] sm:text-xs font-semibold ${
              message.type === 'success'
                ? 'bg-[#EAF8F1] text-[#1B9357] border-b border-[#A7E4C4]'
                : 'bg-red-50 text-red-600 border-b border-red-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <div className="p-3 sm:p-5 overflow-y-auto space-y-3 sm:space-y-5">
          {/* Action top bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#60708C] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode atau nama vendor..."
                className="w-full pl-8 pr-2.5 py-1.5 sm:py-2 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[10px] sm:rounded-[14px] text-[10px] sm:text-xs text-[#17233D] outline-none focus:border-[#ED002B]"
              />
            </div>

            {!isCreating && !editingVendor && (
              <button
                id="btn-add-new-vendor"
                onClick={startCreate}
                className="inline-flex items-center justify-center space-x-1 sm:space-x-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[10px] sm:rounded-[14px] shadow-xs transition-all cursor-pointer min-h-[32px] sm:min-h-[38px]"
              >
                <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>Tambah Vendor Baru</span>
              </button>
            )}
          </div>

          {/* Form Create / Edit Section */}
          {(isCreating || editingVendor) && (
            <form
              onSubmit={handleSubmit}
              className="p-3 sm:p-4 bg-[#F8FAFC] border border-[#DDE5F0] rounded-[14px] sm:rounded-[18px] space-y-2.5 sm:space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] sm:text-xs font-bold text-[#17233D]">
                  {editingVendor ? `Edit: ${editingVendor.vendorName}` : 'Tambah Vendor Baru'}
                </span>
                <button
                  type="button"
                  onClick={cancelForm}
                  className="text-[10px] sm:text-xs text-[#60708C] hover:text-[#17233D] underline"
                >
                  Batal
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-bold text-[#17233D] mb-1">
                    Kode Vendor <span className="text-[#ED002B]">*</span>
                  </label>
                  <input
                    id="input-vendor-code"
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                    placeholder="Contoh: VND-05"
                    className="w-full px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-[#DDE5F0] rounded-[10px] sm:rounded-[12px] text-[10px] sm:text-xs font-mono font-bold text-[#17233D] outline-none focus:border-[#ED002B]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] sm:text-[11px] font-bold text-[#17233D] mb-1">
                    Nama Vendor / Rekanan <span className="text-[#ED002B]">*</span>
                  </label>
                  <input
                    id="input-vendor-name"
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Contoh: PT Unggas Jaya Makmur"
                    className="w-full px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-[#DDE5F0] rounded-[10px] sm:rounded-[12px] text-[10px] sm:text-xs text-[#17233D] outline-none focus:border-[#ED002B]"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="px-3 py-1 text-[10px] sm:text-xs text-[#60708C] hover:bg-gray-200 rounded-[8px] sm:rounded-[12px]"
                >
                  Batal
                </button>
                <button
                  id="btn-submit-vendor-form"
                  type="submit"
                  disabled={submitting}
                  className="px-3.5 py-1.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[12px] shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Menyimpan...' : editingVendor ? 'Simpan' : 'Tambah'}
                </button>
              </div>
            </form>
          )}

          {/* Vendors List Table */}
          <div className="border border-[#DDE5F0] rounded-[12px] sm:rounded-[16px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[10px] sm:text-xs min-w-[360px] sm:min-w-full">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#DDE5F0] text-[#60708C] font-bold">
                    <th className="py-2 px-2 sm:px-3 w-8 sm:w-12 text-center">No</th>
                    <th className="py-2 px-2 sm:px-3 w-24 sm:w-28">Kode Vendor</th>
                    <th className="py-2 px-2 sm:px-3">Nama Vendor</th>
                    <th className="py-2 px-2 sm:px-3 w-16 sm:w-28 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE5F0]">
                  {filteredVendors.length > 0 ? (
                    filteredVendors.map((v, idx) => (
                      <tr key={v.id} className="hover:bg-[#F8FAFC]/80 transition-colors">
                        <td className="py-2 px-2 sm:px-3 text-center text-[#60708C] font-mono">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-2 sm:px-3 font-mono font-bold text-[#17233D]">
                          <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded-[4px] sm:rounded-[6px] text-[9px] sm:text-[11px]">
                            {v.vendorCode}
                          </span>
                        </td>
                        <td className="py-2 px-2 sm:px-3 font-semibold text-[#17233D]">
                          {v.vendorName}
                        </td>
                        <td className="py-2 px-2 sm:px-3 text-right">
                          <div className="flex items-center justify-end space-x-1">
                            <button
                              onClick={() => startEdit(v)}
                              className="p-1 sm:p-1.5 text-[#60708C] hover:text-[#17233D] hover:bg-slate-100 rounded-[6px] sm:rounded-[8px] transition-colors"
                              title="Edit Vendor"
                            >
                              <Edit2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(v)}
                              className="p-1 sm:p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-[6px] sm:rounded-[8px] transition-colors"
                              title="Hapus Vendor"
                            >
                              <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-6 sm:py-8 text-center text-[#60708C]">
                        Tidak ada vendor ditemukan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3.5 sm:px-5 py-2.5 sm:py-3 bg-[#F8FAFC] border-t border-[#DDE5F0] flex items-center justify-between">
          <span className="text-[10px] sm:text-xs text-[#60708C]">
            Total {vendors.length} vendor
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 sm:px-4 sm:py-1.5 bg-white hover:bg-gray-100 text-[#17233D] text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[12px] border border-[#DDE5F0] transition-colors"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
