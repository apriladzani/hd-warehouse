import React, { useState } from 'react';
import { ArrowRight, Mail, UserRound } from 'lucide-react';
import type { User } from '../../types.ts';
import { useBranding } from './BrandingContext.tsx';
import { AuthButton, AuthHeader, AuthInput, AuthLayout, AuthMessage, GoogleSignInButton, PasswordInput, useGoogleSignInEnabled } from './AuthUI.tsx';
import { GOOGLE_SIGN_IN_URL } from '../../lib/googleSignIn.ts';
import { describeTransportFailure, requestJson } from '../../lib/authRequest.ts';
import { MIN_PASSWORD_LENGTH } from './ResetPasswordPage.tsx';

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
  const googleEnabled = useGoogleSignInEnabled();
  const { branding } = useBranding();
  // Focusing on arrival saves a tap at a shared terminal, but on a touch
  // device it throws up the on-screen keyboard before the user has decided
  // to type.
  const [autoFocus] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)').matches));

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const incomplete = !name.trim() || !email.trim() || password.length < MIN_PASSWORD_LENGTH;

  // The message describes the attempt that just failed, so editing any field
  // makes it stale.
  const editField = (apply: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    apply(event.target.value);
    if (error) setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    // Public registration uses the backend's default Outlet role.
    const result = await requestJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
    });
    if (result.ok && result.data?.user) {
      setSuccessMsg('Akun berhasil didaftarkan. Mengalihkan ke sistem...');
      window.setTimeout(() => onRegisterSuccess(result.data.user), 700);
      return;
    }
    setLoading(false);
    setError(describeTransportFailure(result) || result.data?.error || 'Pendaftaran gagal. Periksa data Anda, lalu coba lagi.');
  };

  const invalid = Boolean(error);

  return (
    <AuthLayout>
      <AuthHeader title="Buat Akun" subtitle={`Daftarkan akun untuk mengakses ${branding.appName}.`} />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      {successMsg && <AuthMessage kind="success">{successMsg}</AuthMessage>}
      <form onSubmit={handleSubmit} className="hd-auth-form">
        <div className="hd-auth-field">
          <label htmlFor="reg-name">Nama Lengkap</label>
          <AuthInput id="reg-name" name="name" type="text" autoComplete="name" required autoFocus={autoFocus} value={name} onChange={editField(setName)} placeholder="Nama lengkap" icon={UserRound} invalid={invalid} />
        </div>
        <div className="hd-auth-field">
          <label htmlFor="reg-email">Email</label>
          <AuthInput id="reg-email" name="email" type="email" autoComplete="email" required value={email} onChange={editField(setEmail)} placeholder="nama@perusahaan.com" icon={Mail} invalid={invalid} />
        </div>
        <PasswordInput
          id="reg-password"
          value={password}
          onChange={editField(setPassword)}
          autoComplete="new-password"
          placeholder={`Minimal ${MIN_PASSWORD_LENGTH} karakter`}
          invalid={invalid || tooShort}
          describedBy={tooShort ? 'reg-password-rule' : undefined}
        />
        {tooShort && <p id="reg-password-rule" className="hd-auth-hint hd-auth-hint--warn" role="status">Password minimal {MIN_PASSWORD_LENGTH} karakter. Kurang {MIN_PASSWORD_LENGTH - password.length} lagi.</p>}
        <AuthButton id="btn-register-submit" type="submit" loading={loading} disabled={incomplete}>
          <span>Daftar</span><ArrowRight size={17} aria-hidden="true" />
        </AuthButton>
      </form>
      {googleEnabled && <GoogleSignInButton href={GOOGLE_SIGN_IN_URL} label="Daftar dengan Google" />}
      <p className="hd-auth-switch">Sudah punya akun? <button type="button" id="link-to-login" onClick={onNavigateToLogin} className="hd-auth-text-link">Masuk</button></p>
    </AuthLayout>
  );
};
