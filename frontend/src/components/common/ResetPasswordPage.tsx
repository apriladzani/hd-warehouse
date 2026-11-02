import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { AuthButton, AuthHeader, AuthLayout, AuthMessage, PasswordInput } from './AuthUI.tsx';
import { describeTransportFailure, requestJson } from '../../lib/authRequest.ts';

export const MIN_PASSWORD_LENGTH = 6;

// What is wrong with the pair the user typed, or null when it is ready to send.
export function describePasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  if (confirmation && password !== confirmation) return 'Konfirmasi password belum sama.';
  if (!confirmation) return 'Ulangi password baru untuk memastikan tidak ada salah ketik.';
  return null;
}

export const ResetPasswordPage: React.FC<{ token: string; onNavigateToLogin: () => void; onNavigateToForgotPassword: () => void }> = ({ token, onNavigateToLogin, onNavigateToForgotPassword }) => {
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Check the link before showing the form: a spent or expired link should say
  // so immediately, not after the user has chosen a new password.
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson(`/api/auth/password-reset/verify?token=${encodeURIComponent(token)}`);
      if (!active) return;
      if (!result.ok) setError(describeTransportFailure(result) || 'Tautan tidak bisa diperiksa. Coba lagi nanti.');
      setValid(Boolean(result.data?.valid));
      setName(result.data?.name || null);
      setChecking(false);
    })();
    return () => { active = false; };
  }, [token]);

  const problem = describePasswordProblem(password, confirmation);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem) { setError(problem); return; }
    setLoading(true);
    setError(null);
    const result = await requestJson('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (result.ok) { setDone(true); return; }
    setError(describeTransportFailure(result) || result.data?.error || 'Password tidak bisa diubah. Coba lagi.');
  };

  if (checking) {
    return (
      <AuthLayout>
        <AuthHeader title="Memeriksa Tautan" subtitle="Mohon tunggu sebentar." />
        <p className="hd-auth-hint" role="status">Memeriksa tautan reset password…</p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <AuthHeader title="Password Diubah" subtitle="Password baru Anda sudah aktif." />
        <AuthMessage kind="success">Password berhasil diubah. Semua perangkat yang masih masuk dengan password lama otomatis keluar.</AuthMessage>
        <div className="hd-auth-form">
          <AuthButton type="button" onClick={onNavigateToLogin}><span>Masuk Sekarang</span><Check size={16} aria-hidden="true" /></AuthButton>
        </div>
      </AuthLayout>
    );
  }

  if (!valid) {
    return (
      <AuthLayout>
        <AuthHeader title="Tautan Tidak Berlaku" subtitle="Tautan reset hanya berlaku 60 menit dan sekali pakai." />
        <AuthMessage kind="error">{error || 'Tautan ini sudah dipakai atau kedaluwarsa. Minta tautan baru untuk melanjutkan.'}</AuthMessage>
        <div className="hd-auth-form">
          <AuthButton type="button" onClick={onNavigateToForgotPassword}><span>Minta Tautan Baru</span></AuthButton>
        </div>
        <p className="hd-auth-switch"><button type="button" onClick={onNavigateToLogin} className="hd-auth-text-link hd-auth-back-link"><ArrowLeft size={15} aria-hidden="true" /> Kembali ke Login</button></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader title="Buat Password Baru" subtitle={name ? `Akun ${name}. Pilih password yang belum pernah Anda pakai.` : 'Pilih password yang belum pernah Anda pakai.'} />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      <form onSubmit={handleSubmit} className="hd-auth-form">
        <PasswordInput
          id="reset-password"
          label="Password Baru"
          value={password}
          onChange={(event) => { setPassword(event.target.value); if (error) setError(null); }}
          autoComplete="new-password"
          placeholder={`Minimal ${MIN_PASSWORD_LENGTH} karakter`}
          invalid={Boolean(error) || (password.length > 0 && password.length < MIN_PASSWORD_LENGTH)}
          describedBy={password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? 'reset-password-rule' : undefined}
        />
        {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && <p id="reset-password-rule" className="hd-auth-hint hd-auth-hint--warn" role="status">Password minimal {MIN_PASSWORD_LENGTH} karakter. Kurang {MIN_PASSWORD_LENGTH - password.length} lagi.</p>}
        <PasswordInput
          id="reset-password-confirm"
          label="Ulangi Password Baru"
          value={confirmation}
          onChange={(event) => { setConfirmation(event.target.value); if (error) setError(null); }}
          autoComplete="new-password"
          placeholder="Ketik ulang password baru"
          invalid={Boolean(error) || (confirmation.length > 0 && password !== confirmation)}
        />
        {confirmation.length > 0 && password !== confirmation && <p className="hd-auth-hint hd-auth-hint--warn" role="status">Konfirmasi password belum sama.</p>}
        <AuthButton type="submit" loading={loading} disabled={Boolean(problem)}>
          <span>Simpan Password Baru</span><Check size={16} aria-hidden="true" />
        </AuthButton>
      </form>
      <p className="hd-auth-switch"><button type="button" onClick={onNavigateToLogin} className="hd-auth-text-link hd-auth-back-link"><ArrowLeft size={15} aria-hidden="true" /> Kembali ke Login</button></p>
    </AuthLayout>
  );
};
