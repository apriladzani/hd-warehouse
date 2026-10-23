import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type BrandingConfig = { appName: string; subtitle: string; mainLogo: string; sidebarLogo: string; favicon: string };
export type SystemConfig = { systemName: string; dateFormat: string; timeZone: string; currency: string; organizationInfo: string };
const defaultBranding: BrandingConfig = { appName: 'HD Management System', subtitle: 'Inventory & Operations', mainLogo: '', sidebarLogo: '', favicon: '' };
const defaultSystem: SystemConfig = { systemName: 'HD Management System', dateFormat: 'DD MMM YYYY', timeZone: 'Asia/Jakarta', currency: 'IDR', organizationInfo: '' };
const BrandingContext = createContext<{ branding: BrandingConfig; system: SystemConfig; setConfig: (value: { branding: BrandingConfig; system?: SystemConfig }) => void }>({ branding: defaultBranding, system: defaultSystem, setConfig: () => undefined });

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState({ branding: defaultBranding, system: defaultSystem });
  useEffect(() => {
    let mounted = true;
    const refresh = () => fetch('/api/config').then((response) => response.ok ? response.json() : null).then((value) => { if (mounted && value) setConfigState((current) => ({ branding: { ...current.branding, ...value.branding }, system: { ...current.system, ...value.system } })); }).catch(() => undefined);
    void refresh();
    window.addEventListener('hd-config-updated', refresh);
    return () => { mounted = false; window.removeEventListener('hd-config-updated', refresh); };
  }, []);
  useEffect(() => {
    document.title = config.branding.appName || config.system.systemName;
    localStorage.setItem('hd_system_settings', JSON.stringify(config.system));
    if (!config.branding.favicon) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = config.branding.favicon;
  }, [config]);
  const value = useMemo(() => ({ ...config, setConfig: (next: { branding: BrandingConfig; system?: SystemConfig }) => setConfigState((old) => ({ branding: { ...old.branding, ...next.branding }, system: { ...old.system, ...(next.system || {}) } })) }), [config]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() { return useContext(BrandingContext); }
