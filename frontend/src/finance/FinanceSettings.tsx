import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button, StateMessage } from '../components/common/UI.tsx';
import { Panel, Status } from './components.tsx';
import { financeGet, financeWrite } from './api.ts';
import { formatMoney, type Accounts, type Filter, type OutletOption } from './model.ts';

// Shape of GET /api/finance/v2/manage/hdoutlet (backend hdOutletOverview).
export type HdOutletOverview = {
  config: { enabled: boolean; host: string | null; keyConfigured: boolean; syncHour: number; syncDays: number };
  outlets: { hdOutletId: number; hdOutletName: string; outletId: number | null; outletName: string | null; matchedBy: 'auto' | 'finance' | null; reportCount: number }[];
  expenses: { key: string; name: string; status: 'pending' | 'mapped' | 'ignored'; accountCode: string | null; reportCount: number; amount: string }[];
  unmappedReports: { name: string; count: number }[];
  runs: { id: number; triggerType: string; startDate: string | null; endDate: string | null; startedAt: string; finishedAt: string | null; status: string; reportsFetched: number; created: number; updated: number; voided: number; skippedClosed: number; message: string | null }[];
};
const MANAGE = '/api/finance/v2/manage';
const time = (iso: string | null) => iso ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';
const RUN_STATUS: Record<string, string> = { success: 'Available', partial: 'Partial', failed: 'Missing', running: 'Partial' };
const TRIGGER: Record<string, string> = { manual: 'Sinkron sekarang', schedule: 'Terjadwal', mapping: 'Ubah mapping' };

