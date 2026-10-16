import React, { useState } from 'react';
import { ArrowRight, AlertCircle, Eye, EyeOff, LogIn } from 'lucide-react';
import { User } from '../../types.ts';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
  onNavigateToRegister: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  onNavigateToRegister,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        throw new Error('Server mengembalikan respon tidak valid. Pastikan server dev aktif.');
      }

      if (!res.ok) {
        throw new Error(data.error || 'Email atau password salah');
      }

      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'Login gagal, silakan periksa email dan password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center py-10 sm:px-6 lg:px-8">
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#ED002B] to-[#ff4d6d] flex items-center justify-center text-white font-black text-2xl shadow-md shadow-red-200">
          HD
        </div>
        <h2 className="mt-4 text-2xl font-black text-[#17233D] tracking-tight">
          Masuk ke Sistem
        </h2>
        <p className="mt-1 text-sm text-[#60708C]">
          HD Warehouse &amp; Inventory Management
        </p>
      </div>

      <div className="mt-7 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-9 rounded-[28px] border border-[#DDE5F0] shadow-sm space-y-5">
          {error && (
            <div className="p-3 bg-[#FDE8EC] border border-[#F8B6C2] rounded-2xl text-xs font-semibold text-[#ED002B] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#334155] mb-1">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@perusahaan.com"
                className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-[#DDE5F0] rounded-xl text-sm text-[#17233D] outline-none focus:border-[#ED002B] focus:bg-white transition-all font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#334155] mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 pr-10 bg-[#F8FAFC] border border-[#DDE5F0] rounded-xl text-sm text-[#17233D] outline-none focus:border-[#ED002B] focus:bg-white transition-all font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-[#ED002B] hover:bg-[#d60027] text-white font-bold text-sm rounded-2xl shadow-sm transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <span>{loading ? 'Memeriksa...' : 'Masuk ke Sistem'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Navigation to Register */}
          <div className="pt-2 text-center border-t border-[#F1F5F9]">
            <p className="text-xs text-[#64748B]">
              Belum memiliki akun?{' '}
              <button
                type="button"
                id="link-to-register"
                onClick={onNavigateToRegister}
                className="font-bold text-[#ED002B] hover:underline cursor-pointer"
              >
                Daftar di sini
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
