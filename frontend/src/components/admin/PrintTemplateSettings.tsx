import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Printer, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { StateMessage } from '../common/UI.tsx';
import { PrintableTransactionA4, TransactionDocument } from '../modals/PrintableTransactionA4.tsx';
import { PrintableReceipt, ReceiptDocument } from '../modals/PrintableReceipt.tsx';
import {
  DEFAULT_DELIVERY_ORDER_TEMPLATE, LOGO_MAX_BYTES, RECEIPT_PAPER_WIDTHS, MAX_NOTES, MAX_SIGNATURES, SAMPLE_DELIVERY_ORDER,
  announceTemplateUpdated, cloneTemplate, type DeliveryOrderTemplate,
} from '../../lib/printTemplate.ts';

const ENDPOINT = '/api/admin/print-templates/delivery-order';
const A4_WIDTH_PX = 794; // 210 mm at 96 dpi

// Moves entry `index` one step up (-1) or down (+1).
export const moveEntry = <T,>(list: T[], index: number, step: -1 | 1): T[] => {
  const target = index + step;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export const isLogoFileAllowed = (file: { type: string; size: number }) =>
  ['image/png', 'image/jpeg'].includes(file.type) && file.size > 0 && file.size <= LOGO_MAX_BYTES;

export const PrintTemplateSettings: React.FC = () => {
  const [saved, setSaved] = useState<DeliveryOrderTemplate | null>(null);
  const [form, setForm] = useState<DeliveryOrderTemplate>(() => cloneTemplate(DEFAULT_DELIVERY_ORDER_TEMPLATE));
  const [isDefault, setIsDefault] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testPrint, setTestPrint] = useState(false);
  const [testReceipt, setTestReceipt] = useState(false);

  const apply = (result: { template: DeliveryOrderTemplate; isDefault: boolean }) => {
    setSaved(result.template); setForm(cloneTemplate(result.template)); setIsDefault(result.isDefault); setLogoFile(null);
  };

  useEffect(() => {
    let active = true;
    fetch(ENDPOINT).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Pengaturan cetak tidak dapat dimuat.');
      if (active) apply(result);
    }).catch((reason) => { if (active) setLoadError(reason instanceof Error ? reason.message : 'Pengaturan cetak tidak dapat dimuat.'); });
    return () => { active = false; };
  }, []);

  // A chosen logo is shown from memory until it is uploaded on save.
  const logoPreview = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : ''), [logoFile]);
  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);
  const previewTemplate = useMemo(() => (logoPreview ? { ...form, header: { ...form.header, logoUrl: logoPreview } } : form), [form, logoPreview]);
  const dirty = Boolean(saved) && (logoFile !== null || JSON.stringify(form) !== JSON.stringify(saved));

  const set = <K extends keyof DeliveryOrderTemplate>(section: K, patch: Partial<DeliveryOrderTemplate[K]>) =>
    setForm((old) => ({ ...old, [section]: { ...(old[section] as object), ...patch } }));

  const chooseLogo = (file?: File) => {
    if (!file) return;
    if (!isLogoFileAllowed(file)) { setFeedback({ tone: 'error', text: 'Logo harus PNG atau JPG dengan ukuran maksimal 1 MB.' }); return; }
    setLogoFile(file); setFeedback(null);
  };
  const removeLogo = () => { setLogoFile(null); set('header', { logoUrl: '' }); };

  const save = async () => {
    setBusy(true); setFeedback(null);
    try {
      const next = cloneTemplate(form);
      if (logoFile) {
        const upload = await fetch('/api/admin/print-templates/logo', { method: 'POST', headers: { 'Content-Type': logoFile.type }, body: await logoFile.arrayBuffer() });
        const uploaded = await upload.json();
        if (!upload.ok) throw new Error(uploaded.error || 'Gagal mengunggah logo.');
        next.header.logoUrl = String(uploaded.url);
      }
      const response = await fetch(ENDPOINT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Gagal menyimpan pengaturan cetak.');
      apply(result); announceTemplateUpdated();
      setFeedback({ tone: 'ok', text: 'Pengaturan cetak disimpan. Cetakan Surat Jalan dan struk berikutnya memakai pengaturan ini.' });
    } catch (reason) {
      setFeedback({ tone: 'error', text: reason instanceof Error ? reason.message : 'Gagal menyimpan pengaturan cetak.' });
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!window.confirm('Kembalikan semua teks Surat Jalan ke bawaan? Perubahan yang tersimpan akan dihapus.')) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch(ENDPOINT, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Gagal mereset pengaturan cetak.');
      apply(result); announceTemplateUpdated();
      setFeedback({ tone: 'ok', text: 'Pengaturan cetak dikembalikan ke bawaan.' });
    } catch (reason) {
      setFeedback({ tone: 'error', text: reason instanceof Error ? reason.message : 'Gagal mereset pengaturan cetak.' });
    } finally { setBusy(false); }
  };

  if (loadError) return <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{loadError}</div>;
  if (!saved) return <StateMessage kind="loading">Memuat pengaturan cetak...</StateMessage>;

  const { header, title, info, table, notes, signatures } = form;
  const receipt = form.receipt ?? DEFAULT_DELIVERY_ORDER_TEMPLATE.receipt;
  const setNote = (index: number, value: string) => setForm((old) => ({ ...old, notes: old.notes.map((note, i) => (i === index ? value : note)) }));
  const setSignature = (index: number, patch: Partial<DeliveryOrderTemplate['signatures'][number]>) =>
    setForm((old) => ({ ...old, signatures: old.signatures.map((column, i) => (i === index ? { ...column, ...patch } : column)) }));

  return (
    <div className="space-y-3">
      <section className="hd-surface flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
        <div className="min-w-0">
          <h2>Surat Jalan &amp; Pengeluaran Barang (Delivery Order)</h2>
          <p className="mt-0.5 text-[11px] text-[#64748B]">
            Ubah teks tetap pada dokumen cetak. Nomor transaksi, tanggal, outlet, barang, qty, dan harga selalu diambil dari transaksi.
            {isDefault ? ' Saat ini memakai teks bawaan.' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTestPrint(true)} className="hd-button hd-button--secondary"><Printer size={14} />Coba cetak A4</button>
          <button type="button" onClick={() => setTestReceipt(true)} className="hd-button hd-button--secondary"><Printer size={14} />Coba cetak struk</button>
          <button type="button" onClick={() => void reset()} disabled={busy || isDefault} className="hd-button hd-button--secondary"><RotateCcw size={14} />Reset ke default</button>
          <button type="button" onClick={() => void save()} disabled={busy || !dirty} className="hd-button hd-button--primary"><Save size={14} />{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
        {feedback && <p role={feedback.tone === 'error' ? 'alert' : 'status'} className={`w-full text-xs ${feedback.tone === 'error' ? 'text-rose-700' : 'text-[#475569]'}`}>{feedback.text}</p>}
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <Section title="1. Kop / Header">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Nama brand" value={header.brandName} max={80} onChange={(brandName) => set('header', { brandName })} />
              <Field label="Sub-label" value={header.subLabel} max={40} onChange={(subLabel) => set('header', { subLabel })} />
              <Field className="sm:col-span-2" label="Nama divisi" value={header.divisionName} max={160} onChange={(divisionName) => set('header', { divisionName })} />
              <Field className="sm:col-span-2" label="Alamat" value={header.address} max={200} onChange={(address) => set('header', { address })} />
              <Field label="Hotline" value={header.hotline} max={40} onChange={(hotline) => set('header', { hotline })} />
              <Field label="Email" value={header.email} max={120} onChange={(email) => set('header', { email })} />
              <Field label="Kode form" value={header.formCode} max={40} onChange={(formCode) => set('header', { formCode })} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-2">
              <div className="grid h-12 w-32 place-items-center overflow-hidden rounded bg-white">
                {logoPreview || header.logoUrl ? <img src={logoPreview || header.logoUrl} alt="Preview logo" className="max-h-11 max-w-full object-contain" /> : <ImagePlus size={20} className="text-[#94A3B8]" />}
              </div>
              <div className="min-w-0 flex-1 text-[11px] text-[#64748B]">
                <label className="block text-xs font-medium text-[#475569]">Logo (opsional)
                  <input type="file" accept="image/png,image/jpeg" onChange={(event) => { chooseLogo(event.target.files?.[0]); event.target.value = ''; }} className="mt-1 block text-[11px]" />
                </label>
                PNG/JPG maks. 1 MB. Kosong = nama brand ditampilkan sebagai teks.
              </div>
              {(logoPreview || header.logoUrl) && <button type="button" onClick={removeLogo} className="hd-button hd-button--ghost"><X size={14} />Hapus logo</button>}
            </div>
          </Section>

          <Section title="2. Judul dokumen">
            <div className="grid gap-2">
              <Field label="Judul" value={title.title} max={120} onChange={(value) => set('title', { title: value })} />
              <Field label="Sub-judul" value={title.subtitle} max={200} onChange={(subtitle) => set('title', { subtitle })} />
            </div>
          </Section>

          <Section title="3. Info transaksi">
            <Field label='Nilai "Pengeluaran Dari"' value={info.issuedFrom} max={80} onChange={(issuedFrom) => set('info', { issuedFrom })} />
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              <Toggle label="Metode Pembayaran" checked={info.showPaymentMethod} onChange={(showPaymentMethod) => set('info', { showPaymentMethod })} />
              <Toggle label="Disetujui Oleh" checked={info.showApprovedBy} onChange={(showApprovedBy) => set('info', { showApprovedBy })} />
              <Toggle label="Tanggal Approval" checked={info.showApprovalDate} onChange={(showApprovalDate) => set('info', { showApprovalDate })} />
            </div>
          </Section>

          <Section title="4. Tabel barang">
            <div className="grid gap-1.5 sm:grid-cols-2">
              <Toggle label="Kolom harga (Harga per Unit, Subtotal, Grand Total)" checked={table.showPrices} onChange={(showPrices) => set('table', { showPrices, ...(showPrices ? {} : { showTerbilang: false }) })} />
              <Toggle label='Baris "Terbilang"' checked={table.showTerbilang} disabled={!table.showPrices} hint={table.showPrices ? undefined : 'Ikut tersembunyi bila harga disembunyikan.'} onChange={(showTerbilang) => set('table', { showTerbilang })} />
            </div>
          </Section>

          <Section title="5. Catatan kaki" action={<button type="button" disabled={notes.length >= MAX_NOTES} onClick={() => setForm((old) => ({ ...old, notes: [...old.notes, ''] }))} className="hd-button hd-button--secondary"><Plus size={14} />Tambah catatan</button>}>
            {notes.length === 0 && <p className="text-[11px] text-[#64748B]">Tidak ada catatan. Bagian catatan tidak dicetak.</p>}
            <ol className="space-y-1.5">
              {notes.map((note, index) => (
                <li key={index} className="flex items-start gap-1.5">
                  <span className="mt-2 w-5 shrink-0 text-right text-[11px] text-[#64748B]">{index + 1}.</span>
                  <textarea aria-label={`Catatan ${index + 1}`} rows={2} maxLength={300} value={note} onChange={(event) => setNote(index, event.target.value)} className="hd-input min-w-0 flex-1 resize-y" />
                  <RowActions
                    onUp={() => setForm((old) => ({ ...old, notes: moveEntry(old.notes, index, -1) }))}
                    onDown={() => setForm((old) => ({ ...old, notes: moveEntry(old.notes, index, 1) }))}
                    onDelete={() => setForm((old) => ({ ...old, notes: old.notes.filter((_, i) => i !== index) }))}
                    first={index === 0} last={index === notes.length - 1} name={`catatan ${index + 1}`} />
                </li>
              ))}
            </ol>
          </Section>

          <Section title={`6. Kolom tanda tangan (${signatures.length}/${MAX_SIGNATURES})`} action={<button type="button" disabled={signatures.length >= MAX_SIGNATURES} onClick={() => setForm((old) => ({ ...old, signatures: [...old.signatures, { label: 'Label tanda tangan', name: 'Nama', useOutletName: false }] }))} className="hd-button hd-button--secondary"><Plus size={14} />Tambah kolom</button>}>
            <ol className="space-y-2">
              {signatures.map((column, index) => (
                <li key={index} className="flex items-start gap-1.5 rounded-lg border border-[#E2E8F0] p-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <Field label={`Label atas kolom ${index + 1}`} value={column.label} max={80} onChange={(label) => setSignature(index, { label })} />
                    <div>
                      <Field label="Nama di bawah garis" value={column.useOutletName ? '(otomatis: nama outlet)' : column.name} max={80} disabled={column.useOutletName} onChange={(name) => setSignature(index, { name })} />
                      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-[#475569]">
                        <input type="checkbox" checked={column.useOutletName} onChange={(event) => setSignature(index, event.target.checked ? { useOutletName: true, name: '' } : { useOutletName: false, name: column.name || 'Nama' })} />
                        Isi otomatis dari nama outlet
                      </label>
                    </div>
                  </div>
                  <RowActions
                    onUp={() => setForm((old) => ({ ...old, signatures: moveEntry(old.signatures, index, -1) }))}
                    onDown={() => setForm((old) => ({ ...old, signatures: moveEntry(old.signatures, index, 1) }))}
                    onDelete={signatures.length > 1 ? () => setForm((old) => ({ ...old, signatures: old.signatures.filter((_, i) => i !== index) })) : undefined}
                    first={index === 0} last={index === signatures.length - 1} name={`kolom tanda tangan ${index + 1}`} />
                </li>
              ))}
            </ol>
          </Section>

          <Section title="7. Struk belanja">
            <p className="mb-2 text-[11px] text-[#64748B]">Untuk printer struk (thermal). Nama brand, logo, alamat, dan hotline diambil dari Kop / Header.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-[#475569]">Lebar kertas
                <select className="hd-input mt-1" value={receipt.paperWidth} onChange={(event) => set('receipt', { paperWidth: Number(event.target.value) as 58 | 80 })}>
                  {RECEIPT_PAPER_WIDTHS.map((width) => <option key={width} value={width}>{width} mm</option>)}
                </select>
              </label>
              <div className="grid gap-1.5">
                <Toggle label="harga dan total" checked={receipt.showPrices} onChange={(showPrices) => set('receipt', { showPrices })} />
                <Toggle label="Disetujui Oleh" checked={receipt.showApprovedBy} onChange={(showApprovedBy) => set('receipt', { showApprovedBy })} />
              </div>
              <Field className="sm:col-span-2" label="Teks penutup (kosongkan bila tidak perlu)" value={receipt.footer} max={200} onChange={(footer) => set('receipt', { footer })} />
            </div>
          </Section>
        </div>

        <div className="min-w-0">
          <section className="hd-surface p-3 xl:sticky xl:top-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2>Live preview</h2>
              <span className="text-[11px] text-[#64748B]">Contoh data transaksi · {dirty ? 'belum disimpan' : 'tersimpan'}</span>
            </div>
            <ScaledPreview template={previewTemplate} />
            <h2 className="mb-2 mt-4">Preview struk ({receipt.paperWidth} mm)</h2>
            <div className="flex justify-center rounded-lg border border-[#E2E8F0] bg-[#E2E8F0]/50 p-3" aria-label="Preview struk">
              <div className="shadow-md"><ReceiptDocument preview data={SAMPLE_DELIVERY_ORDER} template={previewTemplate} /></div>
            </div>
          </section>
        </div>
      </div>

      <PrintableReceipt isOpen={testReceipt} onClose={() => setTestReceipt(false)} data={SAMPLE_DELIVERY_ORDER} template={previewTemplate} />
      <PrintableTransactionA4 isOpen={testPrint} onClose={() => setTestPrint(false)} type="outgoing" data={SAMPLE_DELIVERY_ORDER} template={previewTemplate} />
    </div>
  );
};

// Draws the A4 sheet at full size and zooms it down to the column width, so the
// preview wraps text exactly where the printed page does.
function ScaledPreview({ template }: { template: DeliveryOrderTemplate }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setScale(Math.min(1, element.clientWidth / A4_WIDTH_PX));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={frame} className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#E2E8F0]/50">
      <div style={{ width: A4_WIDTH_PX, zoom: scale } as React.CSSProperties} aria-label="Preview dokumen Surat Jalan">
        <TransactionDocument preview type="outgoing" data={SAMPLE_DELIVERY_ORDER} template={template} />
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="hd-surface p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-[#1E293B]">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, max, disabled, className }: { label: string; value: string; onChange: (value: string) => void; max: number; disabled?: boolean; className?: string }) {
  return (
    <label className={`block text-xs font-medium text-[#475569] ${className || ''}`}>{label}
      <input className="hd-input mt-1" value={value} maxLength={max} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex items-start gap-2 rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-xs ${disabled ? 'text-[#94A3B8]' : 'text-[#475569]'}`}>
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>Tampilkan {label}{hint && <small className="block text-[10px]">{hint}</small>}</span>
    </label>
  );
}

function RowActions({ onUp, onDown, onDelete, first, last, name }: { onUp: () => void; onDown: () => void; onDelete?: () => void; first: boolean; last: boolean; name: string }) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <button type="button" onClick={onUp} disabled={first} className="hd-button hd-button--ghost hd-icon-button" title={`Naikkan ${name}`} aria-label={`Naikkan ${name}`}><ArrowUp size={14} /></button>
      <button type="button" onClick={onDown} disabled={last} className="hd-button hd-button--ghost hd-icon-button" title={`Turunkan ${name}`} aria-label={`Turunkan ${name}`}><ArrowDown size={14} /></button>
      <button type="button" onClick={onDelete} disabled={!onDelete} className="hd-button hd-button--ghost hd-icon-button" title={`Hapus ${name}`} aria-label={`Hapus ${name}`}><Trash2 size={14} /></button>
    </div>
  );
}
