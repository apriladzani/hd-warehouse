import React from 'react';
import { AlertCircle, Inbox, LoaderCircle, type LucideIcon } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className = '', type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} className={`hd-button hd-button--${variant} ${className}`} {...props} />;
});

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(function IconButton(
  { className = '', variant = 'ghost', ...props }, ref,
) {
  return <Button ref={ref} variant={variant} className={`hd-icon-button ${className}`} {...props} />;
});

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...props }, ref,
) {
  return <input ref={ref} className={`hd-input ${className}`} {...props} />;
});

export function Surface({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`hd-surface ${className}`} {...props} />;
}

export function Toolbar({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`hd-toolbar ${className}`} {...props} />;
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  description?: string;
  className?: string;
}

export function KpiCard({ label, value, icon: Icon, tone = 'neutral', description, className = '' }: KpiCardProps) {
  return (
    <Surface className={`hd-kpi hd-kpi--${tone} ${className}`}>
      <div className="hd-kpi-heading"><span>{label}</span>{Icon && <span className="hd-kpi-icon"><Icon size={15} aria-hidden="true" /></span>}</div>
      <p className="hd-kpi-value">{value}</p>
      {description && <p className="hd-kpi-description">{description}</p>}
    </Surface>
  );
}

export function StateMessage({ kind = 'empty', children, className = '' }: {
  kind?: 'loading' | 'empty' | 'error'; children: React.ReactNode; className?: string;
}) {
  const Icon = kind === 'loading' ? LoaderCircle : kind === 'error' ? AlertCircle : Inbox;
  return <div className={`hd-state hd-state--${kind} ${className}`} role={kind === 'error' ? 'alert' : 'status'}><Icon size={20} className={kind === 'loading' ? 'animate-spin' : ''} aria-hidden="true" /><span>{children}</span></div>;
}
