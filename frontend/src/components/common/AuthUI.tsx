import React, { type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff, LockKeyhole, type LucideIcon } from 'lucide-react';
import { useBranding } from './BrandingContext.tsx';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { branding } = useBranding();
  return (
    <main className="hd-ui hd-auth">
      <section className="hd-auth-card" aria-label="HD Management System authentication">
        <aside className="hd-auth-visual" aria-label="HD Management System">
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
};

export function AuthInput({ icon: Icon, trailing, className = '', ...props }: AuthInputProps) {
  return (
    <div className="hd-auth-input-wrap">
      {Icon && <Icon className="hd-auth-input-icon" size={17} aria-hidden="true" />}
      <input className={`hd-auth-input ${Icon ? 'hd-auth-input--icon' : ''} ${trailing ? 'hd-auth-input--trailing' : ''} ${className}`} {...props} />
      {trailing}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, required = true, autoComplete = 'current-password', placeholder = 'Masukkan password', label = 'Password' }: {
  id: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  label?: string;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="hd-auth-field">
      <label htmlFor={id}>{label}</label>
      <AuthInput
        id={id}
        name="password"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        icon={LockKeyhole}
        trailing={(
          <button type="button" className="hd-auth-password-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={visible}>
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      />
    </div>
  );
}

export function AuthButton({ children, loading = false, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return <button className="hd-auth-submit" disabled={loading || disabled} {...props}>{loading ? 'Memproses...' : children}</button>;
}

export function AuthMessage({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  return <div className={`hd-auth-message hd-auth-message--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
