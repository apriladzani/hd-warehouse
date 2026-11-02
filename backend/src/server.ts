import 'dotenv/config';
import { createAdminSessionAccess } from './finance/adminSessionAccess.ts';
import { dashboardSessionAccess } from './finance/dashboardSessionAccess.ts';
import { pool as operationalPool } from './db/index.ts';
import { mysqlSelectExecutor } from './finance/WarehouseFinanceDataSource.ts';
import { createOperationalSessions } from './finance/operationalSession.ts';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { isMailConfigured, sendPasswordResetEmail } from './mail.ts';
import { finishGoogleSignIn, GoogleSignInError, readGoogleSettings, readStateCookie, startGoogleSignIn } from './googleOAuth.ts';
import {
  authenticateUser,
  getAllUsers,
  getAdminUsers,
  getOutletMaster,
  createManagedOutlet,
  updateManagedOutlet,
  getOutletRequestProfile,
  createManagedUser,
  updateManagedUser,
  deleteManagedUser,
  getApplicationConfig,
  saveApplicationConfig,
  getAdminActivityLogs,
  logAdminActivity,
  getFinanceSecurityStatus,
  getFinancePasswordHash,
  setFinancePasswordHash,
  resetFinancePassword,
  createFinanceAccessSession,
  validateFinanceAccessSession,
  revokeFinanceAccessSession,
  getFinanceAccessLock,
  recordFinanceAccessFailure,
  clearFinanceAccessFailures,
  createPasswordResetToken,
  findPasswordResetToken,
  consumePasswordResetToken,
  PASSWORD_RESET_MINUTES,
  signInWithGoogle,
  DEFAULT_BRANDING,
  DEFAULT_SYSTEM_SETTINGS,
  getInventory,
  createItem,
  createMasterItem,
  updateItem,
  deleteItem,
  createVendor,
  updateVendor,
  deleteVendor,
  getVendors,
  getItemVendors,
  addItemVendor,
  removeItemVendor,
  setItemVendors,
  registerIncomingGoods,
  createRequest,
  getRequests,
  getRequestDetail,
  updateRequestItemStatus,
  approveAllRequestItems,
  getIncomingHistory,
  getOutgoingHistory,
  getUserDashboardStats,
  getWarehouseDashboardStats,
  getFinancePeriods,
  getManualFinanceEntries,
  createManualFinanceEntry,
  voidManualFinanceEntry,
  FINANCE_MANUAL_ACCOUNT_CODES,
  ITEM_CATEGORIES,
  getStockOpnameHistory,
  saveStockOpname,
  pendingRequestsAtClosing,
  recordPeriodCorrection,
  registerHDReceiving,
  registerUser,
} from './db/repository.ts';
import { loadLedger } from './db/periodClosing.ts';
import { createFinanceScope, outletView } from './finance/outletScope.ts';
import type { ItemCategory } from './db/repository.ts';
import { canAccessDashboard, canReadFinanceDashboard } from './dashboardAccess.ts';
import { mountFinanceReadOnly } from './finance/mount.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = Number(
  process.env.BACKEND_PORT ||
  (process.env.PORT && process.env.PORT !== '3000' ? process.env.PORT : 5001)
);
const todayJakarta = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

// A transaction dated in a closed period is a conflict, not a server failure.
const errorStatus = (err: any) => /sudah ditutup\. Gunakan form koreksi\./.test(String(err?.message)) ? 409 : 500;

app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);
const operationalSessions = createOperationalSessions(mysqlSelectExecutor(operationalPool));
const financeReadAuth = mountFinanceReadOnly(app, undefined, operationalSessions);

const getAdminUser = createAdminSessionAccess(operationalSessions.identity);

const publicUser = (user: any) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  email: user.email,
  role: String(user.role || 'OUTLET').toUpperCase(),
  createdAt: user.createdAt || null,
});

// API Routes
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/config', async (_req: Request, res: Response) => {
  try { res.json(await getApplicationConfig()); }
  catch { res.json({ branding: DEFAULT_BRANDING, system: DEFAULT_SYSTEM_SETTINGS }); }
});

// Auth endpoints
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }
    const user = await operationalSessions.login(req, res, email, password);
    if (!user) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    res.json({ user: publicUser(user) });
  } catch (err: any) {
    console.error('[login] gagal:', err?.code, err?.message);
    res.status(503).json({ error: 'Sumber autentikasi operasional tidak tersedia.' });
  }
});

app.post('/api/auth/logout', (req, res) => { operationalSessions.logout(req, res); res.json({ success: true }); });

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nama, email, dan password wajib diisi' });
    }
    const user = await registerUser(name, email, password, role);
    res.json({ user, message: 'Pendaftaran berhasil' });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(400).json({ error: err.message || 'Gagal mendaftar' });
  }
});

// Password reset. The request endpoint answers the same way whether or not the
// account exists, so it cannot be used to find out who has an account here.
const RESET_NEUTRAL_REPLY = {
  message: 'Jika akun dengan data tersebut terdaftar dan aktif, tautan untuk membuat password baru sudah dikirim ke emailnya. Periksa juga folder spam.',
};
const resetAttempts = new Map<string, { count: number; windowStart: number }>();
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX_PER_WINDOW = 5;

const resetRateLimited = (key: string) => {
  const now = Date.now();
  for (const [entry, value] of resetAttempts) if (now - value.windowStart > RESET_WINDOW_MS) resetAttempts.delete(entry);
  const current = resetAttempts.get(key);
  if (!current || now - current.windowStart > RESET_WINDOW_MS) {
    resetAttempts.set(key, { count: 1, windowStart: now });
    return false;
  }
  current.count += 1;
  return current.count > RESET_MAX_PER_WINDOW;
};

