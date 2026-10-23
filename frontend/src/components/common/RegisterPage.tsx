import React, { useState } from 'react';
import { ArrowRight, Mail, UserRound } from 'lucide-react';
import type { User } from '../../types.ts';
import { AuthButton, AuthHeader, AuthInput, AuthLayout, AuthMessage, PasswordInput } from './AuthUI.tsx';

interface RegisterPageProps {
  onRegisterSuccess: (user: User) => void;
  onNavigateToLogin: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ onRegisterSuccess, onNavigateToLogin }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Public registration uses the backend's default Outlet role.
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      let data: any = {};
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server mengembalikan respons tidak valid (Status ${response.status}).`);
      }
      if (!response.ok) throw new Error(data.error || 'Pendaftaran gagal.');
      setSuccessMsg('Akun berhasil didaftarkan. Mengalihkan ke sistem...');
      window.setTimeout(() => onRegisterSuccess(data.user), 700);
    } catch (err: any) {
      setError(err.message || 'Gagal mendaftar akun.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeader title="Buat Akun" subtitle="Daftarkan akun untuk mengakses HD Management System." />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      {successMsg && <AuthMessage kind="success">{successMsg}</AuthMessage>}
      <form onSubmit={handleSubmit} className="hd-auth-form">
        <div className="hd-auth-field">
          <label htmlFor="reg-name">Nama Lengkap</label>
          <AuthInput id="reg-name" name="name" type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama lengkap" icon={UserRound} />
        </div>
        <div className="hd-auth-field">
          <label htmlFor="reg-email">Email</label>
          <AuthInput id="reg-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@perusahaan.com" icon={Mail} />
        </div>
        <PasswordInput id="reg-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="Minimal 6 karakter" />
        <AuthButton id="btn-register-submit" type="submit" loading={loading}>
          <span>Daftar</span><ArrowRight size={17} aria-hidden="true" />
        </AuthButton>
      </form>
      <p className="hd-auth-switch">Sudah punya akun? <button type="button" id="link-to-login" onClick={onNavigateToLogin} className="hd-auth-text-link">Masuk</button></p>
    </AuthLayout>
  );
};
