import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, History, Save } from 'lucide-react';
import { InventoryItem } from '../../types.ts';

type OpnameLine = {
  itemId: number;
  itemName: string;
  systemStock: number;
  physicalStock: number | null;
  difference: number | null;
  status: 'Sesuai' | 'Selisih' | 'Belum Diperiksa';
};

type OpnameRecord = {
  id: number;
  examinationDate: string;
  notes: string;
  createdBy: string;
  items: OpnameLine[];
  createdAt: string | null;
};

const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', {
  day: '2-digit', month: 'long', year: 'numeric',
});

const numberFormat = (value: number) => Number(value).toLocaleString('id-ID');

interface WarehouseStockOpnameProps {
  items: InventoryItem[];
  loading: boolean;
}

export const WarehouseStockOpname: React.FC<WarehouseStockOpnameProps> = ({ items, loading }) => {
  const [examinationDate, setExaminationDate] = useState(todayLocal);
  const [notes, setNotes] = useState('');
  const [physicalStocks, setPhysicalStocks] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<OpnameRecord[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const response = await fetch('/api/inventory/stock-opname');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal memuat riwayat Stock Opname');
      setHistory(data.history || []);
    } catch (err: any) {
      setError(err.message || 'Gagal memuat riwayat Stock Opname');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const checkedCount = useMemo(() => Object.values(physicalStocks).filter((value) => value !== '').length, [physicalStocks]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!examinationDate) {
      setError('Tanggal pemeriksaan wajib diisi.');
      return;
    }
    if (!checkedCount) {
      setError('Masukkan stok fisik minimal satu barang sebelum menyimpan.');
      return;
    }
    const invalidStock = Object.values(physicalStocks).some((value) => value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0));
    if (invalidStock) {
      setError('Stok fisik harus berupa bilangan bulat nol atau lebih.');
      return;
    }

    try {
      setSaving(true);
      const response = await fetch('/api/inventory/stock-opname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examinationDate,
          notes,
          physicalStocks: items.map((item) => ({
            itemId: item.id,
            physicalStock: physicalStocks[item.id] === undefined || physicalStocks[item.id] === '' ? null : Number(physicalStocks[item.id]),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal menyimpan Stock Opname');
      setHistory((current) => [data.opname, ...current]);
      setExpandedId(data.opname.id);
      setPhysicalStocks({});
      setNotes('');
      setSuccess('Hasil Stock Opname berhasil disimpan. Stok sistem tidak berubah.');
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan Stock Opname');
    } finally {
      setSaving(false);
    }
  };

  const statusClass = (status: OpnameLine['status']) => status === 'Sesuai'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'Selisih'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-100 text-slate-500 border-slate-200';

  const renderLines = (lines: OpnameLine[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[650px] text-xs text-left">
        <thead className="bg-[#F8FAFC] text-[10px] uppercase tracking-wide text-[#60708C]">
          <tr>
            <th className="px-3 py-2">Nama Barang</th>
            <th className="px-3 py-2 text-right">Stok Sistem</th>
            <th className="px-3 py-2 text-right">Stok Fisik</th>
            <th className="px-3 py-2 text-right">Selisih</th>
            <th className="px-3 py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#DDE5F0] text-[#17233D]">
          {lines.map((line) => (
            <tr key={line.itemId}>
              <th scope="row" className="px-3 py-2.5 font-semibold">{line.itemName}</th>
              <td className="px-3 py-2.5 text-right tabular-nums">{numberFormat(line.systemStock)} pcs</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{line.physicalStock === null ? '—' : `${numberFormat(line.physicalStock)} pcs`}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${line.difference === null ? 'text-slate-400' : line.difference === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {line.difference === null ? '—' : `${line.difference > 0 ? '+' : ''}${numberFormat(line.difference)} pcs`}
              </td>
              <td className="px-3 py-2.5 text-center">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(line.status)}`}>{line.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-3">
      <form onSubmit={handleSave} className="bg-white rounded-[14px] border border-[#DDE5F0] shadow-xs overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-[#DDE5F0] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-[#ED002B]" />
            <div>
              <h2 className="text-sm font-bold text-[#17233D]">Stock Opname</h2>
              <p className="text-[10px] text-[#60708C]">Catat stok fisik dan bandingkan dengan stok sistem.</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-[#60708C]">{checkedCount} dari {items.length} barang diperiksa</span>
        </div>

        <div className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-2.5">
            <label className="text-[10px] font-bold text-[#60708C] uppercase tracking-wide">
              Tanggal Pemeriksaan
              <input type="date" value={examinationDate} onChange={(event) => setExaminationDate(event.target.value)} className="mt-1 block w-full rounded-[9px] border border-[#DDE5F0] bg-[#F8FAFC] px-2.5 py-2 text-xs font-medium text-[#17233D] outline-none focus:border-[#ED002B]" />
            </label>
            <label className="text-[10px] font-bold text-[#60708C] uppercase tracking-wide">
              Catatan Pemeriksaan
              <input type="text" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Catatan opsional untuk pemeriksaan ini" className="mt-1 block w-full rounded-[9px] border border-[#DDE5F0] bg-[#F8FAFC] px-2.5 py-2 text-xs font-medium normal-case text-[#17233D] outline-none focus:border-[#ED002B]" />
            </label>
          </div>

          <div className="rounded-[10px] border border-[#DDE5F0] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-xs text-left">
                <thead className="bg-[#F8FAFC] text-[10px] uppercase tracking-wide text-[#60708C]">
                  <tr>
                    <th className="px-3 py-2">Nama Barang</th>
                    <th className="px-3 py-2 text-right">Stok Sistem</th>
                    <th className="px-3 py-2 text-right">Stok Fisik</th>
                    <th className="px-3 py-2 text-right">Selisih</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE5F0] text-[#17233D]">
                  {loading ? <tr><td colSpan={5} className="py-8 text-center text-[#60708C]">Memuat Inventory...</td></tr> : items.map((item) => {
                    const rawPhysical = physicalStocks[item.id] ?? '';
                    const physical = rawPhysical === '' ? null : Number(rawPhysical);
                    const difference = physical === null ? null : physical - Number(item.currentStock);
                    const status: OpnameLine['status'] = physical === null ? 'Belum Diperiksa' : difference === 0 ? 'Sesuai' : 'Selisih';
                    return (
                      <tr key={item.id}>
                        <th scope="row" className="px-3 py-2.5 font-semibold">{item.itemName}</th>
                        <td className="px-3 py-2.5 text-right tabular-nums">{numberFormat(item.currentStock)} pcs</td>
                        <td className="px-3 py-1.5 text-right">
                          <input type="number" min="0" step="1" inputMode="numeric" aria-label={`Stok fisik ${item.itemName}`} value={rawPhysical} onChange={(event) => setPhysicalStocks((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Belum diperiksa" className="w-32 rounded-md border border-[#DDE5F0] bg-white px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:border-[#ED002B] placeholder:text-[10px] placeholder:text-slate-400" />
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${difference === null ? 'text-slate-400' : difference === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {difference === null ? '—' : `${difference > 0 ? '+' : ''}${numberFormat(difference)} pcs`}
                        </td>
                        <td className="px-3 py-2.5 text-center"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(status)}`}>{status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
          {success && <p role="status" className="text-xs font-medium text-emerald-700">{success}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-[#60708C]">Menyimpan hasil opname tidak mengubah stok sistem.</p>
            <button type="submit" disabled={saving || loading || !items.length} className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#ED002B] px-3 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#d60027] disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />{saving ? 'Menyimpan...' : 'Simpan Hasil Stock Opname'}
            </button>
          </div>
        </div>
      </form>

      <section className="bg-white rounded-[14px] border border-[#DDE5F0] shadow-xs overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-[#DDE5F0] flex items-center gap-2">
          <History className="w-4 h-4 text-[#60708C]" />
          <h2 className="text-sm font-bold text-[#17233D]">Riwayat Stock Opname</h2>
          <span className="ml-auto text-[10px] text-[#60708C]">{history.length} pemeriksaan</span>
        </div>
        {historyLoading ? <div className="p-5 text-center text-xs text-[#60708C]">Memuat riwayat...</div> : history.length ? (
          <div className="divide-y divide-[#DDE5F0]">
            {history.map((record) => {
              const checked = record.items.filter((line) => line.status !== 'Belum Diperiksa').length;
              const discrepancies = record.items.filter((line) => line.status === 'Selisih').length;
              return (
                <div key={record.id}>
                  <button type="button" onClick={() => setExpandedId(expandedId === record.id ? null : record.id)} className="w-full px-3 sm:px-4 py-3 text-left hover:bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#17233D]">{formatDate(record.examinationDate)}</span>
                    <span className="text-[10px] text-[#60708C]">{checked}/{record.items.length} diperiksa · {discrepancies} selisih</span>
                    <span className="text-[10px] font-semibold text-[#1D63D8]">{expandedId === record.id ? 'Tutup' : 'Lihat hasil'}</span>
                  </button>
                  {expandedId === record.id && (
                    <div className="border-t border-[#DDE5F0] bg-[#FBFCFE]">
                      <div className="px-3 sm:px-4 py-2 text-[10px] text-[#60708C]">
                        Pemeriksa: <strong className="text-[#17233D]">{record.createdBy}</strong>
                        {record.notes && <span className="ml-3">Catatan: <strong className="text-[#17233D]">{record.notes}</strong></span>}
                      </div>
                      {renderLines(record.items)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <div className="p-5 text-center text-xs text-[#60708C]">Belum ada riwayat pemeriksaan.</div>}
      </section>
    </div>
  );
};
