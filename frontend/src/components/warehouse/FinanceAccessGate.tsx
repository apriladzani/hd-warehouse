import React, { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { User } from '../../types.ts';

type AccessStatus = { configured: boolean; active: boolean; expiresIn: number };

export const FinanceAccessGate: React.FC<{ currentUser: User; onBack: () => void; children: ReactNode }> = ({ currentUser, onBack, children }) => {
  const credentials = currentUser as User & { password?: string };
  const authHeaders = { 'X-Auth-Email': currentUser.email, 'X-Auth-Password': credentials.password || '' };
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [expiresAt, setExpiresAt] = useState(0);

  const lock = useCallback((message = '') => {
    setStatus((previous) => previous ? { ...previous, active: false, expiresIn: 0 } : previous);
    setExpiresAt(0);
    setError(message);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/finance/access/status', { headers: authHeaders, credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal memeriksa akses Finance.');
      setStatus(data);
      setExpiresAt(data.active ? Date.now() + Number(data.expiresIn || 0) * 1000 : 0);
    } catch (reason) {
      setStatus({ configured: false, active: false, expiresIn: 0 });
      setError(reason instanceof Error ? reason.message : 'Gagal memeriksa akses Finance.');
    } finally { setLoading(false); }
  }, [currentUser.email, credentials.password]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => {
    const onRequired = () => lock('Sesi Finance berakhir. Masukkan password kembali.');
    window.addEventListener('finance-access-required', onRequired);
    return () => window.removeEventListener('finance-access-required', onRequired);
  }, [lock]);
  useEffect(() => {
    if (!status?.active) return;
    const check = async () => {
      try {
        const response = await fetch('/api/finance/access/status', { headers: authHeaders, credentials: 'same-origin' });
        const data = await response.json();
        if (!response.ok || !data.active) lock('Akses Finance berakhir atau telah dicabut. Masukkan password kembali.');
      } catch { lock('Sesi Finance tidak dapat diverifikasi. Masukkan password kembali.'); }
    };
    const timer = window.setInterval(() => { void check(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [status?.active, currentUser.email, credentials.password, lock]);
  useEffect(() => {
    if (!status?.active || !expiresAt) return;
    const timer = window.setTimeout(() => lock('Sesi Finance berakhir. Masukkan password kembali.'), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, status?.active, lock]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/finance/access/verify', {
        method: 'POST', credentials: 'same-origin',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Verifikasi password gagal.');
      setPassword('');
      setStatus((previous) => ({ ...(previous || {}), configured: true, active: true, expiresIn: Number(data.expiresIn || 900) }));
      setExpiresAt(Date.now() + Number(data.expiresIn || 900) * 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verifikasi password gagal.');
    } finally { setLoading(false); }
  };

  if (loading && !status) return <div className="hd-surface mx-auto max-w-md p-5 text-sm text-[#64748B]">Memeriksa akses Finance…</div>;
  if (status?.active) return <>{children}</>;

  return <section className="hd-finance-access hd-surface mx-auto w-full max-w-md p-4 sm:p-5" aria-labelledby="finance-access-heading">
    <div className="mb-3 flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-[#F0002B]"><LockKeyhole size={18} /></span>
      <div className="min-w-0"><h1 id="finance-access-heading" className="text-base font-semibold text-[#1E293B]">Finance Access</h1><p className="mt-0.5 text-xs text-[#64748B]">Masukkan password Finance untuk membuka dashboard. Akses berlaku selama 15 menit.</p></div>
    </div>
    {error && !status?.configured && <p role="alert" className="mb-3 text-xs text-rose-700">{error}</p>}
    {!status?.configured ? <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Password Finance belum dikonfigurasi. Minta Admin mengaturnya pada Finance Security.</div> : <form onSubmit={submit}>
      <label htmlFor="finance-access-password" className="mb-1 block text-xs font-medium text-[#334155]">Password Finance</label>
      <div className="relative">
        <input id="finance-access-password" type={visible ? 'text' : 'password'} autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} className="hd-input h-9 w-full pr-10" autoFocus />
        <button type="button" onClick={() => setVisible((value) => !value)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#64748B]" aria-label={visible ? 'Sembunyikan password' : 'Lihat password'}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="hd-button hd-button--secondary h-9"><ArrowLeft size={14} />Kembali</button>
        <button type="submit" disabled={!password || loading} className="hd-button hd-button--primary h-9"><ShieldCheck size={14} />{loading ? 'Memverifikasi…' : 'Buka Finance'}</button>
      </div>
    </form>}
    {!status?.configured && <button type="button" onClick={onBack} className="hd-button hd-button--secondary h-9"><ArrowLeft size={14} />Kembali</button>}
  </section>;
};
