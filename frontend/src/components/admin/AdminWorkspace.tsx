import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Boxes, CircleAlert, ImagePlus, Package, Pencil, Plus, RotateCcw, Save, ShieldCheck, ShoppingCart, Store, Trash2, Users, X } from 'lucide-react';
import type { Outlet, User } from '../../types.ts';
import { KpiCard, StateMessage } from '../common/UI.tsx';
import { formatDateIndo, formatRupiah } from '../../lib/format.ts';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { useBranding, type BrandingConfig, type SystemConfig } from '../common/BrandingContext.tsx';

type AdminWorkspaceProps = {
  currentUser: User;
  activeTab: string;
  pathname: string;
  onNavigate: (page: string) => void;
  onNavigatePath: (path: string) => void;
};

type AdminOverview = {
  totals: { activeAccounts: number; outlets: number; items: number; requests: number; pendingRequests: number };
  recentActivity: Array<{ id: string; type: string; reference: string; description: string; date: string; status: string }>;
};

type ManagedOutlet = Outlet & { assignedUsers: number; requestCount: number; users: Array<{ id: number; name: string; email: string; isActive: boolean }> };
type FinanceSecurityStatus = { configured: boolean; updatedAt: string | null; updatedByName: string | null };

const emptyOverview: AdminOverview = {
  totals: { activeAccounts: 0, outlets: 0, items: 0, requests: 0, pendingRequests: 0 }, recentActivity: [],
};

