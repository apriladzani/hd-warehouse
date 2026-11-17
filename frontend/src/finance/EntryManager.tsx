import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Paperclip, Plus, Trash2, Pencil } from 'lucide-react';
import type { TransactionRecord } from '../../../backend/src/finance/transactionPlan.ts';
import { Button, StateMessage } from '../components/common/UI.tsx';
import { Modal, attachmentUrl } from './components.tsx';
import { FinanceApiError, financeGet, financeWrite } from './api.ts';
import { formatMoney, reportQuery, unitLabel, type Accounts, type Filter, type OutletOption, type Unit } from './model.ts';
import { parseRupiah } from './ledgerInput.ts';

export type EntryRow = { date: string; unit: Unit; accountCode: string; amount: string; notes: string; attachment: string | null };
export interface EntryGateway {
  list(filter: Filter): Promise<TransactionRecord[]>;
  saveBatch(rows: EntryRow[], batchKey: string): Promise<void>;
  update(id: string, row: EntryRow, version: number, reason: string): Promise<void>;
  remove(id: string, version: number, reason: string): Promise<void>;
  upload(file: File): Promise<string>;
}
const BASE = '/api/finance/v2/transactions';
export function createEntryGateway(request: typeof fetch = fetch): EntryGateway {
  return {
    async list(filter) { const body = await financeGet(`${BASE}?${reportQuery(filter)}`, request); return body.transactions as TransactionRecord[]; },
    async saveBatch(rows, batchKey) { await financeWrite(`${BASE}/batch`, 'POST', { batchKey, rows }, request); },
    async update(id, row, version, reason) { await financeWrite(`${BASE}/${encodeURIComponent(id)}`, 'PUT', { ...row, version, reason }, request); },
    async remove(id, version, reason) { await financeWrite(`${BASE}/${encodeURIComponent(id)}`, 'DELETE', { version, reason }, request); },
    async upload(file) {
      let response: Response;
      try { response = await request(`${BASE}/attachments`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file }); }
      catch { throw new FinanceApiError('network', 'Lampiran gagal diunggah.'); }
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.attachment !== 'string') throw new FinanceApiError('invalid', body?.error ?? 'Lampiran harus PDF, PNG, JPG, atau WEBP (maksimal 5 MB).');
      return body.attachment;
    },
  };
}

type Draft = { key: string; group: string; accountCode: string; unit: string; date: string; amountText: string; notes: string; attachment: string | null; attachmentName: string };
const unitValue = (unit: Unit) => unit.type === 'WAREHOUSE' ? 'WAREHOUSE' : String(unit.outletId);
const unitFrom = (value: string): Unit => value === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: Number(value) };
// The entry list gets long: it can be folded away. The choice is remembered per
// page (DC, DA, CI) in this browser only; it starts folded.
const listOpenKey = (classes: string[]) => `hd-finance-entry-list-open:${classes.join()}`;
const readListOpen = (classes: string[]) => { try { return localStorage.getItem(listOpenKey(classes)) === '1'; } catch { return false; } };
const writeListOpen = (classes: string[], open: boolean) => { try { localStorage.setItem(listOpenKey(classes), open ? '1' : '0'); } catch { /* storage unavailable */ } };
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '');

// Rows complete enough to send; the backend checks them again.
export function draftProblem(draft: Draft): string | null {
  if (!draft.group) return 'Pilih klasifikasi.';
  if (!draft.accountCode) return 'Pilih kode biaya.';
  if (!draft.unit) return 'Pilih unit/outlet.';
  if (!draft.date) return 'Isi tanggal transaksi.';
  if (!parseRupiah(draft.amountText)) return 'Nominal harus angka Rupiah lebih dari 0.';
  if (!draft.notes.trim()) return 'Isi keterangan.';
  return null;
}
export const toEntryRow = (draft: Draft): EntryRow => ({ date: draft.date, unit: unitFrom(draft.unit), accountCode: draft.accountCode, amount: parseRupiah(draft.amountText)!, notes: draft.notes.trim(), attachment: draft.attachment });