app.post('/api/auth/password-reset/request', async (req: Request, res: Response) => {
  try {
    if (!isMailConfigured()) {
      return res.status(503).json({ error: 'Pengiriman email belum dikonfigurasi di server. Hubungi administrator.' });
    }
    const login = typeof req.body?.login === 'string' ? req.body.login : '';
    if (!login.trim()) return res.status(400).json({ error: 'Masukkan username atau email akun Anda.' });
    if (resetRateLimited(`${req.ip}`)) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Tunggu 15 menit, lalu coba lagi.' });
    }
    const created = await createPasswordResetToken(login);
    if (created) {
      try {
        await sendPasswordResetEmail(created.email, created.name, created.token, PASSWORD_RESET_MINUTES);
      } catch (err: any) {
        // A send failure is the server's problem, not a hint about the account.
        console.error('[password-reset] gagal mengirim email:', err?.message);
        return res.status(502).json({ error: 'Email tidak bisa dikirim saat ini. Coba lagi nanti atau hubungi administrator.' });
      }
    }
    res.json(RESET_NEUTRAL_REPLY);
  } catch (err: any) {
    console.error('[password-reset] request gagal:', err?.message);
    res.status(500).json({ error: 'Permintaan tidak bisa diproses. Coba lagi nanti.' });
  }
});

