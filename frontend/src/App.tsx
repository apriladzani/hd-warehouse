import React, { useState, useEffect } from 'react';
import { User } from './types.ts';
import { FinanceAccessGate } from './components/warehouse/FinanceAccessGate.tsx';
import {
  Navbar,
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
  UserDashboard,
  UserRequestForm,
  UserRiwayat,
  WarehouseDashboard,
  WarehouseOperationalDashboard,
  WarehouseInventory,
  WarehouseRequests,
  WarehouseHistory,
  AdminWorkspace,
} from './components/index.ts';

// Default initial user for instant seamless preview
const DEFAULT_USER: User = {
  id: 1,
  name: 'April Adzania',
  email: 'april.adzania@gmail.com',
  role: 'OUTLET',
};

const roleBase = (role: string) => role === 'ADMIN' ? '/admin' : role === 'WAREHOUSE' || role === 'FINANCE' ? '/warehouse' : '/outlet';
const normalizeRole = (role: string) => role.toUpperCase() === 'USER' ? 'OUTLET' : role.toUpperCase();
const pagePath = (role: string, page: string) => {
  const base = roleBase(role);
  if (role === 'ADMIN') {
    const paths: Record<string, string> = { dashboard: 'dashboard', users: 'users', outlets: 'outlets', branding: 'branding-settings', settings: 'system-settings', financeSecurity: 'finance-security', activity: 'activity-logs' };
    return `${base}/${paths[page] || 'dashboard'}`;
  }
  if (role === 'FINANCE') return `${base}/finance`;
  if (role === 'WAREHOUSE' && page === 'finance') return `${base}/finance`;
  if (page === 'dashboard') return `${base}/dashboard`;
  if (role === 'WAREHOUSE') {
    if (page === 'inventory-opname') return `${base}/inventory/stock-opname`;
    if (page === 'inventory-vendors') return `${base}/inventory/vendors`;
    if (page === 'inventory-catalog') return `${base}/inventory/katalog`;
    return `${base}/${page === 'requests' ? 'request' : page === 'history' ? 'riwayat' : page}`;
  }
  return `${base}/${page === 'request' ? 'request' : page === 'history' ? 'riwayat' : page}`;
};

const legacyPath = (pathname: string, role: string) => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return pagePath(role, 'dashboard');
  if (path === '/dashboard') return pagePath(role, 'dashboard');
  if (path === '/finance' || path === '/finance/dashboard') {
    if (role === 'ADMIN') return '/admin/monitoring/finance';
    if (role === 'WAREHOUSE' || role === 'FINANCE') return '/warehouse/finance';
    return pagePath(role, 'dashboard');
  }
  if (role === 'WAREHOUSE' && path === '/inventory') return pagePath(role, 'inventory');
  if (role === 'WAREHOUSE' && path === '/requests') return pagePath(role, 'requests');
  if (path === '/history') return pagePath(role, 'history');
  if (path === '/request' && role !== 'WAREHOUSE') return pagePath(role, 'request');
  return path;
};

