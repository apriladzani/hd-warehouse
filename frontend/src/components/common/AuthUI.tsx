import React, { type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff, LockKeyhole, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useBranding } from './BrandingContext.tsx';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { branding } = useBranding();
  return (
    <main className="hd-ui hd-auth">
      <section className="hd-auth-card" aria-label={`Autentikasi ${branding.appName}`}>
        <aside className="hd-auth-visual" aria-label={branding.appName}>
          <img src="/images/auth-warehouse.png" alt="Aktivitas operasional di gudang" className="hd-auth-image" />
          <div className="hd-auth-image-overlay" />
          <div className="hd-auth-brand">
            <div className="hd-auth-brand-mark" aria-hidden="true">{branding.mainLogo ? <img src={branding.mainLogo} alt="" /> : 'HD'}</div>
            <p className="hd-auth-brand-title">{branding.appName}</p>
            <p className="hd-auth-brand-tagline">{branding.subtitle}</p>
          </div>
        </aside>
        <div className="hd-auth-content">
          <div className="hd-auth-form-wrap">{children}</div>
          <p className="hd-auth-footer">{branding.appName}</p>
        </div>
      </section>
    </main>
  );
}

export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const { branding } = useBranding();
  return (
    <header className="hd-auth-header">
      <div className="hd-auth-mobile-brand" aria-hidden="true"><span>{branding.mainLogo ? <img src={branding.mainLogo} alt="" /> : 'HD'}</span><strong>{branding.appName}</strong></div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: LucideIcon;
  trailing?: ReactNode;
  invalid?: boolean;
};

export const AuthInput = React.forwardRef<HTMLInputElement, AuthInputProps>(function AuthInput(
  { icon: Icon, trailing, invalid = false, className = '', ...props }, ref,
) {
  return (
    <div className="hd-auth-input-wrap">
      {Icon && <Icon className="hd-auth-input-icon" size={17} aria-hidden="true" />}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`hd-auth-input ${Icon ? 'hd-auth-input--icon' : ''} ${trailing ? 'hd-auth-input--trailing' : ''} ${invalid ? 'hd-auth-input--invalid' : ''} ${className}`}
        {...props}
      />
      {trailing}
    </div>
  );
});

// Caps Lock is the most common reason a correct password is rejected, and a
// masked field gives the typist no way to notice it. The hint tracks the key
// while the field has focus, so it appears and clears as the key is toggled.
export function PasswordInput({ id, value, onChange, required = true, autoComplete = 'current-password', placeholder = 'Masukkan password', label = 'Password', invalid = false, describedBy, inputRef }: {
  id: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [visible, setVisible] = React.useState(false);
  const [capsLock, setCapsLock] = React.useState(false);
  const capsLockId = `${id}-capslock`;

  const trackCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof event.getModifierState === 'function') setCapsLock(event.getModifierState('CapsLock'));
  };
  const description = [describedBy, capsLock ? capsLockId : null].filter(Boolean).join(' ');

  return (
    <div className="hd-auth-field">
      <label htmlFor={id}>{label}</label>
      <AuthInput
        ref={inputRef}
        id={id}
        name="password"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onKeyDown={trackCapsLock}
        onKeyUp={trackCapsLock}
        onBlur={() => setCapsLock(false)}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        icon={LockKeyhole}
        invalid={invalid}
        aria-describedby={description || undefined}
        trailing={(
          <button type="button" className="hd-auth-password-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={visible}>
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      />
      {capsLock && (
        <p id={capsLockId} className="hd-auth-hint hd-auth-hint--warn" role="status">
          <TriangleAlert size={13} aria-hidden="true" />
          Caps Lock aktif. Password membedakan huruf besar dan kecil.
        </p>
      )}
    </div>
  );
}

export function AuthButton({ children, loading = false, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return <button className="hd-auth-submit" aria-busy={loading || undefined} disabled={loading || disabled} {...props}>{loading ? 'Memproses...' : children}</button>;
}

// Google's sign-in branding rules: a white button, the four-colour "G" at its
// original proportions, and the words "dengan Google". Shown only when the
// server reports the provider is configured, so it never leads to a dead end.
export function useGoogleSignInEnabled() {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    fetch('/api/auth/providers').then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setEnabled(Boolean(data?.google)); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return enabled;
}

export function GoogleSignInButton({ href, label = 'Lanjutkan dengan Google' }: { href: string; label?: string }) {
  return (
    <>
      <div className="hd-auth-divider" role="separator"><span>atau</span></div>
      <a href={href} className="hd-auth-google">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{label}</span>
      </a>
    </>
  );
}

export function AuthMessage({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  return <div className={`hd-auth-message hd-auth-message--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