// The session cookie is HttpOnly, so after a redirect-based sign-in the page
// asks here who it is instead of reading the answer from a fetch reply.
app.get('/api/auth/session', async (req: Request, res: Response) => {
  try {
    const user = await operationalSessions.identity(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk.' });
    res.json({ user: publicUser(user) });
  } catch {
    res.status(503).json({ error: 'Sesi tidak bisa diperiksa saat ini.' });
  }
});

app.get('/api/auth/providers', (_req: Request, res: Response) => {
  res.json({ google: readGoogleSettings() !== null });
});

// Google sign-in. Every outcome ends in a redirect back to /login, carrying
// either oauth=ok or a short oauth_error code the page turns into a sentence.
const GOOGLE_STATE_COOKIE = 'hd_google_oauth';
const setGoogleStateCookie = (res: Response, value: string, maxAge: number) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // Lax, not Strict: the callback is a top-level navigation arriving from
  // accounts.google.com, and a Strict cookie would not be sent with it.
  res.append('Set-Cookie', `${GOOGLE_STATE_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
};
const backToLogin = (res: Response, query: string) => res.redirect(303, `/login?${query}`);

app.get('/api/auth/google', (_req: Request, res: Response) => {
  const settings = readGoogleSettings();
  if (!settings) return backToLogin(res, 'oauth_error=unconfigured');
  const { url, cookieValue } = startGoogleSignIn(settings);
  setGoogleStateCookie(res, cookieValue, 600);
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, url);
});

app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
  const settings = readGoogleSettings();
  const saved = readStateCookie(getCookie(req, GOOGLE_STATE_COOKIE));
  setGoogleStateCookie(res, '', 0);
  res.setHeader('Cache-Control', 'no-store');
  if (!settings) return backToLogin(res, 'oauth_error=unconfigured');
  if (typeof req.query.error === 'string') return backToLogin(res, 'oauth_error=cancelled');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!saved || !code || req.query.state !== saved.state) return backToLogin(res, 'oauth_error=state');
  try {
    const profile = await finishGoogleSignIn(settings, code, saved.verifier);
    const result = await signInWithGoogle(profile);
    if (result.status !== 'ok') return backToLogin(res, `oauth_error=${result.status}`);
    const user = await operationalSessions.loginVerifiedUser(req, res, result.userId);
    if (!user) return backToLogin(res, 'oauth_error=inactive');
    backToLogin(res, 'oauth=ok');
  } catch (err: any) {
    if (err instanceof GoogleSignInError) return backToLogin(res, `oauth_error=${err.reason}`);
    console.error('[google-oauth] gagal:', err?.message);
    backToLogin(res, 'oauth_error=server');
  }
});

app.get('/api/auth/password-reset/verify', async (req: Request, res: Response) => {
  try {
    const match = await findPasswordResetToken(String(req.query.token || ''));
    res.json({ valid: Boolean(match), name: match?.name || null });
  } catch (err: any) {
    console.error('[password-reset] verify gagal:', err?.message);
    res.status(500).json({ error: 'Tautan tidak bisa diperiksa. Coba lagi nanti.' });
  }
});

app.post('/api/auth/password-reset/confirm', async (req: Request, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    if (Buffer.byteLength(password, 'utf8') > 1024) return res.status(400).json({ error: 'Password terlalu panjang.' });
    if (resetRateLimited(`confirm:${req.ip}`)) {
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Tunggu 15 menit, lalu coba lagi.' });
    }
    if (!await consumePasswordResetToken(token, password)) {
      return res.status(400).json({ error: 'Tautan sudah dipakai atau kedaluwarsa. Minta tautan baru dari halaman Lupa Password.' });
    }
    res.json({ success: true, message: 'Password berhasil diubah. Silakan masuk dengan password baru Anda.' });
  } catch (err: any) {
    console.error('[password-reset] confirm gagal:', err?.message);
    res.status(500).json({ error: 'Password tidak bisa diubah. Coba lagi nanti.' });
  }
});

app.get('/api/auth/users', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const users = (await getAllUsers()).map(publicUser);
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/outlets', async (_req: Request, res: Response) => {
  try {
    const rows = await getOutletMaster();
    res.json({ outlets: rows.map((outlet) => ({ id: outlet.id, code: outlet.outletCode, name: outlet.outletName, address: outlet.address })) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat master outlet' });
  }
});

app.get('/api/outlet/profile', async (req: Request, res: Response) => {
  try {
    const account = await operationalSessions.identity(req);
    if (!account) return res.status(401).json({ error: 'Sesi login tidak tersedia atau berakhir. Silakan login kembali.' });
    if (account.role !== 'OUTLET') {
      return res.status(403).json({ error: 'Akses hanya untuk akun Outlet aktif' });
    }
    const profile = await getOutletRequestProfile(Number(account.id));
    if (!profile?.outletId || !profile?.outletName) return res.status(409).json({ error: 'Akun Outlet belum memiliki penempatan. Hubungi Admin.' });
    if (Number(profile.outletIsActive) === 0) return res.status(409).json({ error: 'Outlet penempatan sedang nonaktif. Hubungi Admin.' });
    return res.json({ outletId: profile.outletId, outletName: profile.outletName });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Gagal memuat penempatan outlet' });
  }
});

// Inventory endpoints
app.get('/api/inventory', async (_req: Request, res: Response) => {
  try {
    const items = await getInventory();
    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory/stock-opname', async (_req: Request, res: Response) => {
  try {
    const history = await getStockOpnameHistory();
    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat riwayat Stock Opname' });
  }
});

// Checked before closing so the warning can be shown while it still can be acted on.
app.get('/api/inventory/stock-opname/pending-requests', async (_req: Request, res: Response) => {
  try {
    res.json(await pendingRequestsAtClosing());
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memeriksa request yang belum di-approve' });
  }
});

app.post('/api/inventory/stock-opname', async (req: Request, res: Response) => {
  try {
    const { examinationDate, notes, createdBy, createdByUserId, submissionKey, physicalStocks } = req.body;
    if (typeof examinationDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(examinationDate)) {
      return res.status(400).json({ error: 'Tanggal pemeriksaan wajib diisi dengan format tanggal yang valid' });
    }
    if (!Array.isArray(physicalStocks)) {
      return res.status(400).json({ error: 'Data stok fisik tidak valid' });
    }
    const cleanPhysicalStocks = physicalStocks.map((entry: any) => ({
      itemId: Number(entry.itemId),
      physicalStock: entry.physicalStock === '' || entry.physicalStock == null ? null : Number(entry.physicalStock),
      notes: String(entry.notes || ''),
    }));
    if (cleanPhysicalStocks.some((entry: { itemId: number; physicalStock: number | null }) =>
      !Number.isInteger(entry.itemId) || entry.itemId <= 0 ||
      (entry.physicalStock !== null && (!Number.isInteger(entry.physicalStock) || entry.physicalStock < 0))
    )) {
      return res.status(400).json({ error: 'Stok fisik harus berupa bilangan bulat nol atau lebih' });
    }
    const opname = await saveStockOpname({
      examinationDate,
      notes: String(notes || ''),
      createdBy: String(createdBy || 'Warehouse'),
      createdByUserId: Number.isInteger(Number(createdByUserId)) && Number(createdByUserId) > 0 ? Number(createdByUserId) : null,
      submissionKey: typeof submissionKey === 'string' && submissionKey.length <= 64 ? submissionKey : null,
      physicalStocks: cleanPhysicalStocks,
    });
    res.status(201).json({ opname });
  } catch (err: any) {
    res.status(errorStatus(err)).json({ error: err.message || 'Gagal menyimpan Stock Opname' });
  }
});

app.post('/api/inventory/items', async (req: Request, res: Response) => {
  try {
    const { itemName, price, category, vendorId, vendorIds } = req.body;
    if (!itemName || price == null || !ITEM_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Nama barang, kategori, dan harga harus diisi dengan benar' });
    }

    const item = await createItem(
      itemName,
      Number(price),
      category,
      vendorId ? Number(vendorId) : undefined,
      Array.isArray(vendorIds) ? vendorIds.map(Number) : undefined
    );
    res.json({ item });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/inventory/items/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { itemName, price, category, vendorId, vendorIds } = req.body;
    if (Object.prototype.hasOwnProperty.call(req.body, 'currentStock')) {
      return res.status(400).json({ error: 'Stok hanya dapat berubah melalui transaksi penerimaan barang dari vendor.' });
    }

    const updated = await updateItem(id, {
      itemName,
      category: category !== undefined ? category : undefined,
      price: price != null && !isNaN(Number(price)) ? Number(price) : undefined,
      vendorId: vendorId !== undefined ? (vendorId ? Number(vendorId) : null) : undefined,
      vendorIds: Array.isArray(vendorIds) ? vendorIds.map(Number) : undefined,
    });
    res.json({ item: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal mengubah data barang' });
  }
});

// Item-Vendor Relationship Endpoints
app.get('/api/inventory/items/:id/vendors', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const activeVendors = await getItemVendors(id);
    res.json({ vendors: activeVendors });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat vendor barang' });
  }
});

app.post('/api/inventory/items/:id/vendors', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { vendorId } = req.body;
    if (!vendorId) {
      return res.status(400).json({ error: 'Vendor ID wajib diisi' });
    }
    await addItemVendor(id, Number(vendorId));
    const activeVendors = await getItemVendors(id);
    res.json({ success: true, vendors: activeVendors });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal menambahkan vendor ke barang' });
  }
});

app.delete('/api/inventory/items/:id/vendors/:vendorId', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const vendorId = Number(req.params.vendorId);
    await removeItemVendor(id, vendorId);
    const activeVendors = await getItemVendors(id);
    res.json({ success: true, vendors: activeVendors });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal melepaskan vendor dari barang' });
  }
});

app.delete('/api/inventory/items/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const deleted = await deleteItem(id);
    res.json({ success: true, item: deleted });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menghapus barang' });
  }
});

app.post('/api/inventory/master-item', async (req: Request, res: Response) => {
  try {
    const { vendorCode, vendorName, itemName, price, category } = req.body;
    if (Number(req.body.initialStock) > 0) {
      return res.status(400).json({ error: 'Stok hanya dapat ditambahkan melalui transaksi penerimaan barang dari vendor.' });
    }
    if (!vendorCode || !vendorName || !itemName || price == null) {
      return res.status(400).json({
        error: 'Kode vendor, nama vendor, nama barang, dan harga barang wajib diisi',
      });
    }
    const result = await createMasterItem({
      vendorCode: String(vendorCode),
      vendorName: String(vendorName),
      itemName: String(itemName),
      category: category !== undefined ? category : undefined,
      price: Number(price),
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal menyimpan master data barang' });
  }
});

// Vendors
app.get('/api/vendors', async (_req: Request, res: Response) => {
  try {
    const vendors = await getVendors();
    res.json({ vendors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vendors', async (req: Request, res: Response) => {
  try {
    const { vendorCode, vendorName } = req.body;
    if (!vendorCode || !vendorName) {
      return res.status(400).json({ error: 'Kode vendor dan nama vendor wajib diisi' });
    }
    const vendor = await createVendor(String(vendorCode), String(vendorName));
    res.json({ vendor });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal menyimpan data vendor' });
  }
});

app.put('/api/vendors/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { vendorCode, vendorName } = req.body;
    if (!vendorCode || !vendorName) {
      return res.status(400).json({ error: 'Kode vendor dan nama vendor wajib diisi' });
    }
    const updated = await updateVendor(id, String(vendorCode), String(vendorName));
    res.json({ vendor: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memperbarui data vendor' });
  }
});

app.delete('/api/vendors/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const deleted = await deleteVendor(id);
    res.json({ success: true, vendor: deleted });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menghapus data vendor' });
  }
});

// Incoming Goods (Barang Masuk)
app.post('/api/inventory/incoming', async (req: Request, res: Response) => {
  try {
    const { vendorCode, vendorName, paymentMethod, transactionDate, items, createdBy } = req.body;
    if (!vendorCode || !vendorName || !items || !items.length) {
      return res.status(400).json({ error: 'Data vendor dan barang harus diisi' });
    }
    const purchase = await registerIncomingGoods({
      vendorCode,
      vendorName,
      paymentMethod: paymentMethod || 'Transfer',
      transactionDate: transactionDate || todayJakarta(),
      items,
      createdBy: createdBy || 'Staff Gudang',
    });
    res.json({ success: true, purchase });
  } catch (err: any) {
    console.error('Incoming goods error:', err);
    res.status(errorStatus(err)).json({ error: err.message || 'Gagal menyimpan barang masuk' });
  }
});

// HD R&S (Gudang) Penerimaan / Receiving List
app.post('/api/inventory/hd-receiving', async (req: Request, res: Response) => {
  try {
    const { transactionDate, paymentMethod, notes, items, createdBy } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Daftar barang penerimaan harus diisi' });
    }
    const purchases = await registerHDReceiving({
      transactionDate: transactionDate || todayJakarta(),
      paymentMethod: paymentMethod || 'Transfer',
      notes,
      items,
      createdBy: createdBy || 'Staff Gudang',
    });
    res.json({ success: true, purchases });
  } catch (err: any) {
    console.error('HD Receiving error:', err);
    res.status(errorStatus(err)).json({ error: err.message || 'Gagal menyimpan penerimaan HD R&S' });
  }
});

// Requests
app.get('/api/requests', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;

    const requestsList = await getRequests({ userId, startDate, endDate, status });
    res.json({ requests: requestsList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/requests/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const detail = await getRequestDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
    }
    res.json({ request: detail });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/requests', async (req: Request, res: Response) => {
  try {
    const account = await operationalSessions.identity(req);
    if (!account) return res.status(401).json({ error: 'Sesi login tidak tersedia atau berakhir. Silakan login kembali.' });
    if (account.role !== 'OUTLET') {
      return res.status(403).json({ error: 'Hanya akun Outlet aktif yang dapat membuat request' });
    }
    const assignment = await getOutletRequestProfile(Number(account.id));
    if (!assignment?.outletId || !assignment?.outletName) return res.status(409).json({ error: 'Akun Outlet belum memiliki penempatan. Hubungi Admin.' });
    if (Number(assignment.outletIsActive) === 0) return res.status(409).json({ error: 'Outlet penempatan sedang nonaktif dan tidak dapat membuat request.' });
    const { paymentMethod, requestDate, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Daftar barang harus diisi' });
    const newReq = await createRequest({
      userId: account.id,
      outletId: assignment.outletId,
      requesterName: `${assignment.outletName} (${account.name})`,
      paymentMethod: paymentMethod || 'Transfer',
      requestDate: requestDate || todayJakarta(),
      items,
    });
    res.json({ success: true, request: newReq });
  } catch (err: any) {
    res.status(errorStatus(err)).json({ error: err.message || 'Gagal membuat permintaan' });
  }
});

// Request Item Approval / Rejection
app.post('/api/requests/:requestId/items/:requestItemId/approve', async (req: Request, res: Response) => {
  try {
    const requestId = Number(req.params.requestId);
    const requestItemId = Number(req.params.requestItemId);
    const { staffName, approvedQuantity } = req.body;

    const result = await updateRequestItemStatus(
      requestId,
      requestItemId,
      'Approve',
      staffName || 'Staff Gudang',
      approvedQuantity ? Number(approvedQuantity) : undefined
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menyetujui barang' });
  }
});

// Batch Approve All Items in a Request
app.post('/api/requests/:requestId/approve-all', async (req: Request, res: Response) => {
  try {
    const requestId = Number(req.params.requestId);
    const { staffName, customQuantities } = req.body;

    const result = await approveAllRequestItems(
      requestId,
      customQuantities,
      staffName || 'Staff Gudang'
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menyetujui semua barang' });
  }
});

app.post('/api/requests/:requestId/items/:requestItemId/reject', async (req: Request, res: Response) => {
  try {
    const requestId = Number(req.params.requestId);
    const requestItemId = Number(req.params.requestItemId);
    const staffName = req.body.staffName || 'Staff Gudang';

    const result = await updateRequestItemStatus(requestId, requestItemId, 'Reject', staffName);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menolak barang' });
  }
});

// History endpoints (Transaction-based)
app.get('/api/history/incoming', async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const history = await getIncomingHistory(startDate, endDate);
    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/outgoing', async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const history = await getOutgoingHistory(startDate, endDate);
    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboards
app.get('/api/dashboard/user-stats', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const stats = await getUserDashboardStats(userId);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/warehouse-ops-stats', dashboardSessionAccess(async (req) => {
  const user = await operationalSessions.identity(req);
  return user ? { role: user.role, warehouseGateVerified: false } : null;
}), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const [items, purchases] = await Promise.all([
      getInventory(),
      getIncomingHistory(startDate, endDate),
    ]);
    res.json({ items, purchases });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat dashboard operasional' });
  }
});

const FINANCE_ACCESS_COOKIE = 'hd_finance_access';
const getCookie = (req: Request, name: string) => {
  const cookies = String(req.header('Cookie') || '').split(';');
  const cookie = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
};
const setFinanceAccessCookie = (res: Response, token: string, maxAge: number) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${FINANCE_ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
};
const clearFinanceAccessCookie = (res: Response) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${FINANCE_ACCESS_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
};
const authenticateWarehouseForFinance = async (req: Request, res: Response) => {
  let user;
  try { user = await financeReadAuth.identity(req); }
  catch { res.status(503).json({ error: 'Pembaca autentikasi Finance tidak tersedia.' }); return null; }
  if (!user || user.role !== 'WAREHOUSE') {
    res.status(403).json({ error: 'Akses Finance hanya tersedia untuk akun Warehouse aktif.' });
    return null;
  }
  return user;
};

app.get('/api/finance/access/status', async (req: Request, res: Response) => {
  try {
    const status = await financeReadAuth.status(req);
    if (!status) { res.status(403).json({ error: 'Akses Finance hanya tersedia untuk akun Warehouse aktif.' }); return; }
    res.json(status);
  } catch { res.status(503).json({ error: 'Pembaca akses Finance tidak tersedia. Periksa konfigurasi koneksi SELECT-only.' }); }
});

app.post('/api/finance/access/verify', async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production' && !req.secure) return res.status(400).json({ error: 'Verifikasi password Finance wajib melalui HTTPS.' });
    const user = await authenticateWarehouseForFinance(req, res);
    if (!user) return;
    const lock = await getFinanceAccessLock(Number(user.id));
    if (lock.locked) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });
    const { passwordHash } = await getFinancePasswordHash();
    if (!passwordHash) return res.status(503).json({ error: 'Password Finance belum dikonfigurasi oleh Admin.' });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (Buffer.byteLength(password, 'utf8') > 72 || !(await bcrypt.compare(password, passwordHash))) {
      await recordFinanceAccessFailure(Number(user.id));
      return res.status(401).json({ error: 'Password Finance salah.' });
    }
    await clearFinanceAccessFailures(Number(user.id));
    const session = await createFinanceAccessSession(Number(user.id));
    setFinanceAccessCookie(res, session.token, session.expiresIn);
    res.json({ success: true, expiresIn: session.expiresIn });
  } catch (error: any) { res.status(500).json({ error: error.message || 'Gagal memverifikasi password Finance.' }); }
});

app.post('/api/finance/access/logout', async (req: Request, res: Response) => {
  try {
    await revokeFinanceAccessSession(getCookie(req, FINANCE_ACCESS_COOKIE));
    clearFinanceAccessCookie(res);
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message || 'Gagal mencabut akses Finance.' }); }
});

const financeScope = createFinanceScope({
  identity: operationalSessions.identity,
  authenticate: operationalSessions.authenticate,
  outletOf: async (userId) => { const profile = await getOutletRequestProfile(userId); return profile?.outletId ? Number(profile.outletId) : null; },
  outletCanViewCost: async () => Boolean((await getApplicationConfig()).system.outletCanViewCost),
});

const financeDashboardStatsHandler = async (req: Request, res: Response) => {
  const scope = await financeScope(req, res);
  if (!scope) return;
  try {
    const ledger = await loadLedger();
    const periods = await getFinancePeriods(ledger);
    const requestedPeriod = String(req.query.periodId || 'running');
    const selectedPeriod = periods.find((period) => period.id === requestedPeriod) || periods.find((period) => period.id === 'running');
    const itemIds = req.query.itemIds ? String(req.query.itemIds).split(',').map(Number).filter(Number.isFinite) : undefined;
    const outletIds = scope.outletIds;
    const categories = req.query.categories
      ? String(req.query.categories).split(',').map((category) => category.trim()).filter((category): category is ItemCategory => ITEM_CATEGORIES.includes(category as ItemCategory))
      : undefined;
    const stats = await getWarehouseDashboardStats({ itemIds, outletIds, categories, financePeriod: selectedPeriod, ledger });
    const viewer = { lockedOutletId: scope.lockedOutletId, showCost: scope.showCost, outletIds: outletIds ?? [] };
    res.json(scope.lockedOutletId ? { ...outletView({ ...stats, financePeriods: periods, financePeriod: selectedPeriod }, scope), viewer } : { ...stats, financePeriods: periods, financePeriod: selectedPeriod, viewer });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

const financePeriodsHandler = async (req: Request, res: Response) => {
  if (!await financeScope(req, res)) return;
  try {
    res.json({ periods: await getFinancePeriods() });
  } catch (error: any) {
    res.status(403).json({ error: error.message || 'Akses Finance tidak diizinkan.' });
  }
};

// Both dashboard endpoints serve the shared Finance view to Warehouse and Finance.
// Warehouse (with Finance gate), Finance and Admin see every outlet; an Outlet
// account only its own outlet, and only sales unless its role setting allows cost.
app.get('/api/dashboard/warehouse-stats', financeDashboardStatsHandler);
app.get('/api/dashboard/finance-stats', financeDashboardStatsHandler);
app.get('/api/dashboard/finance-periods', financePeriodsHandler);

// Corrections to a closed period are booked in the open period; the closed snapshot stays as is.
app.post('/api/finance/period-corrections', dashboardSessionAccess(operationalSessions.authenticate), async (req: Request, res: Response) => {
  try {
    const user = await operationalSessions.identity(req);
    if (!user) return res.status(401).json({ error: 'Sesi login tidak tersedia atau berakhir. Silakan login kembali.' });
    const itemId = Number(req.body?.itemId), quantity = Number(req.body?.quantity), sourceOpnameId = Number(req.body?.sourceOpnameId);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(sourceOpnameId) || sourceOpnameId <= 0) return res.status(400).json({ error: 'Barang dan periode asal wajib diisi.' });
    if (!Number.isInteger(quantity) || quantity === 0) return res.status(400).json({ error: 'Jumlah koreksi harus bilangan bulat selain nol.' });
    if (!reason || reason.length > 500) return res.status(400).json({ error: 'Alasan koreksi wajib diisi (maksimal 500 karakter).' });
    const correction = await recordPeriodCorrection({ itemId, quantity, sourceOpnameId, reason, createdBy: user.name, createdByUserId: user.id });
    res.status(201).json({ correction });
  } catch (error: any) { res.status(400).json({ error: error.message || 'Gagal mencatat koreksi periode.' }); }
});

async function getFinanceUser(req: Request, res: Response) {
  try {
    const user = await authenticateUser(String(req.header('X-Auth-Email') || ''), String(req.header('X-Auth-Password') || ''));
    if (!user || !canAccessDashboard(String(user.role), 'FINANCE')) {
      res.status(403).json({ error: 'Akses transaksi Finance hanya untuk role Finance' });
      return null;
    }
    return user;
  } catch {
    res.status(403).json({ error: 'Akses transaksi Finance hanya untuk role Finance' });
    return null;
  }
}

app.get('/api/finance/entries', async (req: Request, res: Response) => {
  if (!await getFinanceUser(req, res)) return;
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const outletIds = req.query.outletIds ? String(req.query.outletIds).split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0) : undefined;
    const [entries, outlets] = await Promise.all([getManualFinanceEntries({ startDate, endDate, outletIds }), getOutletMaster(true)]);
    res.json({ entries, accounts: FINANCE_MANUAL_ACCOUNT_CODES, outlets });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Gagal memuat transaksi Finance' }); }
});

app.post('/api/finance/entries', async (req: Request, res: Response) => {
  const user = await getFinanceUser(req, res);
  if (!user) return;
  try {
    const body = req.body || {};
    const entry = await createManualFinanceEntry({
      accountCode: String(body.accountCode || ''),
      outletId: body.outletId == null || body.outletId === '' ? null : Number(body.outletId),
      transactionDate: String(body.transactionDate || ''),
      amount: Number(body.amount),
      description: String(body.description || ''),
      createdBy: Number(user.id),
    });
    await logAdminActivity({ actorId: Number(user.id), actorName: user.name, action: 'FINANCE_ENTRY_CREATED', targetType: 'finance_entry', targetId: entry.id, details: { accountCode: entry.accountCode, amount: entry.amount, outletId: entry.outletId } }).catch((error) => console.error('Finance entry activity log failed:', error));
    res.status(201).json({ entry });
  } catch (err: any) { res.status(400).json({ error: err.message || 'Gagal menyimpan transaksi Finance' }); }
});

app.post('/api/finance/entries/:id/void', async (req: Request, res: Response) => {
  const user = await getFinanceUser(req, res);
  if (!user) return;
  try {
    await voidManualFinanceEntry(Number(req.params.id), String(req.body?.reason || ''));
    await logAdminActivity({ actorId: Number(user.id), actorName: user.name, action: 'FINANCE_ENTRY_VOIDED', targetType: 'finance_entry', targetId: Number(req.params.id), details: { reason: String(req.body?.reason || '').trim() } }).catch((error) => console.error('Finance entry activity log failed:', error));
    res.json({ success: true });
  } catch (err: any) { res.status(400).json({ error: err.message || 'Gagal mengoreksi transaksi Finance' }); }
});

// Administrative endpoints are read-only and guarded independently from the operational APIs.
app.get('/api/admin/overview', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const [rawUsers, items, requests, purchases] = await Promise.all([
      getAllUsers(), getInventory(), getRequests(), getIncomingHistory(),
    ]);
    const users = rawUsers.map(publicUser);
    const recentActivity = [
      ...requests.map((request: any) => ({
        id: `request-${request.id}`, type: 'Request Outlet', reference: request.requestCode,
        description: `${request.requesterName} · ${request.itemCount || 0} barang`,
        date: request.requestDate, status: request.status,
      })),
      ...purchases.map((purchase: any) => ({
        id: `purchase-${purchase.id}`, type: 'Penerimaan Barang', reference: purchase.transactionCode,
        description: `${purchase.vendorName || 'Vendor'} · ${purchase.itemCount || 0} barang`,
        date: purchase.transactionDate, status: 'Tercatat',
      })),
    ].sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))).slice(0, 8);
    res.json({
      totals: {
        activeAccounts: users.length,
        outlets: users.filter((user: any) => user.role === 'OUTLET').length,
        items: items.length,
        requests: requests.length,
        pendingRequests: requests.filter((request: any) => request.status === 'Pending' || request.status === 'Partially Approved').length,
      },
      recentActivity,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat ringkasan Admin' });
  }
});

app.get('/api/admin/users', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    res.json({ users: await getAdminUsers() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat akun pengguna' });
  }
});

app.post('/api/admin/users', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const { name, username, email, password, role, outletId } = req.body || {};
    const user = await createManagedUser({ name, username, email, password, role, outletId });
    res.status(201).json({ user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menambahkan akun' });
  }
});

app.patch('/api/admin/users/:id', async (req: Request, res: Response) => {
  const actor = await getAdminUser(req, res);
  if (!actor) return;
  try {
    const { role, isActive, outletId } = req.body || {};
    if (typeof role !== 'string' || typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'Role dan status akun wajib dikirim secara eksplisit' });
    }
    const before = (await getAdminUsers()).find((entry) => entry.id === Number(req.params.id));
    const user = await updateManagedUser(Number(req.params.id), { name: req.body.name, username: req.body.username, email: req.body.email, password: req.body.password, role, isActive, outletId });
    if (before) {
      if (String(before.role).toUpperCase() !== String(user.role).toUpperCase()) await logAdminActivity({ actorId: actor.id, actorName: actor.name, action: 'ROLE_CHANGED', targetType: 'user', targetId: user.id, details: { from: before.role, to: user.role, email: user.email } });
      if ((before.outletId || null) !== (user.outletId || null)) await logAdminActivity({ actorId: actor.id, actorName: actor.name, action: 'OUTLET_ASSIGNMENT_CHANGED', targetType: 'user', targetId: user.id, details: { from: before.outletName || null, to: user.outletName || null, email: user.email } });
      if (Boolean(before.isActive) !== Boolean(user.isActive)) await logAdminActivity({ actorId: actor.id, actorName: actor.name, action: user.isActive ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED', targetType: 'user', targetId: user.id, details: { email: user.email } });
    }
    res.json({ user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menyimpan perubahan akun' });
  }
});

app.delete('/api/admin/users/:id', async (req: Request, res: Response) => {
  const actor = await getAdminUser(req, res);
  if (!actor) return;
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'ID pengguna tidak valid' });
    if (userId === actor.id) return res.status(400).json({ error: 'Akun yang sedang digunakan tidak dapat dihapus' });
    const result = await deleteManagedUser(userId, actor.id);
    await logAdminActivity({ actorId: actor.id, actorName: actor.name, action: result.mode === 'deactivated' ? 'ACCOUNT_DEACTIVATED' : 'USER_DELETED', targetType: 'user', targetId: result.id, details: { name: result.name, mode: result.mode } });
    res.json(result);
  } catch (err: any) { res.status(400).json({ error: err.message || 'Gagal menghapus pengguna' }); }
});

app.get('/api/admin/outlets', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const [master, outletUsers, requests] = await Promise.all([getOutletMaster(false), getAdminUsers(), getRequests()]);
    const response = master.map((outlet) => {
      const assignedUsers = outletUsers.filter((user) => user.outletId === outlet.id && user.role.toUpperCase() === 'OUTLET');
      const outletRequests = requests.filter((request: any) => request.outletId === outlet.id);
      return { id: outlet.id, code: outlet.outletCode, name: outlet.outletName, address: outlet.address || '', isActive: outlet.isActive, assignedUsers: assignedUsers.length, requestCount: outletRequests.length, users: assignedUsers.map((user) => ({ id: user.id, name: user.name, email: user.email, isActive: user.isActive })) };
    });
    res.json({ outlets: response, assignments: outletUsers.filter((user) => user.role.toUpperCase() === 'OUTLET') });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat outlet' });
  }
});

const brandingStorage = path.resolve(__dirname, '../uploads/branding');
app.use('/uploads/branding', express.static(brandingStorage, { fallthrough: false, dotfiles: 'deny', index: false, maxAge: '1d' }));
const imageUpload = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], limit: '2mb' });
function sanitizeSvg(source: string) {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source) || !/<svg\b/i.test(source)) throw new Error('SVG tidak valid');
  const allowedTags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'title', 'desc']);
  const allowedAttrs = new Set(['xmlns', 'viewBox', 'width', 'height', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'id', 'class', 'offset', 'stop-color', 'stop-opacity', 'clip-path', 'preserveAspectRatio']);
  const tokens = source.replace(/<!--[\s\S]*?-->/g, '').match(/<[^>]*>/g) || [];
  const clean: string[] = [];
  for (const token of tokens) {
    const match = token.match(/^<\s*(\/?)\s*([\w:-]+)([\s\S]*?)\s*(\/?)>$/);
    if (!match) continue;
    const [, closing, rawName, rawAttrs, selfClosing] = match;
    if (rawName.toLowerCase().startsWith('script') || rawName.toLowerCase() === 'foreignobject') continue;
    if (!allowedTags.has(rawName)) continue;
    if (closing) { clean.push(`</${rawName}>`); continue; }
    const attrs: string[] = [];
    const attrPattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attr: RegExpExecArray | null;
    while ((attr = attrPattern.exec(rawAttrs))) {
      const [, name, doubleValue, singleValue] = attr;
      const value = doubleValue ?? singleValue ?? '';
      if (!allowedAttrs.has(name) || /^on/i.test(name) || /javascript:|data:|https?:|url\((?!\s*#)/i.test(value)) continue;
      if (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') continue;
      attrs.push(`${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`);
    }
    clean.push(`<${rawName}${attrs.length ? ` ${attrs.join(' ')}` : ''}${selfClosing ? ' />' : '>'}`);
  }
  const svg = clean.join('');
  if (!/^<svg\b/.test(svg) || !svg.includes('</svg>')) throw new Error('SVG tidak aman atau tidak lengkap');
  return svg;
}

app.post('/api/admin/branding/assets', imageUpload, async (req: Request, res: Response) => {
  const actor = await getAdminUser(req, res);
  if (!actor) return;
  try {
    const mime = String(req.header('Content-Type') || '').split(';')[0].toLowerCase();
    const buffer = req.body as Buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'File kosong atau melebihi batas 2 MB' });
    let extension: string;
    let content: Buffer | string = buffer;
    if (mime === 'image/svg+xml') { extension = 'svg'; content = sanitizeSvg(buffer.toString('utf8')); }
    else if (mime === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = 'png';
    else if (mime === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) extension = 'jpg';
    else if (mime === 'image/webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
    else return res.status(400).json({ error: 'Format gambar tidak valid. Gunakan PNG, JPG, WEBP, atau SVG.' });
    fs.mkdirSync(brandingStorage, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(brandingStorage, filename), content, { flag: 'wx' });
    res.status(201).json({ url: `/uploads/branding/${filename}` });
  } catch (err: any) { res.status(400).json({ error: err.message || 'Gagal menyimpan file branding' }); }
});

app.put('/api/admin/branding', async (req: Request, res: Response) => {
  const actor = await getAdminUser(req, res); if (!actor) return;
  try {
    const body = req.body || {};
    const branding = { appName: String(body.appName || '').trim().slice(0, 120), subtitle: String(body.subtitle || '').trim().slice(0, 180), mainLogo: String(body.mainLogo || ''), sidebarLogo: String(body.sidebarLogo || ''), favicon: String(body.favicon || '') };
    if (!branding.appName || !branding.subtitle) return res.status(400).json({ error: 'Nama dan subtitle aplikasi wajib diisi' });
    for (const asset of [branding.mainLogo, branding.sidebarLogo, branding.favicon]) if (asset && !/^\/uploads\/branding\/[\w-]+\.(?:png|jpg|webp|svg)$/.test(asset)) return res.status(400).json({ error: 'Referensi file branding tidak valid' });
    await saveApplicationConfig('branding', branding, actor.id);
    await logAdminActivity({ actorId: actor.id, actorName: actor.name, action: 'BRANDING_CHANGED', targetType: 'branding', details: branding });
    res.json({ branding });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Gagal menyimpan branding' }); }
});

app.put('/api/admin/system-settings', async (req: Request, res: Response) => {
  const actor = await getAdminUser(req, res); if (!actor) return;
  try {
    const body = req.body || {};
    const system = { systemName: String(body.systemName || '').trim().slice(0, 120), dateFormat: String(body.dateFormat || ''), timeZone: String(body.timeZone || ''), currency: String(body.currency || ''), organizationInfo: String(body.organizationInfo || '').trim().slice(0, 500), outletCanViewCost: body.outletCanViewCost === true };
    if (!system.systemName || !['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].includes(system.dateFormat) || system.timeZone !== 'Asia/Jakarta' || system.currency !== 'IDR') return res.status(400).json({ error: 'Pengaturan tanggal, zona waktu, atau mata uang tidak valid' });
    await saveApplicationConfig('system', system, actor.id);
    await logAdminActivity({ actorId: actor.id, actorName: actor.name, action: 'SYSTEM_SETTINGS_CHANGED', targetType: 'system_settings', details: system });
    res.json({ system });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Gagal menyimpan pengaturan sistem' }); }
});

app.get('/api/admin/activity-logs', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try { res.json({ logs: await getAdminActivityLogs(Number(req.query.limit) || 200) }); }
  catch (err: any) { res.status(500).json({ error: err.message || 'Gagal memuat activity logs' }); }
});

app.get('/api/admin/settings', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try { res.json(await getApplicationConfig()); }
  catch (err: any) { res.status(500).json({ error: err.message || 'Gagal memuat pengaturan' }); }
});

app.get('/api/admin/finance-security', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try { res.json(await getFinanceSecurityStatus()); }
  catch (err: any) { res.status(500).json({ error: err.message || 'Gagal memuat pengaturan keamanan Finance.' }); }
});

app.put('/api/admin/finance-security', async (req: Request, res: Response) => {
  const actor = await getAdminUser(req, res); if (!actor) return;
  try {
    if (process.env.NODE_ENV === 'production' && !req.secure) return res.status(400).json({ error: 'Pengaturan password Finance wajib melalui HTTPS.' });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 6) return res.status(400).json({ error: 'Password Finance minimal 6 karakter.' });
    if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Password Finance tidak boleh lebih dari 72 byte.' });
    const existing = await getFinanceSecurityStatus();
    await setFinancePasswordHash(await bcrypt.hash(password, 12), Number(actor.id));
    await logAdminActivity({ actorId: Number(actor.id), actorName: actor.name, action: existing.configured ? 'FINANCE_PASSWORD_CHANGED' : 'FINANCE_PASSWORD_SET', targetType: 'finance_security', targetId: '1' });
    res.json(await getFinanceSecurityStatus());
  } catch (err: any) { res.status(500).json({ error: err.message || 'Gagal menyimpan password Finance.' }); }
});

app.delete('/api/admin/finance-security', async (req: Request, res: Response) => {
  const actor = await getAdminUser(req, res); if (!actor) return;
  try {
    await resetFinancePassword(Number(actor.id));
    await logAdminActivity({ actorId: Number(actor.id), actorName: actor.name, action: 'FINANCE_PASSWORD_RESET', targetType: 'finance_security', targetId: '1' });
    res.json(await getFinanceSecurityStatus());
  } catch (err: any) { res.status(500).json({ error: err.message || 'Gagal mereset password Finance.' }); }
});

app.post('/api/admin/outlets', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const { code, name, address } = req.body || {};
    const outlet = await createManagedOutlet({ code, name, address });
    res.status(201).json({ outlet });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menambahkan outlet' });
  }
});

app.patch('/api/admin/outlets/:id', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const { code, name, address, isActive } = req.body || {};
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'Status outlet wajib dikirim secara eksplisit' });
    const outlet = await updateManagedOutlet(Number(req.params.id), { code, name, address, isActive });
    res.json({ outlet });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menyimpan outlet' });
  }
});

app.get('/api/admin/monitoring/warehouse', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const [items, purchases] = await Promise.all([getInventory(), getIncomingHistory()]);
    res.json({ items, purchases });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat monitoring Warehouse' });
  }
});

app.get('/api/admin/monitoring/outlet', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const [requests, transactions] = await Promise.all([getRequests(), getOutgoingHistory()]);
    res.json({ requests, transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat monitoring Outlet' });
  }
});

app.get('/api/admin/monitoring/finance', async (req: Request, res: Response) => {
  if (!await getAdminUser(req, res)) return;
  try {
    const stats = await getWarehouseDashboardStats();
    res.json({ stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat laporan Finance' });
  }
});

// Production static serving (if frontend dist exists)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

// No eager data/schema migration at startup. Finance GET requests must remain
// read-only; legacy operational workflows retain their existing behavior.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  });
}