// Finance input of costs (DC, DA) and Other Income per unit: several rows at
// once, list with filters, edit and delete (void) of manual rows. Rows synced
// from HD Outlet are read-only: they are corrected in HD Outlet and synced again.
export function EntryManager({ classes, accounts, outlets, filter, canEdit, onChanged, gateway }: { classes: ('DC' | 'DA' | 'CI')[]; accounts: Accounts | null; outlets: OutletOption[]; filter: Filter; canEdit: boolean; onChanged?: () => void; gateway?: EntryGateway }) {
  const api = useMemo(() => gateway ?? createEntryGateway(), [gateway]);
  const groups = (accounts?.groups ?? []).filter(g => g.manual && classes.includes(g.classCode));
  const groupOf = (code: string) => accounts?.accounts.find(a => a.code === code)?.groupCode ?? '';
  const nameOf = (code: string) => accounts?.accounts.find(a => a.code === code)?.name ?? '';
  const codesOf = (group: string) => (accounts?.accounts ?? []).filter(a => a.groupCode === group && a.isActive);
  const activeOutlets = outlets.filter(o => o.isActive !== false);
  const defaultUnit = filter.mode === 'WAREHOUSE' ? 'WAREHOUSE' : filter.outletIds?.length === 1 ? String(filter.outletIds[0]) : '';
  const blank = (): Draft => ({ key: newKey(), group: groups.length === 1 ? groups[0].code : '', accountCode: '', unit: defaultUnit, date: filter.endDate, amountText: '', notes: '', attachment: null, attachmentName: '' });

  const [rows, setRows] = useState<TransactionRecord[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [unitFilter, setUnitFilter] = useState(''), [groupFilter, setGroupFilter] = useState('');
  const [adding, setAdding] = useState<Draft[] | null>(null), [batchKey, setBatchKey] = useState('');
  const [editing, setEditing] = useState<{ row: TransactionRecord; draft: Draft; reason: string } | null>(null);
  const [removing, setRemoving] = useState<{ row: TransactionRecord; reason: string } | null>(null);
  const [busy, setBusy] = useState(false), [formError, setFormError] = useState('');
  const [listOpen, setListOpen] = useState(() => readListOpen(classes));
  const toggleList = () => setListOpen(open => { writeListOpen(classes, !open); return !open; });
  const listId = `fn-entry-list-${classes.join('-')}`;
  const filterKey = reportQuery(filter);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api.list(filter).then(list => { if (active) { setRows(list); setLoaded(true); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Daftar entri gagal dimuat.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, filterKey, revision]);
  const refresh = () => { setRevision(v => v + 1); onChanged?.(); };
  const allowed = new Set(groups.map(g => g.code));
  const shown = rows.filter(r => r.status !== 'void' && allowed.has(groupOf(r.accountCode)) && (!groupFilter || groupOf(r.accountCode) === groupFilter) && (!unitFilter || unitValue(r.unit) === unitFilter));
  const total = shown.filter(r => r.status === 'posted').reduce((sum, r) => sum + Number(r.amount), 0);

  const run = async (action: () => Promise<void>, done: () => void) => {
    setBusy(true); setFormError('');
    try { await action(); done(); refresh(); }
    catch (e) { setFormError(e instanceof Error ? e.message : 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  };
  const upload = async (file: File | undefined, apply: (name: string, label: string) => void) => {
    if (!file) return;
    setFormError('');
    try { apply(await api.upload(file), file.name); } catch (e) { setFormError(e instanceof Error ? e.message : 'Lampiran gagal diunggah.'); }
  };

  const editor = (draft: Draft, change: (patch: Partial<Draft>) => void, index?: number) => <div className="fn-entry-row" key={draft.key}>
    <label>Klasifikasi<select className="hd-input" value={draft.group} onChange={e => change({ group: e.target.value, accountCode: '' })}><option value="">Pilih klasifikasi</option>{groups.map(g => <option key={g.code} value={g.code}>{g.code} – {g.name}</option>)}</select></label>
    <label>Kode biaya<select className="hd-input" value={draft.accountCode} disabled={!draft.group} onChange={e => change({ accountCode: e.target.value })}><option value="">{draft.group ? 'Pilih kode' : 'Pilih klasifikasi dulu'}</option>{codesOf(draft.group).map(a => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></label>
    <label>Unit/Outlet<select className="hd-input" value={draft.unit} onChange={e => change({ unit: e.target.value })}><option value="">Pilih unit</option><option value="WAREHOUSE">Warehouse (gudang pusat)</option>{activeOutlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    <label>Tanggal<input className="hd-input" type="date" value={draft.date} onChange={e => change({ date: e.target.value })} /></label>
    <label>Nominal (Rp)<input className="hd-input" inputMode="decimal" placeholder="300.000" value={draft.amountText} aria-invalid={!!draft.amountText && !parseRupiah(draft.amountText)} onChange={e => change({ amountText: e.target.value })} />{draft.amountText && <small className="fn-muted">{parseRupiah(draft.amountText) ? formatMoney(Number(parseRupiah(draft.amountText)).toFixed(6)) : 'Tulis angka Rupiah, contoh 300.000'}</small>}</label>
    <label className="fn-entry-notes">Keterangan<input className="hd-input" maxLength={500} placeholder="Listrik bulan November" value={draft.notes} onChange={e => change({ notes: e.target.value })} /></label>
    <label>Lampiran (opsional)<input className="hd-input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files?.[0], (name, label) => change({ attachment: name, attachmentName: label }))} />{draft.attachment && <small className="fn-muted"><Paperclip size={12} /> {draft.attachmentName || 'Lampiran tersimpan'} <button type="button" className="fn-link" onClick={() => change({ attachment: null, attachmentName: '' })}>hapus</button></small>}</label>
    {index !== undefined && <Button aria-label={`Hapus baris ${index + 1}`} disabled={(adding?.length ?? 0) <= 1} onClick={() => setAdding(list => list!.filter(d => d.key !== draft.key))}><Trash2 size={14} /></Button>}
  </div>;

  const problems = adding?.map(draftProblem) ?? [];
  return <>
    <div className="fn-entry-toolbar">
      <button type="button" className="fn-entry-toggle" aria-expanded={listOpen} aria-controls={listId} onClick={toggleList}>
        <ChevronDown size={16} className="fn-entry-chevron" aria-hidden />
        <span>{listOpen ? 'Sembunyikan daftar entri' : 'Tampilkan daftar entri'}</span>
        <span className="fn-muted">{error ? 'gagal dimuat' : loading || !loaded ? 'memuat…' : `${shown.length} entri · ${formatMoney(total.toFixed(6))}`}</span>
      </button>
      <div className="fn-actions">{canEdit ? <Button variant="primary" disabled={!accounts?.persistenceEnabled} onClick={() => { setFormError(''); setBatchKey(newKey()); setAdding([blank()]); }}><Plus size={14} />Input biaya</Button> : <span className="fn-muted">Input hanya untuk role Finance.</span>}</div>
    </div>
    <div id={listId} hidden={!listOpen}>
    <div className="fn-transaction-filters">
      <label>Unit/Outlet<select className="hd-input" value={unitFilter} onChange={e => setUnitFilter(e.target.value)}><option value="">Semua unit</option><option value="WAREHOUSE">Warehouse</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>Klasifikasi<select className="hd-input" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}><option value="">Semua klasifikasi</option>{groups.map(g => <option key={g.code} value={g.code}>{g.code} – {g.name}</option>)}</select></label>
    </div>
    {error && <StateMessage kind="error">{error}</StateMessage>}
    <div className="fn-table-wrap"><table className="fn-table"><thead><tr>{['Tanggal', 'Unit', 'Kode', 'Nominal', 'Keterangan', 'Sumber', ''].map((s, i) => <th key={i} className={s === 'Nominal' ? 'fn-right' : undefined}>{s}</th>)}</tr></thead><tbody>
      {shown.map(r => <tr key={r.id}>
        <td>{r.date}</td><td>{unitLabel(r.unit, outlets)}</td><td>{r.accountCode} <span className="fn-muted">{nameOf(r.accountCode)}</span></td>
        <td className="fn-money">{formatMoney(r.amount)}</td>
        <td className="fn-wrap">{r.notes}{r.status === 'draft' && <span className="fn-status fn-status--missing"> draft</span>}{r.attachment && <> <a href={attachmentUrl(r.attachment)} target="_blank" rel="noreferrer" aria-label="Lihat lampiran"><Paperclip size={13} /></a></>}</td>
        <td>{r.source === 'hdoutlet' ? <span className="fn-source fn-source--hd">HD Outlet API</span> : r.source === 'hdattendance' ? <span className="fn-source fn-source--hd">HD Attendance API</span> : <span className="fn-source">Finance manual</span>}</td>
        <td>{r.source === 'manual' && canEdit ? <div className="fn-actions"><Button variant="ghost" aria-label="Edit" onClick={() => { setFormError(''); setEditing({ row: r, reason: '', draft: { key: r.id, group: groupOf(r.accountCode), accountCode: r.accountCode, unit: unitValue(r.unit), date: r.date, amountText: String(Number(r.amount)).replace('.', ','), notes: r.notes, attachment: r.attachment, attachmentName: '' } }); }}><Pencil size={14} /></Button><Button variant="ghost" aria-label="Hapus" onClick={() => { setFormError(''); setRemoving({ row: r, reason: '' }); }}><Trash2 size={14} /></Button></div> : r.source === 'hdoutlet' ? <span className="fn-muted" title="Koreksi di HD Outlet lalu sinkron ulang">dikunci</span> : null}</td>
      </tr>)}
    </tbody>{shown.length > 0 && <tfoot><tr><th colSpan={3}>Total ({shown.length} entri)</th><td className="fn-money">{formatMoney(total.toFixed(6))}</td><td colSpan={3} /></tr></tfoot>}</table></div>
    {!loading && !error && !shown.length && <StateMessage>Belum ada entri pada filter ini.</StateMessage>}
    </div>

    {adding && <Modal wide title="Input biaya" onClose={() => setAdding(null)}>
      <p className="fn-muted">Pilih klasifikasi dulu, lalu kode biaya, unit, tanggal, nominal, dan keterangan. Tambah baris untuk menyimpan beberapa entri sekaligus.</p>
      {adding.map((draft, index) => <div key={draft.key} className="fn-entry-block"><strong className="fn-muted">Baris {index + 1}{problems[index] && draft.amountText + draft.notes + draft.accountCode ? ` · ${problems[index]}` : ''}</strong>{editor(draft, patch => setAdding(list => list!.map(d => d.key === draft.key ? { ...d, ...patch } : d)), index)}</div>)}
      {formError && <p role="alert" className="fn-error">{formError}</p>}
      <div className="fn-actions"><Button onClick={() => setAdding(list => [...list!, { ...blank(), group: list![list!.length - 1].group, unit: list![list!.length - 1].unit, date: list![list!.length - 1].date }])}><Plus size={14} />Tambah baris</Button>
        <Button variant="primary" disabled={busy || problems.some(Boolean)} onClick={() => run(() => api.saveBatch(adding.map(toEntryRow), batchKey), () => setAdding(null))}>{busy ? 'Menyimpan…' : `Simpan ${adding.length} entri`}</Button></div>
    </Modal>}

    {editing && <Modal wide title="Edit entri" onClose={() => setEditing(null)}>
      {editor(editing.draft, patch => setEditing(e => e && ({ ...e, draft: { ...e.draft, ...patch } })))}
      <label className="fn-block">Alasan perubahan (opsional)<input className="hd-input" maxLength={500} value={editing.reason} onChange={e => setEditing(x => x && ({ ...x, reason: e.target.value }))} /></label>
      {formError && <p role="alert" className="fn-error">{formError}</p>}
      <div className="fn-actions"><Button variant="primary" disabled={busy || !!draftProblem(editing.draft)} onClick={() => run(() => api.update(editing.row.id, toEntryRow(editing.draft), editing.row.version, editing.reason), () => setEditing(null))}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</Button><Button onClick={() => setEditing(null)}>Batal</Button></div>
    </Modal>}

    {removing && <Modal title="Hapus entri" onClose={() => setRemoving(null)}>
      <p>{removing.row.date} · {unitLabel(removing.row.unit, outlets)} · {removing.row.accountCode} {nameOf(removing.row.accountCode)} · <strong>{formatMoney(removing.row.amount)}</strong></p>
      <p className="fn-muted">Entri keluar dari laporan. Data dan riwayatnya tetap tersimpan di activity log.</p>
      <label className="fn-block">Alasan hapus (wajib)<input className="hd-input" maxLength={500} value={removing.reason} onChange={e => setRemoving(x => x && ({ ...x, reason: e.target.value }))} /></label>
      {formError && <p role="alert" className="fn-error">{formError}</p>}
      <div className="fn-actions"><Button variant="primary" disabled={busy || !removing.reason.trim()} onClick={() => run(() => api.remove(removing.row.id, removing.row.version, removing.reason), () => setRemoving(null))}>{busy ? 'Menghapus…' : 'Hapus'}</Button><Button onClick={() => setRemoving(null)}>Batal</Button></div>
    </Modal>}
  </>;
}
