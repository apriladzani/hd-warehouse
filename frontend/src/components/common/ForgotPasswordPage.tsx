import React, { useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { AuthButton, AuthHeader, AuthInput, AuthLayout, AuthMessage } from './AuthUI.tsx';

export const ForgotPasswordPage: React.FC<{ onNavigateToLogin: () => void }> = ({ onNavigateToLogin }) => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // No reset-password API exists yet. Do not simulate sending an email.
    setSubmitted(true);
  };

  return (
    <AuthLayout>
      <AuthHeader title="Lupa Password?" subtitle="Masukkan email yang terdaftar untuk memulihkan akses akun." />
      {submitted && <AuthMessage kind="info">Pemulihan password otomatis belum tersedia dan email tidak dikirim. Hubungi administrator untuk bantuan.</AuthMessage>}
      <form onSubmit={handleSubmit} className="hd-auth-form">
        <div className="hd-auth-field">
          <label htmlFor="forgot-email">Email</label>
          <AuthInput id="forgot-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => { setEmail(event.target.value); setSubmitted(false); }} placeholder="nama@perusahaan.com" icon={Mail} />
        </div>
        <AuthButton type="submit"><span>Kirim Link Reset</span></AuthButton>
      </form>
      <p className="hd-auth-switch"><button type="button" onClick={onNavigateToLogin} className="hd-auth-text-link hd-auth-back-link"><ArrowLeft size={15} aria-hidden="true" /> Kembali ke Login</button></p>
    </AuthLayout>
  );
};
