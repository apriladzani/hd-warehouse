import React, { useEffect, useRef, useState } from 'react';
import { Activity, Boxes, ChevronRight, Clock3, FileText, LayoutDashboard, LockKeyhole, LogOut, Menu, PackageCheck, PanelLeftClose, Palette, Settings, Store, Users, X, CircleDollarSign } from 'lucide-react';
import type { User } from '../../types.ts';
import { Button, IconButton } from './UI.tsx';
import { useBranding } from './BrandingContext.tsx';

interface NavbarProps {
  currentUser: User;
  activeNav: string;
  onNavigate: (tab: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const roleLabels = { ADMIN: 'Admin', WAREHOUSE: 'Warehouse', OUTLET: 'Outlet', FINANCE: 'Finance' };

export const Navbar: React.FC<NavbarProps> = ({ currentUser, activeNav, onNavigate, onLogout, children }) => {
  const { branding } = useBranding();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const roleLabel = roleLabels[currentUser.role];
  const dashboard = { id: 'dashboard', label: currentUser.role === 'ADMIN' ? 'Overview' : 'Dashboard', icon: LayoutDashboard };
  const history = { id: 'history', label: 'Riwayat', icon: Clock3 };
  const navItems = currentUser.role === 'ADMIN'
    ? [dashboard, { id: 'users', label: 'User Management', icon: Users }, { id: 'outlets', label: 'Outlet Management', icon: Store }, { id: 'branding', label: 'Branding Settings', icon: Palette }, { id: 'settings', label: 'System Settings', icon: Settings }, { id: 'financeSecurity', label: 'Finance Security', icon: LockKeyhole }, { id: 'activity', label: 'Activity Logs', icon: Activity }]
    : currentUser.role === 'WAREHOUSE'
    ? [dashboard, { id: 'inventory', label: 'Inventory', icon: Boxes }, { id: 'requests', label: 'Request Outlet', icon: PackageCheck }, history, { id: 'finance', label: 'Finance', icon: CircleDollarSign }]
    : currentUser.role === 'FINANCE'
      ? [{ id: 'finance', label: 'Finance', icon: CircleDollarSign }]
      : [dashboard, { id: 'request', label: 'HD Request', icon: FileText }, history];
  const title = navItems.find((item) => item.id === activeNav)?.label || 'Dashboard';
  const initials = currentUser.name.split(' ').filter(Boolean).slice(0, 2).map((name) => name[0]).join('');

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
      if (event.key !== 'Tab') return;
      const focusable = sidebarRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
      const visible = focusable ? Array.from(focusable).filter((element) => element.getClientRects().length) : [];
      if (!visible.length) return;
      const first = visible[0];
      const last = visible[visible.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      menuRef.current?.focus();
    };
  }, [drawerOpen]);

  const navigate = (tab: string) => {
    onNavigate(tab);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className={`hd-ui hd-app ${collapsed ? 'hd-app--collapsed' : ''} ${drawerOpen ? 'hd-app--drawer-open' : ''}`} data-role={currentUser.role}>
      <a href="#main-content" className="hd-skip-link">Lewati navigasi</a>
      {drawerOpen && <button className="hd-drawer-overlay" tabIndex={-1} aria-label="Tutup navigasi" onClick={() => setDrawerOpen(false)} />}
      <aside id="app-sidebar" ref={sidebarRef} className="hd-sidebar" role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen || undefined} aria-label={`Workspace ${roleLabel}`}>
        <div className="hd-brand-row">
          <div className="hd-brand-mark" aria-hidden="true">{branding.sidebarLogo || branding.mainLogo ? <img src={branding.sidebarLogo || branding.mainLogo} alt="" /> : 'HD'}</div>
          <div className="hd-sidebar-label hd-brand-copy"><strong>{branding.appName}</strong><span>{branding.subtitle}</span></div>
          <IconButton className="hd-drawer-close" aria-label="Tutup navigasi" onClick={() => setDrawerOpen(false)}><X size={18} /></IconButton>
        </div>
        <div className="hd-workspace-label"><span className="hd-sidebar-label">{roleLabel} Workspace</span><span className="hd-workspace-dot" /></div>
        <nav aria-label="Navigasi utama" className="hd-sidebar-nav">
          {navItems.map((item) => (
            <button id={`nav-${item.id}`} key={item.id} title={collapsed ? item.label : undefined} aria-label={item.label} aria-current={activeNav === item.id ? 'page' : undefined} onClick={() => navigate(item.id)} className={`hd-nav-item ${activeNav === item.id ? 'hd-nav-item--active' : ''}`}>
              <item.icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="hd-sidebar-label">{item.label}</span>
              {activeNav === item.id && <ChevronRight size={14} className="hd-sidebar-label hd-nav-arrow" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <div className="hd-sidebar-footer">
          <div className="hd-sidebar-label hd-footer-copy"><span className="hd-footer-caption">HD MANAGEMENT SYSTEM</span><span>Satu workspace, semua aktivitas.</span></div>
          <button className="hd-sidebar-collapse" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Perluas sidebar' : 'Lipat sidebar'} aria-expanded={!collapsed}>
            {collapsed ? <ChevronRight size={17} /> : <PanelLeftClose size={17} />}<span className="hd-sidebar-label">Lipat sidebar</span>
          </button>
          <Button id="drawer-logout-btn" variant="secondary" className="hd-drawer-logout" onClick={onLogout} aria-label="Keluar dari akun">
            <LogOut size={17} /><span>Keluar</span>
          </Button>
        </div>
      </aside>
      <div className="hd-workspace">
        <header className="hd-topbar">
          <div className="hd-topbar-heading">
            <IconButton ref={menuRef} className="hd-mobile-menu" aria-label="Buka navigasi" aria-expanded={drawerOpen} aria-controls="app-sidebar" onClick={() => setDrawerOpen(true)}><Menu size={20} /></IconButton>
            {currentUser.role === 'OUTLET' && <span className="hd-mobile-brand-mark" aria-hidden="true">HD</span>}
            <div><div className="hd-breadcrumb">{branding.appName} <ChevronRight size={11} aria-hidden="true" /> {roleLabel}</div><p className="hd-topbar-title">{title}</p></div>
          </div>
          <div className="hd-topbar-actions">
            <span className="hd-role-tag">{roleLabel}</span>
            <div className="hd-user" title={currentUser.name}><span className="hd-avatar" aria-hidden="true">{initials}</span><span className="hd-user-name">{currentUser.name}</span></div>
            <Button id="logout-btn" variant="ghost" className="hd-logout" onClick={onLogout} title="Keluar dari akun" aria-label="Keluar dari akun"><LogOut size={16} /><span>Keluar</span></Button>
          </div>
        </header>
        <main id="main-content" className="hd-main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
};
