import React from 'react';
import { User, LogOut, Layers, FileText, Clock, PackageCheck, Boxes } from 'lucide-react';
import { User as UserType } from '../../types.ts';

interface NavbarProps {
  currentUser: UserType;
  activeNav: string;
  onNavigate: (tab: string) => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeNav,
  onNavigate,
  onLogout,
}) => {
  const isWarehouse = currentUser.role === 'WAREHOUSE';

  const userTabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Layers },
    { id: 'request', label: 'HD Request', icon: FileText },
    { id: 'history', label: 'Riwayat', icon: Clock },
  ];

  const warehouseTabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Layers },
    { id: 'inventory', label: 'Inventory', icon: Boxes },
    { id: 'requests', label: 'Request', icon: PackageCheck },
    { id: 'history', label: 'Riwayat', icon: Clock },
  ];

  const navItems = isWarehouse ? warehouseTabs : userTabs;

  return (
    <>
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#DDE5F0]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Brand Logo & Name */}
            <div className="flex items-center space-x-2 sm:space-x-3">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#ED002B] flex items-center justify-center text-white font-black text-base sm:text-lg shadow-sm shrink-0">
                I
              </div>
              <div>
                <span className="font-bold text-[#17233D] text-sm sm:text-lg tracking-tight block leading-tight">
                  Warehouse &amp; HD
                </span>
                <span className="text-[10px] sm:text-xs text-[#60708C] block -mt-0.5 sm:-mt-1 truncate max-w-[140px] sm:max-w-none">
                  Inventory System
                </span>
              </div>
            </div>

            {/* Nav items for desktop */}
            <nav className="hidden md:flex items-center space-x-1">
              {navItems.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeNav === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`nav-${tab.id}`}
                    onClick={() => onNavigate(tab.id)}
                    className={`flex items-center space-x-2 px-4 py-2 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-[#F8FAFC] text-[#ED002B] border-b-2 border-[#ED002B] rounded-t-lg'
                        : 'text-[#60708C] hover:text-[#17233D] hover:bg-[#F8FAFC] rounded-lg'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* User Profile & Actions */}
            <div className="flex items-center space-x-1.5 sm:space-x-3">
              {/* Role indicator */}
              <div className="flex items-center space-x-1.5 sm:space-x-2 bg-[#F8FAFC] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full border border-[#DDE5F0]">
                <User className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#60708C] shrink-0" />
                <div className="text-left">
                  <span className="text-[11px] sm:text-xs font-bold text-[#17233D] block leading-none truncate max-w-[70px] sm:max-w-[120px]">
                    {currentUser.name}
                  </span>
                  <span className="text-[9px] sm:text-[10px] uppercase font-black text-[#ED002B] tracking-wider block">
                    {currentUser.role === 'WAREHOUSE' ? 'Warehouse' : 'Outlet'}
                  </span>
                </div>
              </div>

              {/* Logout button */}
              <button
                id="logout-btn"
                onClick={onLogout}
                title="Keluar"
                className="p-2 text-[#60708C] hover:text-[#ED002B] hover:bg-[#F8FAFC] rounded-full transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (Fixed for phone experience) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#DDE5F0] px-2 py-1 flex items-center justify-around shadow-[0_-4px_20px_rgba(0,0,0,0.05)] safe-area-inset-bottom"
      >
        {navItems.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeNav === tab.id;
          return (
            <button
              key={tab.id}
              id={`mobile-nav-${tab.id}`}
              onClick={() => {
                onNavigate(tab.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex-1 flex flex-col items-center justify-center py-1.5 px-1 min-h-[48px] rounded-xl transition-all ${
                isActive
                  ? 'text-[#ED002B] font-bold'
                  : 'text-[#60708C] hover:text-[#17233D] font-medium'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  isActive ? 'bg-[#ED002B]/10 text-[#ED002B]' : 'text-[#60708C]'
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-[10px] tracking-tight mt-0.5 leading-none">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
