import React, { useState, useEffect } from 'react';
import { User } from './types.ts';
import {
  Navbar,
  LoginPage,
  RegisterPage,
  UserDashboard,
  UserRequestForm,
  UserRiwayat,
  WarehouseDashboard,
  WarehouseInventory,
  WarehouseRequests,
  WarehouseHistory,
} from './components/index.ts';

// Default initial user for instant seamless preview
const DEFAULT_USER: User = {
  id: 1,
  name: 'April Adzania',
  email: 'april.adzania@gmail.com',
  role: 'OUTLET',
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('inventory_app_user');
      if (saved) {
        const user = JSON.parse(saved) as User & { role: string };
        return { ...user, role: user.role.toUpperCase() === 'USER' ? 'OUTLET' : user.role } as User;
      }
    } catch {}
    return null;
  });

  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('inventory_app_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('inventory_app_user');
    }
  }, [currentUser]);

  const handleLoginSuccess = (user: User) => {
    setCurrentUser({ ...user, role: (user.role as string).toUpperCase() === 'USER' ? 'OUTLET' : user.role } as User);
    setActiveTab('dashboard');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthView('login');
  };

  if (!currentUser) {
    if (authView === 'register') {
      return (
        <RegisterPage
          onRegisterSuccess={handleLoginSuccess}
          onNavigateToLogin={() => setAuthView('login')}
        />
      );
    }
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        onNavigateToRegister={() => setAuthView('register')}
      />
    );
  }

  const isWarehouse = currentUser.role === 'WAREHOUSE';

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#17233D] flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        currentUser={currentUser}
        activeNav={activeTab}
        onNavigate={(tab) => setActiveTab(tab)}
        onLogout={handleLogout}
      />

      {/* Main App Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-4 pb-28 md:py-8">
        {/* User Screens */}
        {!isWarehouse && (
          <>
            {activeTab === 'dashboard' && (
              <UserDashboard
                currentUser={currentUser}
                onNavigateToRequest={() => setActiveTab('request')}
                onNavigateToHistory={() => setActiveTab('history')}
              />
            )}
            {activeTab === 'request' && (
              <UserRequestForm
                currentUser={currentUser}
                onSuccess={() => setActiveTab('dashboard')}
              />
            )}
            {activeTab === 'history' && <UserRiwayat currentUser={currentUser} />}
          </>
        )}

        {/* Warehouse Screens */}
        {isWarehouse && (
          <>
            {activeTab === 'dashboard' && <WarehouseDashboard />}
            {activeTab === 'inventory' && <WarehouseInventory />}
            {activeTab === 'requests' && <WarehouseRequests />}
            {activeTab === 'history' && <WarehouseHistory />}
          </>
        )}
      </main>
    </div>
  );
}
