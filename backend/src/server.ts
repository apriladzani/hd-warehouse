import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  authenticateUser,
  getAllUsers,
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
  ITEM_CATEGORIES,
  migrateLegacyUserRoles,
  getStockOpnameHistory,
  saveStockOpname,
  registerHDReceiving,
  registerUser,
} from './db/repository.ts';
import type { ItemCategory } from './db/repository.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(
  process.env.BACKEND_PORT ||
  (process.env.PORT && process.env.PORT !== '3000' ? process.env.PORT : 5001)
);

app.use(cors());
app.use(express.json());

// API Routes
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth endpoints
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    res.json({ user });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Gagal login' });
  }
});

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

app.get('/api/auth/users', async (_req: Request, res: Response) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

app.post('/api/inventory/stock-opname', async (req: Request, res: Response) => {
  try {
    const { examinationDate, notes, createdBy, physicalStocks } = req.body;
    if (typeof examinationDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(examinationDate)) {
      return res.status(400).json({ error: 'Tanggal pemeriksaan wajib diisi dengan format tanggal yang valid' });
    }
    if (!Array.isArray(physicalStocks)) {
      return res.status(400).json({ error: 'Data stok fisik tidak valid' });
    }
    const cleanPhysicalStocks = physicalStocks.map((entry: any) => ({
      itemId: Number(entry.itemId),
      physicalStock: entry.physicalStock === '' || entry.physicalStock == null ? null : Number(entry.physicalStock),
    }));
    if (cleanPhysicalStocks.some((entry: { itemId: number; physicalStock: number | null }) =>
      !Number.isInteger(entry.itemId) || entry.itemId <= 0 ||
      (entry.physicalStock !== null && (!Number.isInteger(entry.physicalStock) || entry.physicalStock < 0))
    )) {
      return res.status(400).json({ error: 'Stok fisik harus berupa bilangan bulat nol atau lebih' });
    }
    const opname = await saveStockOpname({ examinationDate, notes: String(notes || ''), createdBy: String(createdBy || 'Warehouse'), physicalStocks: cleanPhysicalStocks });
    res.status(201).json({ opname });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal menyimpan Stock Opname' });
  }
});

app.post('/api/inventory/items', async (req: Request, res: Response) => {
  try {
    const { itemName, price, currentStock, category, vendorId, vendorIds } = req.body;
    if (!itemName || price == null || !ITEM_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Nama barang, kategori, dan harga harus diisi dengan benar' });
    }
    const cleanStock =
      currentStock !== undefined &&
        currentStock !== null &&
        String(currentStock).trim() !== '' &&
        !isNaN(Number(currentStock)) &&
        Number(currentStock) >= 0
        ? Number(currentStock)
        : 0;

    const item = await createItem(
      itemName,
      Number(price),
      cleanStock,
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
    const { itemName, price, currentStock, category, vendorId, vendorIds } = req.body;

    let cleanStock: number | undefined = undefined;
    if (
      currentStock !== undefined &&
      currentStock !== null &&
      String(currentStock).trim() !== '' &&
      !isNaN(Number(currentStock)) &&
      Number(currentStock) >= 0
    ) {
      cleanStock = Number(currentStock);
    }

    const updated = await updateItem(id, {
      itemName,
      category: category !== undefined ? category : undefined,
      price: price != null && !isNaN(Number(price)) ? Number(price) : undefined,
      currentStock: cleanStock,
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
    const { vendorCode, vendorName, itemName, price, initialStock, category } = req.body;
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
      initialStock: initialStock ? Number(initialStock) : 0,
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
      transactionDate: transactionDate || new Date().toISOString().split('T')[0],
      items,
      createdBy: createdBy || 'Staff Gudang',
    });
    res.json({ success: true, purchase });
  } catch (err: any) {
    console.error('Incoming goods error:', err);
    res.status(500).json({ error: err.message || 'Gagal menyimpan barang masuk' });
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
      transactionDate: transactionDate || new Date().toISOString().split('T')[0],
      paymentMethod: paymentMethod || 'Transfer',
      notes,
      items,
      createdBy: createdBy || 'Staff Gudang',
    });
    res.json({ success: true, purchases });
  } catch (err: any) {
    console.error('HD Receiving error:', err);
    res.status(500).json({ error: err.message || 'Gagal menyimpan penerimaan HD R&S' });
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
    const { userId, requesterName, paymentMethod, requestDate, items } = req.body;
    if (!requesterName || !items || !items.length) {
      return res.status(400).json({ error: 'Nama pemohon dan daftar barang harus diisi' });
    }
    const newReq = await createRequest({
      userId,
      requesterName,
      paymentMethod: paymentMethod || 'Transfer',
      requestDate: requestDate || new Date().toISOString().split('T')[0],
      items,
    });
    res.json({ success: true, request: newReq });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal membuat permintaan' });
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

app.get('/api/dashboard/warehouse-stats', async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const itemIds = req.query.itemIds ? String(req.query.itemIds).split(',').map(Number).filter(Number.isFinite) : undefined;
    const outletNames = req.query.outletNames ? String(req.query.outletNames).split(',').map((name) => name.trim()).filter(Boolean) : undefined;
    const categories = req.query.categories
      ? String(req.query.categories).split(',').map((category) => category.trim()).filter((category): category is ItemCategory => ITEM_CATEGORIES.includes(category as ItemCategory))
      : undefined;
    const stats = await getWarehouseDashboardStats(startDate, endDate, itemIds, outletNames, categories);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

void migrateLegacyUserRoles();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