export const AdminWorkspace: React.FC<AdminWorkspaceProps> = ({ currentUser, activeTab, pathname, onNavigate, onNavigatePath }) => {
  const [overview, setOverview] = useState<AdminOverview>(emptyOverview);
  const [users, setUsers] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<ManagedOutlet[]>([]);
  const [monitoring, setMonitoring] = useState<any>(null);
  const [appConfig, setAppConfig] = useState<{ branding: BrandingConfig; system: SystemConfig } | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [financeSecurity, setFinanceSecurity] = useState<FinanceSecurityStatus>({ configured: false, updatedAt: null, updatedByName: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const monitorType = pathname.match(/^\/admin\/monitoring\/(warehouse|outlet|finance)$/)?.[1] || '';
  const credentials = currentUser as User & { password?: string };
  const brandingContext = useBranding();
  const headers = useMemo(() => ({
    'X-Auth-Email': currentUser.email,
    'X-Auth-Password': credentials.password || '',
  }), [currentUser.email, credentials.password]);

  useEffect(() => {
    let cancelled = false;
    const load = async (endpoint: string) => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(endpoint, { headers });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Data administrasi tidak dapat dimuat.');
        if (!cancelled) return result;
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Terjadi kesalahan saat memuat data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
      return null;
    };

    const run = async () => {
      setMonitoring(null);
      if (activeTab === 'dashboard') {
        const result = await load('/api/admin/overview');
        if (result && !cancelled) setOverview(result);
      } else if (activeTab === 'activity') {
        const result = await load('/api/admin/activity-logs');
        if (result && !cancelled) setAuditLogs(result.logs || []);
      } else if (activeTab === 'users') {
        const [userResult, outletResult] = await Promise.all([load('/api/admin/users'), load('/api/outlets')]);
        if (userResult && !cancelled) setUsers(userResult.users || []);
        if (outletResult && !cancelled) setOutlets((outletResult.outlets || []).map((outlet: Outlet) => ({ ...outlet, assignedUsers: 0, requestCount: 0, users: [] })));
      } else if (activeTab === 'outlets') {
        const result = await load('/api/admin/outlets');
        if (result && !cancelled) {
          setOutlets(result.outlets || []);
          setUsers(result.assignments || []);
        }
      } else if (monitorType) {
        const result = await load(`/api/admin/monitoring/${monitorType}`);
        if (result && !cancelled) setMonitoring(result);
      } else if (activeTab === 'settings' || activeTab === 'branding') {
        const result = await load('/api/admin/settings');
        if (result && !cancelled) setAppConfig(result);
      } else if (activeTab === 'financeSecurity') {
        const result = await load('/api/admin/finance-security');
        if (result && !cancelled) setFinanceSecurity(result);
      } else {
        setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [activeTab, headers, monitorType, refreshToken]);

  const title = monitorType === 'warehouse' ? 'Monitoring Warehouse'
    : monitorType === 'outlet' ? 'Monitoring Transaksi Outlet'
      : monitorType === 'finance' ? 'Laporan Finance'
        : ({ dashboard: 'Admin Overview', users: 'User Management', outlets: 'Outlet Management', branding: 'Branding Settings', settings: 'System Settings', financeSecurity: 'Finance Security', activity: 'Activity Logs' } as Record<string, string>)[activeTab] || 'Admin Overview';

  const goMonitor = (type: 'warehouse' | 'outlet' | 'finance') => onNavigatePath(`/admin/monitoring/${type}`);

  return (
    <div className="hd-admin-workspace space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {monitorType && <button type="button" onClick={() => onNavigate('dashboard')} className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-[#1E293B]"><ArrowLeft size={14} /> Kembali ke Overview</button>}
          <h1>{title}</h1>
          <p className="mt-1 text-xs text-[#64748B]">Pemantauan HD Management System berbasis data aktual.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#64748B]"><ShieldCheck size={14} /> Akses Admin</span>
      </header>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>}
      {loading && <StateMessage kind="loading">Memuat data...</StateMessage>}

      {!loading && !error && activeTab === 'dashboard' && !monitorType && (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-5" aria-label="Ringkasan sistem">
            <KpiCard label="Total Akun Aktif" value={overview.totals.activeAccounts} icon={Users} />
            <KpiCard label="Total Outlet" value={overview.totals.outlets} icon={Store} />
            <KpiCard label="Total Barang" value={overview.totals.items} icon={Boxes} />
            <KpiCard label="Total Request" value={overview.totals.requests} icon={Package} />
            <KpiCard label="Request Pending" value={overview.totals.pendingRequests} icon={CircleAlert} tone="warning" />
          </section>

          <section className="hd-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-3 py-2.5 sm:px-4">
              <div><h2>Aktivitas Sistem Terbaru</h2><p className="mt-0.5 text-[11px] text-[#64748B]">Aktivitas transaksi dari data yang tersimpan.</p></div>
              <button type="button" onClick={() => onNavigate('activity')} className="inline-flex items-center gap-1 text-xs font-semibold text-[#475569]">Semua Aktivitas <ArrowRight size={14} /></button>
            </div>
            {overview.recentActivity.length ? <div className="divide-y divide-[#E2E8F0]">
              {overview.recentActivity.slice(0, 5).map((activity) => <div key={activity.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#F8FAFC] text-[#64748B]">{activity.type === 'Penerimaan Barang' ? <Boxes size={16} /> : <ShoppingCart size={16} />}</span><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#1E293B]">{activity.type} · {activity.reference}</p><p className="truncate text-[11px] text-[#64748B]">{activity.description}</p></div></div>
                <div className="shrink-0 text-right"><p className="text-[11px] text-[#64748B]">{formatDateIndo(activity.date)}</p><StatusBadge status={activity.status} /></div>
              </div>)}
            </div> : <StateMessage>Belum ada aktivitas transaksi.</StateMessage>}
          </section>

          <section>
            <h2 className="mb-2">Monitoring Read-only</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <MonitorLink icon={<Boxes size={17} />} title="Operasional Warehouse" description="Stok dan penerimaan barang" onClick={() => goMonitor('warehouse')} />
              <MonitorLink icon={<Store size={17} />} title="Transaksi Outlet" description="Request dan transaksi yang disetujui" onClick={() => goMonitor('outlet')} />
              <MonitorLink icon={<Activity size={17} />} title="Laporan Finance" description="Pembelian, penjualan, dan keuntungan" onClick={() => goMonitor('finance')} />
            </div>
          </section>
        </>
      )}

      {!loading && !error && activeTab === 'users' && <UserManagementPanel users={users} outlets={outlets} headers={headers} currentUserId={currentUser.id} onRefresh={() => setRefreshToken((value) => value + 1)} />}

      {!loading && !error && activeTab === 'outlets' && <OutletManagementPanel outlets={outlets} headers={headers} onRefresh={() => setRefreshToken((value) => value + 1)} />}

      {!loading && !error && activeTab === 'branding' && appConfig && <BrandingSettingsEditor branding={appConfig.branding} headers={headers} onSaved={(next) => { setAppConfig((old) => old ? { ...old, branding: next } : old); brandingContext.setConfig({ branding: next }); window.dispatchEvent(new Event('hd-config-updated')); }} />}

      {!loading && !error && activeTab === 'settings' && appConfig && <SystemSettingsEditor system={appConfig.system} headers={headers} onSaved={(next) => { setAppConfig((old) => old ? { ...old, system: next } : old); brandingContext.setConfig({ branding: appConfig.branding, system: next }); window.dispatchEvent(new Event('hd-config-updated')); }} />}

      {!loading && !error && activeTab === 'financeSecurity' && <FinanceSecurityPanel status={financeSecurity} headers={headers} onSaved={setFinanceSecurity} />}

      {!loading && !error && activeTab === 'activity' && !monitorType && <AdminActivityTable logs={auditLogs} />}

      {!loading && !error && monitorType === 'warehouse' && <WarehouseMonitor data={monitoring} />}
      {!loading && !error && monitorType === 'outlet' && <OutletMonitor data={monitoring} />}
      {!loading && !error && monitorType === 'finance' && <FinanceMonitor data={monitoring} />}
    </div>
  );
};

function MonitorLink({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="hd-surface flex min-w-0 items-center gap-3 p-3 text-left transition-colors hover:border-[#CBD5E1]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F8FAFC] text-[#64748B]">{icon}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-[#1E293B]">{title}</strong><small className="mt-0.5 block truncate text-[11px] text-[#64748B]">{description}</small></span><ArrowRight size={15} className="shrink-0 text-[#94A3B8]" /></button>;
}

type ManagedUser = User & { username: string; createdAt?: string | Date | null; isActive: boolean; outletId: number | null; outletName?: string | null };

function UserManagementPanel({ users, outlets, headers, currentUserId, onRefresh }: { users: ManagedUser[]; outlets: Outlet[]; headers: Record<string, string>; currentUserId: number; onRefresh: () => void }) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [outletFilter, setOutletFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [editing, setEditing] = useState<ManagedUser | null | 'new'>(null);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', role: 'OUTLET', outletId: '', isActive: true });

  const filtered = users.filter((user) => {
    const query = search.trim().toLowerCase();
    return (!query || `${user.name} ${user.username} ${user.email}`.toLowerCase().includes(query))
      && (roleFilter === 'all' || user.role.toUpperCase() === roleFilter)
      && (outletFilter === 'all' || (outletFilter === 'unassigned' ? !user.outletId : String(user.outletId || '') === outletFilter))
      && (statusFilter === 'all' || (statusFilter === 'active' ? user.isActive : !user.isActive));
  });

  const openNew = () => { setForm({ name: '', username: '', email: '', password: '', role: 'OUTLET', outletId: '', isActive: true }); setEditing('new'); };
  const openEdit = (user: ManagedUser) => { setForm({ name: user.name, username: user.username, email: user.email, password: '', role: user.role.toUpperCase(), outletId: user.outletId ? String(user.outletId) : '', isActive: user.isActive }); setEditing(user); };
  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.role === 'OUTLET' && !form.outletId) { setFeedback('Pilih outlet untuk akun dengan role Outlet.'); return; }
    setSaving(true);
    setFeedback('');
    try {
      const isNew = editing === 'new';
      const url = isNew ? '/api/admin/users' : `/api/admin/users/${(editing as ManagedUser).id}`;
      const payload = { ...form, outletId: form.role === 'OUTLET' ? Number(form.outletId) : null, ...(form.password ? {} : { password: undefined }) };
      const response = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Gagal menyimpan akun.');
      setFeedback(isNew ? 'Akun baru berhasil ditambahkan.' : `Perubahan untuk ${form.name} berhasil disimpan.`);
      setEditing(null);
      onRefresh();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Gagal menyimpan akun.');
    } finally { setSaving(false); }
  };

  const deleteUser = async (user: ManagedUser) => {
    setFeedback('');
    setDeleteError('');
    setDeletingBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE', headers });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Gagal menghapus akun.');
      setFeedback(result.mode === 'deactivated' ? `Akun ${user.name} dinonaktifkan karena memiliki riwayat atau relasi data.` : `Akun ${user.name} berhasil dihapus.`);
      setDeleting(null);
      onRefresh();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Gagal menghapus akun.');
    } finally { setDeletingBusy(false); }
  };

  return <div className="space-y-3">
    <section className="hd-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] px-3 py-2.5 sm:px-4"><div><h2>User Management</h2><p className="mt-0.5 text-[11px] text-[#64748B]">{users.length} akun · perubahan disimpan secara eksplisit.</p></div><button type="button" onClick={openNew} className="hd-button hd-button--primary"><Plus size={15} />Tambah Akun</button></div>
      <div className="grid gap-2 border-b border-[#E2E8F0] bg-white p-3 sm:grid-cols-2 xl:grid-cols-4">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, username, email" className="hd-input" />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="hd-input"><option value="all">Semua Role</option><RoleOptions /></select>
        <select value={outletFilter} onChange={(event) => setOutletFilter(event.target.value)} className="hd-input"><option value="all">Semua Outlet</option><option value="unassigned">Belum ditempatkan</option><OutletOptions outlets={outlets} /></select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="hd-input"><option value="active">Akun Aktif</option><option value="inactive">Akun Nonaktif</option><option value="all">Semua Status</option></select>
      </div>
      {feedback && <p role="status" className="border-b border-[#E2E8F0] px-3 py-2 text-xs text-[#475569] sm:px-4">{feedback}</p>}
      {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left"><thead><tr>{['Nama', 'Username', 'Email', 'Role', 'Outlet', 'Status', 'Aksi'].map((column) => <th key={column} className="px-3">{column}</th>)}</tr></thead><tbody>{filtered.map((user) => <tr key={user.id}><td className="px-3 font-medium">{user.name}</td><td className="px-3">{user.username}</td><td className="px-3">{user.email}</td><td className="px-3">{user.role}</td><td className="px-3">{user.outletName || '—'}</td><td className="px-3"><span className={`hd-badge ${user.isActive ? '' : 'hd-badge--danger'}`}>{user.isActive ? 'Aktif' : 'Nonaktif'}</span></td><td className="px-3"><div className="flex gap-1"><button type="button" onClick={() => openEdit(user)} className="hd-button hd-button--secondary" aria-label={`Edit ${user.name}`}><Pencil size={14} />Edit</button>{user.id !== currentUserId && <button type="button" onClick={() => { setDeleteError(''); setDeleting(user); }} className="hd-button hd-button--secondary text-rose-700" aria-label={`Hapus ${user.name}`}><Trash2 size={14} />Hapus</button>}</div></td></tr>)}</tbody></table></div> : <StateMessage>Tidak ada pengguna yang cocok dengan filter.</StateMessage>}
    </section>
    {deleting && <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/45 p-3" onMouseDown={(event) => { if (!deletingBusy && event.target === event.currentTarget) setDeleting(null); }}><section role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title" aria-describedby="delete-user-description" className="hd-surface w-full max-w-md p-4 shadow-xl"><header className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-700"><Trash2 size={17} /></span><div><h2 id="delete-user-title">Hapus akun pengguna?</h2><p id="delete-user-description" className="mt-1 text-xs leading-5 text-[#64748B]">Akun <strong className="text-[#1E293B]">{deleting.name}</strong> akan dihapus jika tidak memiliki riwayat. Jika memiliki request, activity log, atau relasi data, akun akan dinonaktifkan agar riwayat tetap tersimpan.</p></div></header>{deleteError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{deleteError}</p>}<footer className="mt-4 flex justify-end gap-2"><button type="button" disabled={deletingBusy} onClick={() => setDeleting(null)} className="hd-button hd-button--secondary">Batal</button><button type="button" disabled={deletingBusy} onClick={() => void deleteUser(deleting)} className="hd-button hd-button--primary"><Trash2 size={14} />{deletingBusy ? 'Memproses…' : 'Hapus akun'}</button></footer></section></div>}
    {editing && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section role="dialog" aria-modal="true" aria-labelledby="user-editor-title" className="hd-surface max-h-[92dvh] w-full max-w-xl overflow-y-auto p-4 shadow-xl"><header className="mb-3 flex items-start justify-between"><div><h2 id="user-editor-title">{editing === 'new' ? 'Tambah Akun' : 'Edit Pengguna'}</h2><p className="mt-1 text-[11px] text-[#64748B]">Data akun, akses, dan penempatan.</p></div><button type="button" className="hd-icon-button" aria-label="Tutup" onClick={() => setEditing(null)}><X size={17} /></button></header><form onSubmit={saveUser} className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-[#475569]">Nama<input required value={form.name} onChange={(event) => setForm((old) => ({ ...old, name: event.target.value }))} className="hd-input mt-1" /></label><label className="text-xs font-medium text-[#475569]">Username<input required minLength={3} maxLength={100} pattern="[A-Za-z0-9._-]+" value={form.username} onChange={(event) => setForm((old) => ({ ...old, username: event.target.value }))} className="hd-input mt-1" /></label><label className="text-xs font-medium text-[#475569]">Email<input required type="email" value={form.email} onChange={(event) => setForm((old) => ({ ...old, email: event.target.value }))} className="hd-input mt-1" /></label><label className="text-xs font-medium text-[#475569]">Password {editing !== 'new' && <span className="font-normal text-[#64748B]">(kosongkan bila tidak diubah)</span>}<input type="password" required={editing === 'new'} minLength={6} autoComplete="new-password" value={form.password} onChange={(event) => setForm((old) => ({ ...old, password: event.target.value }))} className="hd-input mt-1" /></label><label className="text-xs font-medium text-[#475569]">Role<select value={form.role} onChange={(event) => setForm((old) => ({ ...old, role: event.target.value, outletId: '' }))} className="hd-input mt-1"><RoleOptions /></select></label>{form.role === 'OUTLET' && <label className="text-xs font-medium text-[#475569]">Penempatan Outlet<select required value={form.outletId} onChange={(event) => setForm((old) => ({ ...old, outletId: event.target.value }))} className="hd-input mt-1"><OutletOptions outlets={outlets} /></select></label>}<label className="flex items-center gap-2 text-xs font-medium text-[#475569]"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((old) => ({ ...old, isActive: event.target.checked }))} />Akun aktif</label>{feedback && <p role="alert" className="sm:col-span-2 text-xs text-rose-700">{feedback}</p>}<footer className="flex justify-end gap-2 border-t border-[#E2E8F0] pt-3 sm:col-span-2"><button type="button" onClick={() => setEditing(null)} className="hd-button hd-button--secondary">Batal</button><button type="submit" disabled={saving} className="hd-button hd-button--primary"><Save size={14} />{saving ? 'Menyimpan…' : 'Simpan'}</button></footer></form></section></div>}
  </div>;
}

function RoleOptions() {
  return <>{[['ADMIN', 'Admin'], ['WAREHOUSE', 'Warehouse'], ['FINANCE', 'Finance'], ['OUTLET', 'Outlet']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</>;
}

function OutletOptions({ outlets }: { outlets: Outlet[] }) {
  return <><option value="" disabled>Pilih outlet</option>{outlets.map((outlet) => <option value={String(outlet.id)} key={outlet.id}>{outlet.name}</option>)}</>;
}

type OutletDraft = { code: string; name: string; address: string; isActive: boolean };

function OutletManagementPanel({ outlets, headers, onRefresh }: { outlets: ManagedOutlet[]; headers: Record<string, string>; onRefresh: () => void }) {
  const [drafts, setDrafts] = useState<Record<number, OutletDraft>>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savingNew, setSavingNew] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [createForm, setCreateForm] = useState({ code: '', name: '', address: '' });
  useEffect(() => {
    const next: Record<number, OutletDraft> = {};
    outlets.forEach((outlet) => { next[outlet.id] = { code: outlet.code, name: outlet.name, address: outlet.address || '', isActive: Boolean(outlet.isActive) }; });
    setDrafts(next);
  }, [outlets]);
  const filtered = outlets.filter((outlet) => {
    const draft = drafts[outlet.id] || { code: outlet.code, name: outlet.name, address: outlet.address || '', isActive: Boolean(outlet.isActive) };
    return (!search.trim() || `${draft.code} ${draft.name} ${draft.address}`.toLowerCase().includes(search.trim().toLowerCase()))
      && (status === 'all' || (status === 'active' ? draft.isActive : !draft.isActive));
  });
  const saveOutlet = async (outlet: ManagedOutlet) => {
    const draft = drafts[outlet.id]; if (!draft) return;
    setSavingId(outlet.id); setFeedback('');
    try {
      const response = await fetch(`/api/admin/outlets/${outlet.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Gagal menyimpan outlet.');
      setFeedback(`Perubahan outlet ${draft.name} berhasil disimpan.`); onRefresh();
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Gagal menyimpan outlet.'); }
    finally { setSavingId(null); }
  };
  const createOutlet = async (event: React.FormEvent) => {
    event.preventDefault(); setSavingNew(true); setFeedback('');
    try {
      const response = await fetch('/api/admin/outlets', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(createForm) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Gagal menambahkan outlet.');
      setCreateForm({ code: '', name: '', address: '' }); setShowCreate(false); setFeedback('Outlet baru berhasil ditambahkan.'); onRefresh();
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Gagal menambahkan outlet.'); }
    finally { setSavingNew(false); }
  };
  return <section className="hd-surface overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] px-3 py-2.5 sm:px-4"><div><h2>Outlet Management</h2><p className="mt-0.5 text-[11px] text-[#64748B]">{outlets.length} outlet · outlet bertransaksi dipertahankan untuk riwayat.</p></div><button type="button" onClick={() => setShowCreate((value) => !value)} className="hd-button hd-button--primary"><Plus size={15} />Tambah Outlet</button></div>
    {showCreate && <form onSubmit={createOutlet} className="grid gap-2 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:grid-cols-2 lg:grid-cols-4"><input required value={createForm.code} onChange={(event) => setCreateForm((old) => ({ ...old, code: event.target.value }))} placeholder="Kode outlet (OTL-001)" className="hd-input" /><input required value={createForm.name} onChange={(event) => setCreateForm((old) => ({ ...old, name: event.target.value }))} placeholder="Nama outlet" className="hd-input" /><input value={createForm.address} onChange={(event) => setCreateForm((old) => ({ ...old, address: event.target.value }))} placeholder="Alamat" className="hd-input" /><button disabled={savingNew} className="hd-button hd-button--primary">{savingNew ? 'Menyimpan…' : 'Simpan Outlet'}</button></form>}
    <div className="grid gap-2 border-b border-[#E2E8F0] p-3 sm:grid-cols-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari kode, nama, atau alamat outlet" className="hd-input" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="hd-input"><option value="all">Semua Status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div>
    {feedback && <p role="status" className="border-b border-[#E2E8F0] px-3 py-2 text-xs text-[#475569] sm:px-4">{feedback}</p>}
    {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left"><thead><tr>{['Kode Outlet', 'Nama Outlet', 'Alamat', 'Status', 'Pengguna', 'Aksi'].map((column) => <th key={column} className="px-3">{column}</th>)}</tr></thead><tbody>{filtered.map((outlet) => {
      const draft = drafts[outlet.id] || { code: outlet.code, name: outlet.name, address: outlet.address || '', isActive: Boolean(outlet.isActive) };
      const changed = draft.code !== outlet.code || draft.name !== outlet.name || draft.address !== (outlet.address || '') || draft.isActive !== Boolean(outlet.isActive);
      return <React.Fragment key={outlet.id}><tr>
        <td className="px-3"><input aria-label={`Kode ${outlet.name}`} value={draft.code} onChange={(event) => setDrafts((old) => ({ ...old, [outlet.id]: { ...draft, code: event.target.value } }))} className="hd-input min-w-[130px]" /></td>
        <td className="px-3"><input aria-label={`Nama ${outlet.name}`} value={draft.name} onChange={(event) => setDrafts((old) => ({ ...old, [outlet.id]: { ...draft, name: event.target.value } }))} className="hd-input min-w-[160px]" /></td>
        <td className="px-3"><input aria-label={`Alamat ${outlet.name}`} value={draft.address} onChange={(event) => setDrafts((old) => ({ ...old, [outlet.id]: { ...draft, address: event.target.value } }))} className="hd-input min-w-[190px]" placeholder="Belum diisi" /></td>
        <td className="px-3"><select aria-label={`Status ${outlet.name}`} value={draft.isActive ? 'active' : 'inactive'} onChange={(event) => setDrafts((old) => ({ ...old, [outlet.id]: { ...draft, isActive: event.target.value === 'active' } }))} className="hd-input min-w-[110px]"><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></td>
        <td className="px-3"><button type="button" onClick={() => setExpandedId(expandedId === outlet.id ? null : outlet.id)} className="text-left text-xs font-semibold text-[#475569] hover:text-[#F0002B]">{outlet.assignedUsers} pengguna · {outlet.requestCount} request</button></td>
        <td className="px-3"><button type="button" disabled={!changed || savingId === outlet.id} onClick={() => void saveOutlet(outlet)} className="hd-button hd-button--secondary">{savingId === outlet.id ? 'Menyimpan…' : 'Simpan'}</button></td>
      </tr>{expandedId === outlet.id && <tr><td colSpan={6} className="bg-[#F8FAFC] px-4 py-2.5"><p className="mb-1 text-[11px] font-semibold text-[#64748B]">Pengguna yang ditempatkan</p>{outlet.users.length ? <div className="flex flex-wrap gap-2">{outlet.users.map((user) => <span key={user.id} className="hd-badge">{user.name} · {user.email}{user.isActive ? '' : ' · Nonaktif'}</span>)}</div> : <span className="text-xs text-[#64748B]">Belum ada pengguna yang ditempatkan.</span>}</td></tr>}</React.Fragment>;
    })}</tbody></table></div> : <StateMessage>Tidak ada outlet yang cocok dengan filter.</StateMessage>}
  </section>;
}

function DataTable({ title, description, columns, rows }: { title: string; description: string; columns: string[]; rows: React.ReactNode[][] }) {
  return <section className="hd-surface overflow-hidden"><div className="border-b border-[#E2E8F0] px-3 py-2.5 sm:px-4"><h2>{title}</h2><p className="mt-0.5 text-[11px] text-[#64748B]">{description}</p></div>{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead><tr>{columns.map((column) => <th key={column} className="px-3">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3">{cell}</td>)}</tr>)}</tbody></table></div> : <StateMessage>Tidak ada data untuk ditampilkan.</StateMessage>}</section>;
}

function BrandingSettingsEditor({ branding, headers, onSaved }: { branding: BrandingConfig; headers: Record<string, string>; onSaved: (branding: BrandingConfig) => void }) {
  const [form, setForm] = useState(branding);
  const [files, setFiles] = useState<Partial<Record<'mainLogo' | 'sidebarLogo' | 'favicon', File>>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => { setForm(branding); setFiles({}); }, [branding]);
  const selectFile = (key: 'mainLogo' | 'sidebarLogo' | 'favicon', file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 2 * 1024 * 1024) { setFeedback('Gunakan PNG, JPG, WEBP, atau SVG maksimal 2 MB.'); return; }
    setFiles((old) => ({ ...old, [key]: file })); setForm((old) => ({ ...old, [key]: URL.createObjectURL(file) })); setFeedback('');
  };
  const uploadFile = async (file: File) => {
    const response = await fetch('/api/admin/branding/assets', { method: 'POST', headers: { ...headers, 'Content-Type': file.type }, body: await file.arrayBuffer() });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Gagal mengunggah gambar.');
    return String(result.url);
  };
  const save = async (next: BrandingConfig) => {
    setSaving(true); setFeedback('');
    try {
      const uploaded = { ...next };
      for (const key of ['mainLogo', 'sidebarLogo', 'favicon'] as const) if (files[key]) uploaded[key] = await uploadFile(files[key]!);
      const response = await fetch('/api/admin/branding', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(uploaded) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Gagal menyimpan branding.');
      setFiles({}); setForm(result.branding); onSaved(result.branding); setFeedback('Branding berhasil disimpan dan diterapkan.');
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Gagal menyimpan branding.'); }
    finally { setSaving(false); }
  };
  const reset = () => void save({ appName: 'HD Management System', subtitle: 'Inventory & Operations', mainLogo: '', sidebarLogo: '', favicon: '' });
  const field = (key: 'mainLogo' | 'sidebarLogo' | 'favicon', label: string) => <label key={key} className="hd-surface flex min-w-0 flex-col gap-2 p-3"><span className="text-xs font-semibold text-[#334155]">{label}</span><div className="grid min-h-20 place-items-center rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-2">{form[key] ? <img src={form[key]} alt={`Preview ${label}`} className="max-h-16 max-w-full object-contain" /> : <ImagePlus size={22} className="text-[#94A3B8]" />}</div><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => selectFile(key, event.target.files?.[0])} className="text-[11px] text-[#64748B]" /><small className="text-[10px] text-[#64748B]">PNG, JPG, WEBP, SVG · maks. 2 MB</small></label>;
  return <section className="hd-surface space-y-3 p-3 sm:p-4"><div><h2>Branding Aplikasi</h2><p className="mt-0.5 text-[11px] text-[#64748B]">Konfigurasi ini digunakan bersama oleh halaman autentikasi dan seluruh role.</p></div><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium text-[#475569]">Nama aplikasi<input className="hd-input mt-1" maxLength={120} value={form.appName} onChange={(event) => setForm((old) => ({ ...old, appName: event.target.value }))} /></label><label className="text-xs font-medium text-[#475569]">Subtitle / tagline<input className="hd-input mt-1" maxLength={180} value={form.subtitle} onChange={(event) => setForm((old) => ({ ...old, subtitle: event.target.value }))} /></label></div><div className="grid gap-2 md:grid-cols-3">{field('mainLogo', 'Logo utama aplikasi')}{field('sidebarLogo', 'Logo sidebar / header')}{field('favicon', 'Favicon browser')}</div>{feedback && <p role="status" className="text-xs text-[#475569]">{feedback}</p>}<div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={reset} disabled={saving} className="hd-button hd-button--secondary"><RotateCcw size={14} />Reset ke Default</button><button type="button" onClick={() => void save(form)} disabled={saving} className="hd-button hd-button--primary"><Save size={14} />{saving ? 'Menyimpan…' : 'Simpan Branding'}</button></div></section>;
}

function SystemSettingsEditor({ system, headers, onSaved }: { system: SystemConfig; headers: Record<string, string>; onSaved: (system: SystemConfig) => void }) {
  const [form, setForm] = useState(system);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => setForm(system), [system]);
  const save = async () => {
    setSaving(true); setFeedback('');
    try { const response = await fetch('/api/admin/system-settings', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Gagal menyimpan pengaturan.'); onSaved(result.system); setFeedback('Pengaturan sistem berhasil disimpan.'); }
    catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Gagal menyimpan pengaturan.'); }
    finally { setSaving(false); }
  };
  return <section className="hd-surface space-y-3 p-3 sm:p-4"><div><h2>System Settings</h2><p className="mt-0.5 text-[11px] text-[#64748B]">Pengaturan default organisasi dan format tampilan.</p></div><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium text-[#475569]">Nama sistem<input className="hd-input mt-1" maxLength={120} value={form.systemName} onChange={(event) => setForm((old) => ({ ...old, systemName: event.target.value }))} /></label><label className="text-xs font-medium text-[#475569]">Informasi organisasi<input className="hd-input mt-1" maxLength={500} value={form.organizationInfo} onChange={(event) => setForm((old) => ({ ...old, organizationInfo: event.target.value }))} placeholder="Alamat atau informasi organisasi" /></label><label className="text-xs font-medium text-[#475569]">Format tanggal<select className="hd-input mt-1" value={form.dateFormat} onChange={(event) => setForm((old) => ({ ...old, dateFormat: event.target.value }))}><option value="DD MMM YYYY">22 Okt 2026</option><option value="DD/MM/YYYY">22/10/2026</option><option value="YYYY-MM-DD">2026-10-22</option></select></label><label className="text-xs font-medium text-[#475569]">Zona waktu<select className="hd-input mt-1" value={form.timeZone} onChange={(event) => setForm((old) => ({ ...old, timeZone: event.target.value }))}><option value="Asia/Jakarta">Asia/Jakarta (WIB)</option></select></label><label className="text-xs font-medium text-[#475569]">Mata uang<select className="hd-input mt-1" value={form.currency} onChange={(event) => setForm((old) => ({ ...old, currency: event.target.value }))}><option value="IDR">Rupiah (IDR)</option></select></label></div>{feedback && <p role="status" className="text-xs text-[#475569]">{feedback}</p>}<div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={saving} className="hd-button hd-button--primary"><Save size={14} />{saving ? 'Menyimpan…' : 'Simpan Pengaturan'}</button></div></section>;
}

function AdminActivityTable({ logs }: { logs: any[] }) {
  return <DataTable title="Activity Logs Administrasi" description="Perubahan pengaturan dan akses administratif terbaru." columns={['Waktu', 'Pelaku', 'Aksi', 'Target', 'Rincian']} rows={logs.map((log) => [new Date(log.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), log.actorName, log.action, `${log.targetType}${log.targetId ? ` #${log.targetId}` : ''}`, JSON.stringify(log.details || {})])} />;
}

function WarehouseMonitor({ data }: { data: any }) {
  if (!data) return <StateMessage>Data monitoring belum tersedia.</StateMessage>;
  return <div className="space-y-3"><DataTable title={`Stok Gudang (${data.items?.length || 0} barang)`} description="Snapshot stok sistem yang sama dengan Inventory Warehouse." columns={['Kode', 'Nama Barang', 'Kategori', 'Stok', 'Status']} rows={(data.items || []).map((item: any) => [item.itemCode, item.itemName, item.category, item.currentStock, item.currentStock <= 0 ? 'Habis' : item.currentStock < 10 ? 'Menipis' : 'Tersedia'])} /><DataTable title="Penerimaan Barang" description="Transaksi pembelian dari Warehouse." columns={['Transaksi', 'Tanggal', 'Vendor', 'Jumlah', 'Total']} rows={(data.purchases || []).map((item: any) => [item.transactionCode, formatDateIndo(item.transactionDate), item.vendorName || '—', item.itemCount || 0, formatRupiah(item.totalAmount)])} /></div>;
}

function OutletMonitor({ data }: { data: any }) {
  if (!data) return <StateMessage>Data monitoring belum tersedia.</StateMessage>;
  return <div className="space-y-3"><DataTable title="Request Outlet" description="Semua pengajuan dari Outlet, termasuk status approval." columns={['Request', 'Tanggal', 'Outlet', 'Barang', 'Status']} rows={(data.requests || []).map((item: any) => [item.requestCode, formatDateIndo(item.requestDate), item.requesterName, item.itemCount || 0, <StatusBadge key={item.id} status={item.status} />])} /><DataTable title="Transaksi Outlet Disetujui" description="Hanya permintaan yang memiliki item disetujui." columns={['Request', 'Tanggal', 'Outlet', 'Barang', 'Nilai']} rows={(data.transactions || []).map((item: any) => [item.requestCode, formatDateIndo(item.requestDate), item.requesterName, item.itemCount || 0, formatRupiah(item.totalApprovedAmount)])} /></div>;
}

function FinanceMonitor({ data }: { data: any }) {
  if (!data?.stats) return <StateMessage>Data laporan Finance belum tersedia.</StateMessage>;
  const stats = data.stats;
  return <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><KpiCard label="Total Pembelian" value={formatRupiah(stats.totalPurchaseAmount || 0)} icon={Boxes} /><KpiCard label="Penjualan Outlet" value={formatRupiah(stats.totalSellingAmount || 0)} icon={Store} /><KpiCard label="Contribution Income" value={stats.contributionIncome == null ? 'Data Belum Lengkap' : formatRupiah(stats.contributionIncome)} icon={Activity} /></div><DataTable title="Pembelian per Kategori" description="Rekap berdasarkan transaksi pembelian tersimpan." columns={['Kategori', 'Kode', 'Total Pembelian']} rows={(stats.categoryPurchaseTotals || []).map((item: any) => [item.category, item.code, formatRupiah(item.totalAmount)])} /><DataTable title="COGS per Kategori" description="Biaya pokok dari snapshot harga saat item disetujui." columns={['Kategori', 'Kode', 'COGS']} rows={(stats.cogsByCategory || []).map((item: any) => [item.category, item.code, item.missingCostQuantity ? `Missing Cost Data · ${item.missingCostQuantity} unit` : formatRupiah(item.amount)])} /><p className="text-[11px] text-[#64748B]">Tampilan read-only. Pembelian tersimpan di Warehouse dan tidak langsung menjadi COGS. Penjualan adalah nilai item yang disetujui, bukan kas diterima. {stats.shrinkageUnavailableReason}</p></div>;
}

function FinanceSecurityPanel({ status, headers, onSaved }: { status: FinanceSecurityStatus; headers: Record<string, string>; onSaved: (status: FinanceSecurityStatus) => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setFeedback('');
    if (password.length < 6) return setFeedback('Password Finance minimal 6 karakter.');
    if (password !== confirmPassword) return setFeedback('Konfirmasi password tidak cocok.');
    setSaving(true);
    try {
      const response = await fetch('/api/admin/finance-security', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Gagal menyimpan password Finance.');
      onSaved(data); setPassword(''); setConfirmPassword(''); setFeedback('Password Finance berhasil disimpan. Semua sesi lama telah dicabut.');
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Gagal menyimpan password Finance.'); }
    finally { setSaving(false); }
  };
  const reset = async () => {
    if (!window.confirm('Reset password Finance? Semua akses Finance Warehouse akan langsung dicabut.')) return;
    setSaving(true); setFeedback('');
    try {
      const response = await fetch('/api/admin/finance-security', { method: 'DELETE', headers });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Gagal mereset password Finance.');
      onSaved(data); setPassword(''); setConfirmPassword(''); setFeedback('Password Finance berhasil direset. Atur password baru agar Warehouse dapat membuka Finance.');
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Gagal mereset password Finance.'); }
    finally { setSaving(false); }
  };
  return <section className="hd-surface space-y-3 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2>Finance Security</h2><p className="mt-0.5 text-[11px] text-[#64748B]">Satu password bersama untuk membuka Dashboard Finance dari akun Warehouse.</p></div><span className={`hd-badge ${status.configured ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{status.configured ? 'Configured' : 'Not Configured'}</span></div>
    <dl className="grid gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs sm:grid-cols-2"><div><dt className="text-[11px] text-[#64748B]">Terakhir diubah</dt><dd className="mt-0.5 font-medium text-[#1E293B]">{status.updatedAt ? new Date(status.updatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum pernah'}</dd></div><div><dt className="text-[11px] text-[#64748B]">Diubah oleh Admin</dt><dd className="mt-0.5 font-medium text-[#1E293B]">{status.updatedByName || '—'}</dd></div></dl>
    <form onSubmit={save} className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium text-[#475569]">{status.configured ? 'Password baru' : 'Password Finance'}<input required minLength={6} autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="hd-input mt-1" placeholder="Minimal 6 karakter" /></label><label className="text-xs font-medium text-[#475569]">Konfirmasi password<input required minLength={6} autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="hd-input mt-1" placeholder="Ulangi password" /></label><div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">{status.configured && <button type="button" onClick={() => void reset()} disabled={saving} className="hd-button hd-button--secondary"><RotateCcw size={14} />Reset Password</button>}<button type="submit" disabled={saving || !password || !confirmPassword} className="hd-button hd-button--primary"><Save size={14} />{saving ? 'Menyimpan…' : status.configured ? 'Ubah Password' : 'Set Password'}</button></div></form>
    <p className="text-[11px] text-[#64748B]">Password tidak dapat dilihat kembali. Perubahan akan langsung membatalkan seluruh sesi Finance yang sedang aktif.</p>
    {feedback && <p role="status" className="text-xs text-[#475569]">{feedback}</p>}
  </section>;
}

