import React, { useState } from 'react';
import { ArrowLeft, Send, User as UserIcon } from 'lucide-react';
import { AuthButton, AuthHeader, AuthInput, AuthLayout, AuthMessage } from './AuthUI.tsx';
import { describeTransportFailure, requestJson } from '../../lib/authRequest.ts';

export const ForgotPasswordPage: React.FC<{ onNavigateToLogin: () => void }> = ({ onNavigateToLogin }) => {
  const [login, setLogin] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSent(null);
    const result = await requestJson('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: login.trim() }),
    });
    setLoading(false);
    if (result.ok) {
      setSent(result.data?.message || 'Jika akun tersebut terdaftar, tautan sudah dikirim ke emailnya.');
      return;
    }
    setError(describeTransportFailure(result) || result.data?.error || 'Permintaan gagal dikirim. Coba lagi.');
  };

  // The confirmation deliberately does not say whether the account exists, so
  // the form cannot be used to find out who has an account here.
  if (sent) {
    return (
      <AuthLayout>
        <AuthHeader title="Periksa Email Anda" subtitle="Langkah berikutnya ada di kotak masuk email akun Anda." />
        <AuthMessage kind="success">{sent}</AuthMessage>
        <p className="hd-auth-hint">Tautan berlaku 60 menit dan hanya bisa dipakai satu kali. Belum menerimanya? Periksa folder spam, lalu minta tautan baru.</p>
        <div className="hd-auth-form">
          <AuthButton type="button" onClick={() => { setSent(null); setLogin(''); }}>
            <span>Minta tautan lagi</span>
          </AuthButton>
        </div>
        <p className="hd-auth-switch"><button type="button" onClick={onNavigateToLogin} className="hd-auth-text-link hd-auth-back-link"><ArrowLeft size={15} aria-hidden="true" /> Kembali ke Login</button></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader title="Lupa Password?" subtitle="Masukkan username atau email akun Anda. Kami kirim tautan untuk membuat password baru." />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      <form onSubmit={handleSubmit} className="hd-auth-form">
        <div className="hd-auth-field">
          <label htmlFor="forgot-login">Username / Email</label>
          <AuthInput
            id="forgot-login"
            name="username"
            type="text"
            autoComplete="username"
            required
            value={login}
            onChange={(event) => { setLogin(event.target.value); if (error) setError(null); }}
            placeholder="username atau nama@perusahaan.com"
            icon={UserIcon}
            invalid={Boolean(error)}
          />
        </div>
        <AuthButton type="submit" loading={loading} disabled={!login.trim()}>
          <span>Kirim Tautan Reset</span><Send size={16} aria-hidden="true" />
        </AuthButton>
      </form>
      <p className="hd-auth-switch"><button type="button" onClick={onNavigateToLogin} className="hd-auth-text-link hd-auth-back-link"><ArrowLeft size={15} aria-hidden="true" /> Kembali ke Login</button></p>
    </AuthLayout>
  );
};
