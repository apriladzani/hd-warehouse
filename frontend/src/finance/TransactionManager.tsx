import React, { useState, useEffect } from 'react';
import type { Accounts, Filter } from './model.ts';
import { validateTransaction } from '../../../backend/src/finance/validation.ts';
import { formatMoney, unitLabel, reportQuery } from './model.ts';
import type { TransactionRecord } from '../../../backend/src/finance/transactionPlan.ts';
import { Modal } from './components.tsx';
import { Button } from '../components/common/UI.tsx';
export interface TransactionGateway {
  list(filter: Filter): Promise<TransactionRecord[]>;
  create(input: Record<string, unknown>): Promise<void>;
  change(id: string, action: 'post' | 'void', version: number, reason: string): Promise<void>;
}
// No localStorage ledger, browser-only persistence or mock fallback.
export function TransactionManager({ da, accounts, outlets, filter, gateway }: { da: boolean; accounts: Accounts | null; outlets: { id: number; name: string }[]; filter: Filter; gateway?: TransactionGateway }) {
  const [open, setOpen] = useState(false), [rows, setRows] = useState<TransactionRecord[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [status, setStatus] = useState(''), [code, setCode] = useState('');
  const groups = da ? ['DA01','DA02'] : ['LC','UC','MC','TC','AC','LP','TX'];
  const codes = accounts?.accounts.filter(a => groups.includes(a.group)) ?? [];
  useEffect(() => { let active = true; setRows([]); setError(''); if (gateway) gateway.list(filter).then(rows => { if (active) setRows(rows); }).catch(() => { if (active) setError('Daftar transaksi gagal dimuat.'); }); return () => { active = false; }; }, [gateway, filter, revision]);
  const [key, setKey] = useState('');
  return <><Button onClick={() => { setKey(crypto.randomUUID()); setError(''); setOpen(true); }}>Tambah Transaksi</Button>{!gateway && <p>Persistence transaksi belum diaktifkan. Form dapat dibuka; penyimpanan menunggu persetujuan schema dan layanan transaksi.</p>}{error && <p role="alert">{error}</p>}<label>Kode akun<select value={code} onChange={e => setCode(e.target.value)}><option value="">Semua kode</option>{codes.map(a => <option key={a.code}>{a.code}</option>)}</select></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{['draft','posted','void'].map(s => <option key={s}>{s}</option>)}</select></label><table className="fn-table"><thead><tr>{['Tanggal','Unit','Akun','Nominal','Catatan/bukti','Status','Aksi'].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{rows.filter(r => codes.some(a => a.code === r.accountCode) && (!code || r.accountCode === code) && (!status || r.status === status)).map(r => <tr key={r.id}><td>{r.date}</td><td>{unitLabel(r.unit)}</td><td>{r.accountCode}</td><td>{formatMoney(r.amount)}</td><td>{r.notes} · {r.reference}</td><td>{r.status}</td><td>{r.status !== 'void' && <Button disabled={busy} onClick={async () => { const reason = window.prompt('Alasan audit'); if (!reason?.trim() || !gateway) return; setBusy(true); try { await gateway.change(r.id, r.status === 'draft' ? 'post' : 'void', r.version, reason); setRevision(v => v + 1); } catch { setError('Perubahan ditolak. Muat ulang untuk memeriksa versi/status.'); } finally { setBusy(false); } }}>{r.status === 'draft' ? 'Post' : 'Void'}</Button>}</td></tr>)}</tbody></table>{gateway && !rows.length && <p>Tidak ada transaksi pada filter ini.</p>}{open && <Modal title={`Tambah Transaksi ${da ? 'DA' : 'DC'}`} onClose={() => setOpen(false)}><form className="fn-form" onSubmit={async e => {
    e.preventDefault(); if (!gateway) return;
    const form = new FormData(e.currentTarget), unit = String(form.get('unit'));
    const input = { date: String(form.get('date')), unit: unit === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: Number(unit) }, accountCode: String(form.get('accountCode')), amount: String(form.get('amount')), notes: String(form.get('notes')), reference: String(form.get('reference')), status: 'draft', nature: 'EXTERNAL', idempotencyKey: key };
    setBusy(true); setError(''); try { await gateway.create(input); setOpen(false); setRevision(v => v + 1); } catch { setError('Draft gagal disimpan. Periksa input; tidak ada angka pengganti yang dibuat.'); } finally { setBusy(false); }
  }}>{error && <p role="alert">{error}</p>}<label>Tanggal<input name="date" type="date" required defaultValue={filter.endDate} /></label><label>Unit/outlet<select name="unit"><option value="WAREHOUSE">Warehouse</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label>Kode akun<select name="accountCode" required><option value="">Pilih akun</option>{codes.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label><label>Nominal IDR (desimal titik, tanpa pemisah ribuan)<input name="amount" inputMode="decimal" required pattern="(?:0|[1-9][0-9]{0,17})(?:[.][0-9]{1,6})?" /></label><label>Catatan<input name="notes" required maxLength={500} /></label><label>Bukti/referensi<input name="reference" required maxLength={255} /></label><p>Disimpan sebagai Draft. Hanya Posted eksternal yang menjadi fakta ledger; kelengkapan laporan tetap mengikuti backend. Distribusi internal tidak menjadi DC.</p><Button type="submit" disabled={!gateway || busy}>{busy ? 'Menyimpan…' : 'Simpan Draft'}</Button></form></Modal>}</>;
}

// Prepared for a future explicitly enabled backend. Not used by production UI yet.
export function createTransactionGateway(request: typeof fetch = fetch): TransactionGateway {
  async function call(path: string, body?: unknown) {
    const response = await request(`/api/finance/v2/transactions${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('Transaction service rejected request');
    return response.json();
  }
  return {
    async list(filter) { const body = await call(`?${reportQuery(filter)}`); if (!Array.isArray(body.transactions)) throw new Error('Invalid transaction list'); return body.transactions.map((row: any) => { if (!row || typeof row.id !== 'string' || !row.id) throw new Error('Invalid transaction identity'); return { ...validateTransaction(row), id: row.id }; }); },
    async create(input) { await call('', input); },
    async change(id, action, version, reason) { await call(`/${encodeURIComponent(id)}/${action}`, { version, reason }); },
  };
}
