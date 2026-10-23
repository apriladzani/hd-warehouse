import React, { useState } from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import type { User } from '../../types.ts';
import { AuthButton, AuthHeader, AuthInput, AuthLayout, AuthMessage, PasswordInput } from './AuthUI.tsx';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
  onNavigateToRegister: () => void;
  onNavigateToForgotPassword: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, onNavigateToRegister, onNavigateToForgotPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      let data: any = {};
      try {
        data = await response.json();
      } catch {
        throw new Error('Server mengembalikan respons tidak valid. Pastikan server aktif.');
      }
      if (!response.ok) throw new Error(data.error || 'Email atau password salah.');
      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'Login gagal. Periksa kembali email dan password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeader title="Selamat Datang" subtitle="Masuk untuk mengakses HD Management System." />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      <form onSubmit={handleLogin} className="hd-auth-form">
        <div className="hd-auth-field">
          <label htmlFor="login-email">Username / Email</label>
          <AuthInput id="login-email" name="username" type="text" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="username atau nama@perusahaan.com" icon={Mail} />
        </div>
        <PasswordInput id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <div className="hd-auth-forgot-row">
          <button type="button" onClick={onNavigateToForgotPassword} className="hd-auth-text-link">Lupa Password?</button>
        </div>
        <AuthButton id="btn-login-submit" type="submit" loading={loading}>
          <span>Masuk</span><ArrowRight size={17} aria-hidden="true" />
        </AuthButton>
      </form>
      <p className="hd-auth-switch">Belum punya akun? <button type="button" id="link-to-register" onClick={onNavigateToRegister} className="hd-auth-text-link">Daftar Sekarang</button></p>
    </AuthLayout>
  );
};