// HD Outlet integration: status, "Sinkron sekarang" for the active period, sync
// log, outlet mapping (HD Outlet ↔ Warehouse) and the expense queue
// "Belum dipetakan" where Finance picks a cost code.
export function HdOutletSettings({ filter, accounts, outlets, onChanged }: { filter: Filter; accounts: Accounts | null; outlets: OutletOption[]; onChanged: () => void }) {
  const [data, setData] = useState<HdOutletOverview | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; financeGet(`${MANAGE}/hdoutlet`).then(d => { if (active) { setData(d); setError(''); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [revision]);
  const act = async (label: string, action: () => Promise<any>, describe: (result: any) => string) => {
    setBusy(label); setMessage(''); setError('');
    try { const result = await action(); setMessage(describe(result)); setRevision(v => v + 1); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal.'); }
    finally { setBusy(''); }
  };
  const dcCodes = (accounts?.accounts ?? []).filter(a => a.isActive && a.classCode === 'DC');
  const pending = data?.expenses.filter(e => e.status === 'pending') ?? [];
  const sync = () => act('sync', () => financeWrite(`${MANAGE}/hdoutlet/sync`, 'POST', { startDate: filter.startDate, endDate: filter.endDate }).catch(e => { throw e; }), r =>
    `Sinkron ${r.status === 'success' ? 'berhasil' : r.status === 'partial' ? 'selesai sebagian' : 'gagal'}: ${r.reportsFetched} laporan · ${r.created} entri baru · ${r.updated} diperbarui · ${r.voided} dihapus.${r.messages?.length ? ' ' + r.messages.join(' ') : ''}`);
  const applied = (r: any) => `Mapping disimpan. ${r.created} entri baru, ${r.updated} diperbarui, ${r.voided} dihapus dari laporan yang sudah tersinkron.${r.messages?.length ? ' ' + r.messages.join(' ') : ''}`;

  return <>
    <Panel title="Integrasi HD Outlet" action={<div className="fn-actions"><Button onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} />Muat ulang</Button><Button variant="primary" disabled={!!busy || !data?.config.enabled} onClick={sync}>{busy === 'sync' ? 'Menyinkron…' : `Sinkron sekarang (${filter.startDate} — ${filter.endDate})`}</Button></div>}>
      {error && <div className="fn-section-note"><StateMessage kind="error">{error}</StateMessage></div>}
      {message && <p className="fn-section-note" role="status">{message}</p>}
      {data && <div className="fn-section-note"><dl className="fn-definition">
        <dt>Status</dt><dd><Status value={data.config.enabled ? 'Available' : 'Missing'} /> {data.config.enabled ? 'Aktif' : 'Nonaktif (OUTLET_FINANCE_API_ENABLED bukan true di .env backend)'}</dd>
        <dt>Server</dt><dd>{data.config.host ?? '— (OUTLET_FINANCE_API_BASE_URL belum diisi)'}</dd>
        <dt>API key</dt><dd>{data.config.keyConfigured ? 'Tersimpan di .env backend' : 'Belum diisi (OUTLET_FINANCE_API_TOKEN)'}</dd>
        <dt>Jadwal</dt><dd>Otomatis tiap malam pukul {String(data.config.syncHour).padStart(2, '0')}:00 WIB untuk {data.config.syncDays} hari terakhir</dd>
        <dt>Sinkron terakhir</dt><dd>{data.runs.find(r => r.triggerType !== 'mapping') ? `${time(data.runs.find(r => r.triggerType !== 'mapping')!.finishedAt)} · ${data.runs.find(r => r.triggerType !== 'mapping')!.status}` : 'Belum pernah'}</dd>
      </dl><p className="fn-muted">Data dari HD Outlet tidak dapat diedit di sini. Koreksi dilakukan di HD Outlet, lalu sinkron ulang. Sinkron ulang memperbarui data yang sama, tidak membuat data dobel.</p></div>}
      {!data && !error && <p className="fn-section-note">Memuat…</p>}
    </Panel>

    {data && <Panel title={`Pengeluaran belum dipetakan (${pending.length})`}>
      <p className="fn-section-note">Pengeluaran laporan harian yang belum punya kode biaya belum dihitung ke Distribution Cost. Pilih kodenya; laporan yang sudah tersinkron langsung dihitung ulang.</p>
      <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Pengeluaran HD Outlet</th><th>Status</th><th className="fn-right">Nilai tersinkron</th><th>Kode biaya</th><th></th></tr></thead><tbody>
        {data.expenses.map(e => <ExpenseRow key={e.key} expense={e} codes={dcCodes} busy={!!busy} onSave={(status, accountCode) => act(`exp:${e.key}`, () => financeWrite(`${MANAGE}/hdoutlet/expenses/${encodeURIComponent(e.key)}`, 'PUT', { status, accountCode }), applied)} />)}
      </tbody></table></div>
    </Panel>}

    {data && <Panel title="Mapping outlet HD Outlet ↔ Warehouse">
      <p className="fn-section-note">Laporan outlet HD Outlet hanya dihitung setelah dipasangkan dengan outlet Warehouse. Pasangan bertanda <em>otomatis</em> dibuat dari nama yang persis sama — mohon dicek. Beberapa outlet HD Outlet boleh dipetakan ke satu outlet Warehouse (misalnya CSK 1 dan CSK 2 ke Cisalak); angkanya dijumlahkan.</p>
      {data.unmappedReports.length > 0 && <p className="fn-section-note fn-error">Laporan yang belum dihitung karena outletnya belum dipetakan: {data.unmappedReports.map(r => `${r.name} (${r.count})`).join(', ')}.</p>}
      <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Outlet HD Outlet</th><th className="fn-right">Laporan</th><th>Outlet Warehouse</th><th>Keterangan</th></tr></thead><tbody>
        {data.outlets.map(o => <tr key={o.hdOutletId}><td>{o.hdOutletName}</td><td className="fn-right">{o.reportCount}</td>
          <td><select className="hd-input" value={o.outletId ?? ''} disabled={!!busy} onChange={e => act(`out:${o.hdOutletId}`, () => financeWrite(`${MANAGE}/hdoutlet/outlets/${o.hdOutletId}`, 'PUT', { outletId: e.target.value ? Number(e.target.value) : null }), applied)}>
            <option value="">— Belum dipetakan —</option>{outlets.filter(x => x.isActive !== false || x.id === o.outletId).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
          <td>{o.outletId == null ? <Status value="Missing" /> : o.matchedBy === 'auto' ? <span className="fn-muted">otomatis (nama sama) — cek</span> : <span className="fn-muted">dipilih Finance</span>}<MergedWith names={data.outlets.filter(x => x.outletId === o.outletId && x.hdOutletId !== o.hdOutletId).map(x => x.hdOutletName)} show={o.outletId != null} /></td></tr>)}
        {!data.outlets.length && <tr><td colSpan={4}>Belum ada outlet dari HD Outlet. Jalankan sinkron pertama.</td></tr>}
      </tbody></table></div>
    </Panel>}

    {data && <Panel title="Log sinkron">
      <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Waktu</th><th>Pemicu</th><th>Periode</th><th>Status</th><th className="fn-right">Laporan</th><th className="fn-right">Baru / ubah / hapus</th><th>Pesan</th></tr></thead><tbody>
        {data.runs.map(r => <tr key={r.id}><td>{time(r.startedAt)}</td><td>{TRIGGER[r.triggerType] ?? r.triggerType}</td><td>{r.startDate ? `${r.startDate} — ${r.endDate}` : '—'}</td><td><Status value={RUN_STATUS[r.status] ?? 'Missing'} /> {r.status}</td><td className="fn-right">{r.reportsFetched}</td><td className="fn-right">{r.created} / {r.updated} / {r.voided}</td><td className="fn-wrap">{r.message ?? ''}</td></tr>)}
        {!data.runs.length && <tr><td colSpan={7}>Belum ada sinkron.</td></tr>}
      </tbody></table></div>
    </Panel>}
  </>;
}

// Shape of GET /api/finance/v2/manage/hdattendance (backend hdAttendanceOverview).
export type HdAttendanceOverview = {
  config: { enabled: boolean; host: string | null; keyConfigured: boolean; syncHour: number; syncDays: number; account: string };
  outlets: { hdaOutletId: number; hdaOutletName: string; outletId: number | null; outletName: string | null; matchedBy: 'auto' | 'finance' | null; recordCount: number }[];
  runs: { id: number; triggerType: string; startDate: string | null; endDate: string | null; startedAt: string; finishedAt: string | null; status: string; recordsFetched: number; created: number; updated: number; voided: number; skippedClosed: number; message: string | null }[];
};

// HD Attendance integration: salary (LC01) per outlet per day = attendance
// "present" × daily wage of the employee's position. Status, "Sinkron
// sekarang", outlet mapping and sync log.
export function HdAttendanceSettings({ filter, outlets, onChanged }: { filter: Filter; outlets: OutletOption[]; onChanged: () => void }) {
  const [data, setData] = useState<HdAttendanceOverview | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; financeGet(`${MANAGE}/hdattendance`).then(d => { if (active) { setData(d); setError(''); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [revision]);
  const act = async (label: string, action: () => Promise<any>, describe: (result: any) => string) => {
    setBusy(label); setMessage(''); setError('');
    try { const result = await action(); setMessage(describe(result)); setRevision(v => v + 1); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal.'); }
    finally { setBusy(''); }
  };
  const sync = () => act('sync', () => financeWrite(`${MANAGE}/hdattendance/sync`, 'POST', { startDate: filter.startDate, endDate: filter.endDate }), r =>
    `Sinkron ${r.status === 'success' ? 'berhasil' : r.status === 'partial' ? 'selesai sebagian' : 'gagal'}: ${r.recordsFetched} absensi · ${r.created} entri gaji baru · ${r.updated} diperbarui · ${r.voided} dihapus.${r.messages?.length ? ' ' + r.messages.join(' ') : ''}`);
  const applied = (r: any) => `Mapping disimpan. ${r.created} entri gaji baru, ${r.updated} diperbarui, ${r.voided} dihapus.${r.messages?.length ? ' ' + r.messages.join(' ') : ''}`;
  const last = data?.runs.find(r => r.triggerType !== 'mapping');

  return <>
    <Panel title="Integrasi HD Attendance (gaji)" action={<div className="fn-actions"><Button onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} />Muat ulang</Button><Button variant="primary" disabled={!!busy || !data?.config.enabled} onClick={sync}>{busy === 'sync' ? 'Menyinkron…' : `Sinkron sekarang (${filter.startDate} — ${filter.endDate})`}</Button></div>}>
      {error && <div className="fn-section-note"><StateMessage kind="error">{error}</StateMessage></div>}
      {message && <p className="fn-section-note" role="status">{message}</p>}
      {data && <div className="fn-section-note"><dl className="fn-definition">
        <dt>Status</dt><dd><Status value={data.config.enabled ? 'Available' : 'Missing'} /> {data.config.enabled ? 'Aktif' : 'Nonaktif (HDATTENDANCE_API_ENABLED bukan true di .env backend)'}</dd>
        <dt>Server</dt><dd>{data.config.host ?? '— (HDATTENDANCE_API_BASE_URL belum diisi)'}</dd>
        <dt>API key</dt><dd>{data.config.keyConfigured ? 'Tersimpan di .env backend' : 'Belum diisi (HDATTENDANCE_API_KEY)'}</dd>
        <dt>Perhitungan</dt><dd>{data.config.account} Salary per outlet per hari = jumlah absensi “present” × upah harian posisi karyawan (juga yang belum check-out)</dd>
        <dt>Jadwal</dt><dd>Otomatis tiap malam pukul {String(data.config.syncHour).padStart(2, '0')}:00 WIB untuk {data.config.syncDays} hari terakhir</dd>
        <dt>Sinkron terakhir</dt><dd>{last ? `${time(last.finishedAt)} · ${last.status}` : 'Belum pernah'}</dd>
      </dl><p className="fn-muted">Gaji dari HD Attendance tidak dapat diedit di sini. Koreksi absensi atau posisi/upah di HD Attendance, lalu sinkron ulang. Sinkron ulang memperbarui gaji hari yang sama, tidak membuat data dobel.</p></div>}
      {!data && !error && <p className="fn-section-note">Memuat…</p>}
    </Panel>

    {data && <Panel title="Mapping outlet HD Attendance ↔ Warehouse">
      <p className="fn-section-note">Gaji outlet HD Attendance hanya dihitung setelah dipasangkan dengan outlet Warehouse. Pasangan bertanda <em>otomatis</em> dibuat dari nama yang sama (atau dari mapping HD Outlet dengan nama yang sama) — mohon dicek.</p>
      <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Outlet HD Attendance</th><th className="fn-right">Absensi</th><th>Outlet Warehouse</th><th>Keterangan</th></tr></thead><tbody>
        {data.outlets.map(o => <tr key={o.hdaOutletId}><td>{o.hdaOutletName}</td><td className="fn-right">{o.recordCount}</td>
          <td><select className="hd-input" value={o.outletId ?? ''} disabled={!!busy} onChange={e => act(`out:${o.hdaOutletId}`, () => financeWrite(`${MANAGE}/hdattendance/outlets/${o.hdaOutletId}`, 'PUT', { outletId: e.target.value ? Number(e.target.value) : null }), applied)}>
            <option value="">— Belum dipetakan —</option>{outlets.filter(x => x.isActive !== false || x.id === o.outletId).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
          <td>{o.outletId == null ? <Status value="Missing" /> : o.matchedBy === 'auto' ? <span className="fn-muted">otomatis — cek</span> : <span className="fn-muted">dipilih Finance</span>}<MergedWith names={data.outlets.filter(x => x.outletId === o.outletId && x.hdaOutletId !== o.hdaOutletId).map(x => x.hdaOutletName)} show={o.outletId != null} /></td></tr>)}
        {!data.outlets.length && <tr><td colSpan={4}>Belum ada outlet dari HD Attendance. Jalankan sinkron pertama.</td></tr>}
      </tbody></table></div>
    </Panel>}

    {data && <Panel title="Log sinkron HD Attendance">
      <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Waktu</th><th>Pemicu</th><th>Periode</th><th>Status</th><th className="fn-right">Absensi</th><th className="fn-right">Baru / ubah / hapus</th><th>Pesan</th></tr></thead><tbody>
        {data.runs.map(r => <tr key={r.id}><td>{time(r.startedAt)}</td><td>{TRIGGER[r.triggerType] ?? r.triggerType}</td><td>{r.startDate ? `${r.startDate} — ${r.endDate}` : '—'}</td><td><Status value={RUN_STATUS[r.status] ?? 'Missing'} /> {r.status}</td><td className="fn-right">{r.recordsFetched}</td><td className="fn-right">{r.created} / {r.updated} / {r.voided}</td><td className="fn-wrap">{r.message ?? ''}</td></tr>)}
        {!data.runs.length && <tr><td colSpan={7}>Belum ada sinkron.</td></tr>}
      </tbody></table></div>
    </Panel>}
  </>;
}

function ExpenseRow({ expense, codes, busy, onSave }: { expense: HdOutletOverview['expenses'][number]; codes: Accounts['accounts']; busy: boolean; onSave: (status: 'mapped' | 'ignored' | 'pending', accountCode: string | null) => void }) {
  const [code, setCode] = useState(expense.accountCode ?? '');
  useEffect(() => setCode(expense.accountCode ?? ''), [expense.accountCode]);
  return <tr><td>{expense.name} <span className="fn-muted">({expense.key})</span></td>
    <td>{expense.status === 'mapped' ? <Status value="Available" /> : expense.status === 'ignored' ? <span className="fn-muted">diabaikan</span> : <Status value="Partial" />}</td>
    <td className="fn-money">{formatMoney(expense.amount)} <span className="fn-muted">· {expense.reportCount} laporan</span></td>
    <td><select className="hd-input" value={code} disabled={busy} onChange={e => setCode(e.target.value)}><option value="">Pilih kode biaya</option>{codes.map(a => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></td>
    <td><div className="fn-actions"><Button disabled={busy || !code || (expense.status === 'mapped' && code === expense.accountCode)} onClick={() => onSave('mapped', code)}>Simpan</Button>{expense.status !== 'ignored' && <Button variant="ghost" disabled={busy} title="Bukan biaya (tidak dihitung)" onClick={() => onSave('ignored', null)}>Abaikan</Button>}</div></td></tr>;
}

// Chart of accounts (master kode biaya): add a code to a group, rename, (de)activate.
export function AccountSettings({ accounts, canEdit, onChanged }: { accounts: Accounts | null; canEdit: boolean; onChanged: () => void }) {
  const [form, setForm] = useState({ groupCode: '', code: '', name: '' }), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!accounts) return <Panel title="Master kode biaya"><p className="fn-section-note">Memuat…</p></Panel>;
  const extensible = accounts.groups.filter(g => g.extensible);
  const save = async (action: () => Promise<any>, after?: () => void) => {
    setBusy(true); setError('');
    try { await action(); after?.(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Gagal.'); } finally { setBusy(false); }
  };
  return <Panel title="Master kode biaya">
    {canEdit && <form className="fn-account-form" onSubmit={e => { e.preventDefault(); save(() => financeWrite(`${MANAGE}/accounts`, 'POST', form), () => setForm({ groupCode: form.groupCode, code: '', name: '' })); }}>
      <label>Klasifikasi<select className="hd-input" value={form.groupCode} onChange={e => setForm({ ...form, groupCode: e.target.value })}><option value="">Pilih</option>{extensible.map(g => <option key={g.code} value={g.code}>{g.code} – {g.name}</option>)}</select></label>
      <label>Kode baru<input className="hd-input" placeholder={form.groupCode ? `${form.groupCode}07` : 'LC07'} value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
      <label>Nama<input className="hd-input" maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <Button type="submit" disabled={busy || !form.groupCode || !form.code || !form.name.trim()}><Plus size={14} />Tambah kode</Button>
    </form>}
    {error && <p className="fn-section-note fn-error" role="alert">{error}</p>}
    <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Kelas</th><th>Klasifikasi</th><th>Kode</th><th>Nama</th><th>Input</th><th>Status</th></tr></thead><tbody>
      {accounts.accounts.map(a => <tr key={a.code} className={a.isActive ? undefined : 'fn-row-void'}><td>{a.classCode}</td><td>{a.groupCode} – {a.groupName}</td><th scope="row">{a.code}</th><td>{a.name}</td>
        <td>{a.code === 'LC01' ? 'Finance manual + HD Attendance API' : a.manual ? 'Finance manual' : a.groupCode === 'SI' || a.groupCode === 'SH' ? 'HD Outlet API' : 'Warehouse'}</td>
        <td>{canEdit && a.manual ? <Button variant="ghost" disabled={busy} onClick={() => save(() => financeWrite(`${MANAGE}/accounts/${encodeURIComponent(a.code)}`, 'PATCH', { isActive: !a.isActive }))}>{a.isActive ? 'Aktif · nonaktifkan' : 'Nonaktif · aktifkan'}</Button> : a.isActive ? 'Aktif' : 'Nonaktif'}</td></tr>)}
    </tbody></table></div>
  </Panel>;
}

// Several source outlets may book into one Warehouse outlet (CSK 1 and CSK 2 into Cisalak).
function MergedWith({ names, show }: { names: string[]; show: boolean }) {
  if (!show || !names.length) return null;
  return <span className="fn-muted" style={{ display: 'block' }}>digabung dengan {names.join(', ')}</span>;
}
