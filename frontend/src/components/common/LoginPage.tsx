import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, User as UserIcon } from 'lucide-react';
import type { User } from '../../types.ts';
import { useBranding } from './BrandingContext.tsx';
import { AuthButton, AuthHeader, AuthInput, AuthLayout, AuthMessage, GoogleSignInButton, PasswordInput, useGoogleSignInEnabled } from './AuthUI.tsx';
import { describeGoogleError, GOOGLE_SIGN_IN_URL, googleErrorKind } from '../../lib/googleSignIn.ts';
import { MALFORMED_REPLY_MESSAGE, OFFLINE_MESSAGE, UNREACHABLE_MESSAGE } from '../../lib/authRequest.ts';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
  onNavigateToRegister: () => void;
  onNavigateToForgotPassword: () => void;
  // The oauth_error code a Google sign-in redirect came back with, if any.
  googleError?: string | null;
}

// A failed login has several causes that need different actions from the user,
// and the one the server never sees - no network - used to be reported as wrong
// credentials. Each branch names the cause and what to do about it.
const CREDENTIALS_REJECTED = 'Username atau password salah. Periksa Caps Lock, lalu coba lagi.';

export const describeLoginFailure = (status: number | null, serverMessage?: string, online = true, parsed = true): string => {
  if (!online) return OFFLINE_MESSAGE;
  if (status === null) return UNREACHABLE_MESSAGE;
  // The login route always explains a rejection in JSON. A non-JSON error body
  // means the request never got that far - a broken dependency, a proxy, a
  // crash - so the fields the user typed are not the problem.
  if (!parsed) return MALFORMED_REPLY_MESSAGE;
  if (status === 401) return CREDENTIALS_REJECTED;
  if (status === 400) return serverMessage || 'Username dan password wajib diisi.';
  if (status === 429) return serverMessage || 'Terlalu banyak percobaan masuk. Tunggu beberapa saat, lalu coba lagi.';
  if (status === 503) return 'Server belum bisa memverifikasi akun saat ini. Coba lagi beberapa saat atau hubungi administrator.';
  if (status >= 500) return 'Terjadi gangguan di server. Coba lagi beberapa saat lagi.';
  return serverMessage || CREDENTIALS_REJECTED;
};

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, onNavigateToRegister, onNavigateToForgotPassword, googleError = null }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleNotice, setGoogleNotice] = useState<string | null>(googleError);
  const googleEnabled = useGoogleSignInEnabled();
  const { branding } = useBranding();
  // App may learn of a failure after the first render, when the session check
  // that follows a Google redirect comes back empty.
  useEffect(() => { if (googleError) setGoogleNotice(googleError); }, [googleError]);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Focusing on arrival saves a tap at a shared terminal, but on a touch
  // device it throws up the on-screen keyboard over half the page before the
  // user has decided to type.
  const [autoFocus] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)').matches));

  // The message describes the attempt that just failed, so editing either field
  // makes it stale. Clearing on edit keeps a red alert from outliving its cause.
  const editField = (apply: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    apply(event.target.value);
    if (error) setError(null);
    if (googleNotice) setGoogleNotice(null);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setGoogleNotice(null);
    setLoading(true);
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      let data: any = {};
      let parsed = true;
      try {
        data = await response.json();
      } catch {
        parsed = false;
        if (response.ok) throw new Error(MALFORMED_REPLY_MESSAGE);
      }
      if (!response.ok) {
        setError(describeLoginFailure(response.status, data?.error, online, parsed));
        passwordRef.current?.focus();
        return;
      }
      onLoginSuccess(data.user);
    } catch (err: any) {
      // fetch only rejects when the request never completed: offline, DNS
      // failure, a refused connection, or a server that is not running.
      setError(err?.message === MALFORMED_REPLY_MESSAGE ? err.message : describeLoginFailure(null, undefined, online));
      passwordRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const invalid = Boolean(error);

  return (
    <AuthLayout>
      <AuthHeader title="Selamat Datang" subtitle={`Masuk untuk mengakses ${branding.appName}.`} />
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      {!error && googleNotice && <AuthMessage kind={googleErrorKind(googleNotice)}>{describeGoogleError(googleNotice)}</AuthMessage>}
      <form onSubmit={handleLogin} className="hd-auth-form">
        <div className="hd-auth-field">
          <label htmlFor="login-email">Username / Email</label>
          <AuthInput id="login-email" name="username" type="text" autoComplete="username" required autoFocus={autoFocus} value={email} onChange={editField(setEmail)} placeholder="username atau nama@perusahaan.com" icon={UserIcon} invalid={invalid} />
        </div>
        <PasswordInput id="login-password" value={password} onChange={editField(setPassword)} invalid={invalid} inputRef={passwordRef} />
        <div className="hd-auth-forgot-row">
          <button type="button" onClick={onNavigateToForgotPassword} className="hd-auth-text-link">Lupa Password?</button>
        </div>
        <AuthButton id="btn-login-submit" type="submit" loading={loading}>
          <span>Masuk</span><ArrowRight size={17} aria-hidden="true" />
        </AuthButton>
      </form>
      {googleEnabled && <GoogleSignInButton href={GOOGLE_SIGN_IN_URL} />}
      <p className="hd-auth-switch">Belum punya akun? <button type="button" id="link-to-register" onClick={onNavigateToRegister} className="hd-auth-text-link">Daftar Sekarang</button></p>
    </AuthLayout>
  );
};
