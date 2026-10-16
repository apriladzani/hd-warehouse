import React, { useState } from 'react';
import { ArrowRight, AlertCircle, Eye, EyeOff, UserCheck, Warehouse, CheckCircle2 } from 'lucide-react';
import { Role, User } from '../../types.ts';

interface RegisterPageProps {
  onRegisterSuccess: (user: User) => void;
  onNavigateToLogin: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onRegisterSuccess,
  onNavigateToLogin,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('OUTLET');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
        }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        throw new Error('Server mengembalikan respon tidak valid (Status ' + res.status + '). Pastikan server dev aktif/direstart.');
      }

      if (!res.ok) {
        throw new Error(data.error || 'Pendaftaran gagal');
      }

      setSuccessMsg('Akun berhasil didaftarkan! Mengalihkan ke sistem...');
      setTimeout(() => {
        onRegisterSuccess(data.user);
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Gagal mendaftar akun.');
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
          Buat Akun Baru
        </h2>
        <p className="mt-1 text-sm text-[#60708C]">
          Daftarkan akun untuk mengakses sistem inventaris HD
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

          {successMsg && (
            <div className="p-3 bg-[#EAF8F1] border border-[#A7E2C7] rounded-2xl text-xs font-semibold text-[#1B9357] flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#334155] mb-1">
                Nama Lengkap
              </label>
              <input
                id="reg-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: April Adzania"
                className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-[#DDE5F0] rounded-xl text-sm text-[#17233D] outline-none focus:border-[#ED002B] focus:bg-white transition-all font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#334155] mb-1">
                Email
              </label>
              <input
                id="reg-email"
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
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
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

            <div>
              <label className="block text-xs font-bold text-[#334155] mb-1.5">
                Peran Akun (Role)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col items-center text-center ${
                    role === 'OUTLET'
                      ? 'border-[#16A34A] bg-[#F0FDF4] text-[#166534]'
                      : 'border-[#DDE5F0] bg-[#F8FAFC] text-[#64748B] hover:bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value="OUTLET"
                    checked={role === 'OUTLET'}
                    onChange={() => setRole('OUTLET')}
                    className="sr-only"
                  />
                  <UserCheck className="w-5 h-5 mb-1 text-[#16A34A]" />
                  <span className="text-xs font-bold">Outlet</span>
                  <span className="text-[10px] text-[#64748B]">Pemohon Barang</span>
                </label>

                <label
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col items-center text-center ${
                    role === 'WAREHOUSE'
                      ? 'border-[#ED002B] bg-[#FFF1F2] text-[#9F1239]'
                      : 'border-[#DDE5F0] bg-[#F8FAFC] text-[#64748B] hover:bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value="WAREHOUSE"
                    checked={role === 'WAREHOUSE'}
                    onChange={() => setRole('WAREHOUSE')}
                    className="sr-only"
                  />
                  <Warehouse className="w-5 h-5 mb-1 text-[#ED002B]" />
                  <span className="text-xs font-bold">Staff Gudang</span>
                  <span className="text-[10px] text-[#64748B]">Kelola Stok &amp; Approval</span>
                </label>
              </div>
            </div>

            <button
              id="btn-register-submit"
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-[#ED002B] hover:bg-[#d60027] text-white font-bold text-sm rounded-2xl shadow-sm transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <span>{loading ? 'Mendaftarkan...' : 'Daftar & Masuk ke Sistem'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Navigation back to login */}
          <div className="pt-2 text-center border-t border-[#F1F5F9]">
            <p className="text-xs text-[#64748B]">
              Sudah memiliki akun?{' '}
              <button
                type="button"
                id="link-to-login"
                onClick={onNavigateToLogin}
                className="font-bold text-[#ED002B] hover:underline cursor-pointer"
              >
                Masuk di sini
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
