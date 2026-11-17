import React, { useState, useEffect } from 'react';
import type { Accounts, Filter } from './model.ts';
import { formatMoney, reportQuery } from './model.ts';
import type { TransactionRecord } from '../../../backend/src/finance/transactionPlan.ts';
import { validateTransaction } from '../../../backend/src/finance/validation.ts';
import { Modal } from './components.tsx';
import { Button } from '../components/common/UI.tsx';
import { parseRupiah, STATUS_LABEL, unitName } from './ledgerInput.ts';

export interface TransactionGateway {
  list(filter: Filter): Promise<TransactionRecord[]>;
  create(input: Record<string, unknown>): Promise<TransactionRecord>;
  change(id: string, action: 'post' | 'void', version: number, reason: string): Promise<void>;
}
type Outlet = { id: number; name: string; isActive?: boolean };
type Pending = { row: TransactionRecord; action: 'post' | 'void' };

// Costs Finance enters per unit: Distribution Cost (LC..TX) or DA. Saved as a
// draft; only Posted entries count in the report. A posted entry is never
// edited: it is voided (with a reason) and entered again.
export function TransactionManager({ da, accounts, outlets, filter, gateway, onChanged }: { da: boolean; accounts: Accounts | null; outlets: Outlet[]; filter: Filter; gateway?: TransactionGateway; onChanged?: () => void }) {
  const [open, setOpen] = useState(false), [rows, setRows] = useState<TransactionRecord[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [status, setStatus] = useState(''), [code, setCode] = useState(''), [pending, setPending] = useState<Pending | null>(null), [reason, setReason] = useState('');
  const [amountText, setAmountText] = useState(''), [key, setKey] = useState('');
  const groups = da ? ['DA01', 'DA02'] : ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX'];
  const codes = accounts?.accounts.filter(a => groups.includes(a.group)) ?? [];
  const accountName = (accountCode: string) => codes.find(a => a.code === accountCode)?.name ?? '';
  const amount = parseRupiah(amountText);
  const filterKey = reportQuery(filter);
  useEffect(() => {
    let active = true; setRows([]); setError('');
    if (gateway) gateway.list(filter).then(list => { if (active) setRows(list); }).catch(() => { if (active) setError('Daftar transaksi gagal dimuat.'); });
    return () => { active = false; };
  }, [gateway, filterKey, revision]);
  const refresh = () => { setRevision(v => v + 1); onChanged?.(); };
  const shown = rows.filter(r => codes.some(a => a.code === r.accountCode) && (!code || r.accountCode === code) && (!status || r.status === status));
  const postedTotal = shown.filter(r => r.status === 'posted').reduce((sum, r) => sum + Number(r.amount), 0);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!gateway || !amount) return;
    const postNow = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'post';
    const form = new FormData(event.currentTarget), unit = String(form.get('unit'));
    const input = { date: String(form.get('date')), unit: unit === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: Number(unit) }, accountCode: String(form.get('accountCode')), amount, notes: String(form.get('notes')), reference: String(form.get('reference')), status: 'draft', nature: 'EXTERNAL', idempotencyKey: key };
    setBusy(true); setError('');
    try {
      const created = await gateway.create(input);
      if (postNow) await gateway.change(created.id, 'post', created.version, 'Langsung diposting saat input');
      setOpen(false); setAmountText(''); refresh();
    } catch { setError('Transaksi gagal disimpan. Periksa isian; outlet harus aktif.'); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!gateway || !pending || !reason.trim()) return;
    setBusy(true); setError('');
    try { await gateway.change(pending.row.id, pending.action, pending.row.version, reason.trim()); setPending(null); setReason(''); refresh(); }
    catch { setError('Perubahan ditolak. Data mungkin sudah diubah orang lain; muat ulang lalu coba lagi.'); }
    finally { setBusy(false); }
  };

  return <>
    <div className="fn-actions"><Button onClick={() => { setKey(crypto.randomUUID()); setError(''); setAmountText(''); setOpen(true); }}>Tambah Transaksi</Button></div>
    {!gateway && <p>Persistence transaksi belum diaktifkan. Form dapat dibuka; penyimpanan menunggu persetujuan schema dan layanan transaksi.</p>}
    {error && !open && !pending && <p role="alert">{error}</p>}
    <div className="fn-transaction-filters">
      <label>Kode akun<select className="hd-input" value={code} onChange={e => setCode(e.target.value)}><option value="">Semua kode</option>{codes.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label>
      <label>Status<select className="hd-input" value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{['draft', 'posted', 'void'].map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
    </div>
    <div className="fn-table-wrap"><table className="fn-table"><thead><tr>{['Tanggal', 'Unit', 'Akun', 'Nominal', 'Catatan / bukti', 'Status', 'Aksi'].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>
      {shown.map(r => <tr key={r.id} className={r.status === 'void' ? 'fn-row-void' : undefined}>
        <td>{r.date}</td><td>{unitName(r.unit, outlets)}</td><td>{r.accountCode} <span className="fn-muted">{accountName(r.accountCode)}</span></td>
        <td className="fn-money">{formatMoney(r.amount)}</td><td>{r.notes} · {r.reference}</td><td>{STATUS_LABEL[r.status]}</td>
        <td>{r.status !== 'void' && <Button disabled={busy || !gateway} onClick={() => { setReason(''); setError(''); setPending({ row: r, action: r.status === 'draft' ? 'post' : 'void' }); }}>{r.status === 'draft' ? 'Posting' : 'Void'}</Button>}</td>
      </tr>)}
    </tbody>{shown.some(r => r.status === 'posted') && <tfoot><tr><th colSpan={3}>Total posted</th><td className="fn-money">{formatMoney(postedTotal.toFixed(6))}</td><td colSpan={3} /></tr></tfoot>}</table></div>
    {gateway && !shown.length && <p>Tidak ada transaksi pada filter ini.</p>}

    {pending && <Modal title={pending.action === 'post' ? 'Posting transaksi' : 'Void transaksi'} onClose={() => setPending(null)}>
      <p>{unitName(pending.row.unit, outlets)} · {pending.row.accountCode} {accountName(pending.row.accountCode)} · {formatMoney(pending.row.amount)} · {pending.row.date}</p>
      <p className="fn-muted">{pending.action === 'post' ? 'Setelah diposting, transaksi masuk ke laporan dan tidak bisa diubah; koreksi dilakukan dengan void lalu input ulang.' : 'Transaksi yang di-void keluar dari laporan. Riwayat dan alasannya tetap tersimpan.'}</p>
      {error && <p role="alert">{error}</p>}
      <label>Alasan (wajib, tercatat di audit)<textarea className="hd-input" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="fn-actions"><Button disabled={busy || !reason.trim()} onClick={confirm}>{busy ? 'Menyimpan…' : pending.action === 'post' ? 'Posting' : 'Void'}</Button><Button onClick={() => setPending(null)}>Batal</Button></div>
    </Modal>}

    {open && <Modal title={`Tambah Transaksi ${da ? 'DA' : 'DC'}`} onClose={() => setOpen(false)}>
      <form className="fn-form" onSubmit={submit}>
        {error && <p role="alert">{error}</p>}
        <label>Tanggal<input className="hd-input" name="date" type="date" required defaultValue={filter.endDate} /></label>
        <label>Unit / outlet<select className="hd-input" name="unit" defaultValue={filter.outletIds?.length === 1 ? String(filter.outletIds[0]) : 'WAREHOUSE'}><option value="WAREHOUSE">Warehouse</option>{outlets.filter(o => o.isActive !== false).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Kode akun<select className="hd-input" name="accountCode" required><option value="">Pilih akun</option>{codes.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label>
        <label>Nominal (Rp)<input className="hd-input" name="amount" inputMode="decimal" required placeholder="Contoh: 3.500.000" value={amountText} onChange={e => setAmountText(e.target.value)} aria-invalid={!!amountText && !amount} /></label>
        {amountText && <p className="fn-muted">{amount ? `Tercatat: ${formatMoney(Number(amount).toFixed(6))}` : 'Nominal tidak valid. Tulis angka Rupiah, contoh 3.500.000 atau 1.250,50.'}</p>}
        <label>Catatan<input className="hd-input" name="notes" required maxLength={500} placeholder="Contoh: Gaji karyawan November" /></label>
        <label>Bukti / referensi<input className="hd-input" name="reference" required maxLength={255} placeholder="Contoh: nomor slip / invoice" /></label>
        <p className="fn-muted">Hanya transaksi berstatus Posted yang masuk laporan.</p>
        <div className="fn-actions">
          <Button type="submit" value="draft" disabled={!gateway || busy || !amount}>{busy ? 'Menyimpan…' : 'Simpan Draft'}</Button>
          <Button type="submit" value="post" disabled={!gateway || busy || !amount}>Simpan & Posting</Button>
        </div>
      </form>
    </Modal>}
  </>;
}

export function createTransactionGateway(request: typeof fetch = fetch): TransactionGateway {
  async function call(path: string, body?: unknown) {
    const response = await request(`/api/finance/v2/transactions${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('Transaction service rejected request');
    return response.json();
  }
  const record = (row: any): TransactionRecord => {
    if (!row || typeof row.id !== 'string' || !row.id) throw new Error('Invalid transaction identity');
    return { ...validateTransaction(row), id: row.id };
  };
  return {
    async list(filter) { const body = await call(`?${reportQuery(filter)}`); if (!Array.isArray(body.transactions)) throw new Error('Invalid transaction list'); return body.transactions.map(record); },
    async create(input) { return record((await call('', input)).transaction); },
    async change(id, action, version, reason) { await call(`/${encodeURIComponent(id)}/${action}`, { version, reason }); },
  };
}