const tabForPath = (pathname: string, role: string) => {
  if (role === 'ADMIN') {
    if (pathname === '/admin/users') return 'users';
    if (pathname === '/admin/outlets') return 'outlets';
    if (pathname === '/admin/branding-settings') return 'branding';
    if (pathname === '/admin/system-settings') return 'settings';
    if (pathname === '/admin/finance-security') return 'financeSecurity';
    if (pathname === '/admin/activity-logs') return 'activity';
    return 'dashboard';
  }
  if (role === 'FINANCE') return 'finance';
  if (pathname.endsWith('/dashboard')) return 'dashboard';
  if (role === 'WAREHOUSE') {
    if (pathname === '/warehouse/finance') return 'finance';
    if (pathname.includes('/inventory')) return 'inventory';
    if (/\/request(?:\/\d+)?$/.test(pathname)) return 'requests';
    if (pathname.endsWith('/riwayat')) return 'history';
  } else {
    if (/\/request(?:\/\d+)?$/.test(pathname)) return 'request';
    if (pathname.endsWith('/riwayat')) return 'history';
  }
  return 'dashboard';
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('inventory_app_user');
      if (saved) {
        const user = JSON.parse(saved) as User & { role: string };
        return { ...user, role: normalizeRole(user.role) } as User;
      }
    } catch {}
    return null;
  });

  const [pathname, setPathname] = useState(() => window.location.pathname);

  const navigateTo = (path: string, replace = false) => {
    if (window.location.pathname !== path) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    }
    setPathname(path);
  };

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('inventory_app_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('inventory_app_user');
    }
  }, [currentUser]);

  const routeRole = currentUser?.role || 'OUTLET';
  const canonicalPath = legacyPath(pathname, routeRole);
  const routeAllowed = routeRole === 'ADMIN'
    ? /^\/admin\/(?:dashboard|users|outlets|branding-settings|system-settings|finance-security|activity-logs|monitoring\/(?:warehouse|outlet|finance))$/.test(canonicalPath)
    : routeRole === 'WAREHOUSE'
    ? /^\/warehouse\/(?:dashboard|inventory(?:\/(?:stock-opname|vendors|katalog))?|request(?:\/\d+)?|riwayat|finance)$/.test(canonicalPath)
    : routeRole === 'FINANCE'
      ? canonicalPath === '/warehouse/finance'
      : /^\/outlet\/(?:dashboard|request|riwayat)$/.test(canonicalPath);

  useEffect(() => {
    if (!currentUser) {
      const authPath = ['/login', '/register', '/forgot-password'].includes(pathname) ? pathname : '/login';
      if (authPath !== pathname) navigateTo(authPath, true);
      return;
    }
    if (!routeAllowed || canonicalPath !== pathname) {
      navigateTo(routeAllowed ? canonicalPath : pagePath(currentUser.role, 'dashboard'), true);
    }
  }, [canonicalPath, currentUser, pathname, routeAllowed]);

  const handleLoginSuccess = (user: User) => {
    const normalizedUser = { ...user, role: normalizeRole(user.role as string) } as User;
    setCurrentUser(normalizedUser);
    navigateTo(pagePath(normalizedUser.role, 'dashboard'), true);
  };

  const handleLogout = () => {
    if (currentUser?.role === 'WAREHOUSE') {
      const credentials = currentUser as User & { password?: string };
      void fetch('/api/finance/access/logout', { method: 'POST', headers: { 'X-Auth-Email': currentUser.email, 'X-Auth-Password': credentials.password || '' } }).catch(() => undefined);
    }
    setCurrentUser(null);
    navigateTo('/', true);
  };

  if (!currentUser) {
    if (pathname === '/register') {
      return (
        <RegisterPage
          onRegisterSuccess={handleLoginSuccess}
          onNavigateToLogin={() => navigateTo('/login')}
        />
      );
    }
    if (pathname === '/forgot-password') {
      return <ForgotPasswordPage onNavigateToLogin={() => navigateTo('/login')} />;
    }
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        onNavigateToRegister={() => navigateTo('/register')}
        onNavigateToForgotPassword={() => navigateTo('/forgot-password')}
      />
    );
  }

  const isWarehouse = currentUser.role === 'WAREHOUSE';
  const isFinance = currentUser.role === 'FINANCE';
  const isAdmin = currentUser.role === 'ADMIN';

  const activeTab = tabForPath(canonicalPath, currentUser.role);
  const navigatePage = (page: string) => navigateTo(pagePath(currentUser.role, page));
  const inventorySection = canonicalPath.endsWith('/stock-opname') ? 'opname'
    : canonicalPath.endsWith('/vendors') ? 'vendors'
      : canonicalPath.endsWith('/katalog') ? 'katalog' : 'stok';
  const requestDetailId = isWarehouse ? Number(canonicalPath.match(/^\/warehouse\/request\/(\d+)$/)?.[1] || 0) || null : null;

  return (
      <Navbar
        currentUser={currentUser}
        activeNav={activeTab}
        onNavigate={(tab) => navigatePage(tab)}
        onLogout={handleLogout}
      >
        {/* User Screens */}
        {!isWarehouse && !isFinance && (
          <>
            {activeTab === 'dashboard' && (
              <UserDashboard
                currentUser={currentUser}
                onNavigateToRequest={() => navigatePage('request')}
                onNavigateToHistory={() => navigatePage('history')}
              />
            )}
            {activeTab === 'request' && (
              <UserRequestForm
                currentUser={currentUser}
                onSuccess={() => navigatePage('dashboard')}
              />
            )}
            {activeTab === 'history' && <UserRiwayat currentUser={currentUser} />}
          </>
        )}

        {/* Warehouse Screens */}
        {isWarehouse && (
          <>
            {activeTab === 'dashboard' && <WarehouseOperationalDashboard currentUser={currentUser} />}
            {activeTab === 'inventory' && <WarehouseInventory currentUser={currentUser} activeSection={inventorySection} onSectionChange={(section) => navigatePage(section === 'opname' ? 'inventory-opname' : section === 'vendors' ? 'inventory-vendors' : section === 'katalog' ? 'inventory-catalog' : 'inventory')} />}
            {activeTab === 'requests' && <WarehouseRequests requestDetailId={requestDetailId} onRequestDetailChange={(id) => navigateTo(id ? `/warehouse/request/${id}` : '/warehouse/request')} />}
            {activeTab === 'history' && <WarehouseHistory />}
            {activeTab === 'finance' && <FinanceAccessGate currentUser={currentUser} onBack={() => navigatePage('dashboard')}><WarehouseDashboard currentUser={currentUser} /></FinanceAccessGate>}
          </>
        )}
        {isFinance && activeTab === 'finance' && <WarehouseDashboard currentUser={currentUser} />}
        {isAdmin && <AdminWorkspace currentUser={currentUser} activeTab={activeTab} pathname={canonicalPath} onNavigate={navigatePage} onNavigatePath={(path) => navigateTo(path)} />}
      </Navbar>
  );
}
