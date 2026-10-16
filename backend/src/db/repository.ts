import { eq, desc, and, gte, lte, inArray, sql } from 'drizzle-orm';
import { db, pool } from './index.ts';
import {
  users,
  vendors,
  items,
  itemVendors,
  purchaseTransactions,
  purchaseItems,
  requests,
  requestItems,
  stockMovements,
  stockOpnames,
} from './schema.ts';

export const ITEM_CATEGORIES = ['Raw Material', 'Support Material', 'Packaging'] as const;
export type ItemCategory = typeof ITEM_CATEGORIES[number];
const ITEM_CATEGORY_CODES: Record<ItemCategory, string> = {
  'Raw Material': 'RM',
  'Support Material': 'SM',
  Packaging: 'PKG',
};

export function inferItemCategory(itemName: string): ItemCategory {
  const name = itemName.toLowerCase();
  if (/(box|plastic|plastik|tray|cup|kemasan|packaging|k\.ayam|k\.nasi)/i.test(name)) return 'Packaging';
  if (/(ayam|kulit|beras|tepung|daging|raw|mentah)/i.test(name)) return 'Raw Material';
  return 'Support Material';
}

function categoryPrefix(category: string): string {
  if (!ITEM_CATEGORIES.includes(category as ItemCategory)) throw new Error('Kategori barang tidak valid');
  return ITEM_CATEGORY_CODES[category as ItemCategory];
}

let itemCategorySchemaReady: Promise<void> | undefined;
export function ensureItemCategorySchema() {
  if (!itemCategorySchemaReady) {
    itemCategorySchemaReady = (async () => {
      const [categoryColumns] = await pool.query("SHOW COLUMNS FROM `items` LIKE 'category'");
      if ((categoryColumns as any[]).length === 0) {
        await pool.query("ALTER TABLE `items` ADD COLUMN `category` VARCHAR(40) NULL AFTER `item_name`");
      }
      const [codeColumns] = await pool.query("SHOW COLUMNS FROM `items` LIKE 'item_code'");
      if ((codeColumns as any[]).length === 0) {
        await pool.query("ALTER TABLE `items` ADD COLUMN `item_code` VARCHAR(20) NULL AFTER `category`");
      }

      const [rows] = await pool.query('SELECT `id`, `item_name`, `category`, `item_code` FROM `items` ORDER BY `id`');
      const records = rows as Array<{ id: number; item_name: string; category: string | null; item_code: string | null }>;
      const maxByPrefix: Record<string, number> = { RM: 0, SM: 0, PKG: 0 };
      const occupied = new Set<string>();
      for (const row of records) {
        const category = ITEM_CATEGORIES.includes(row.category as ItemCategory) ? row.category as ItemCategory : inferItemCategory(row.item_name);
        const prefix = ITEM_CATEGORY_CODES[category];
        const match = row.item_code?.match(new RegExp(`^${prefix}-(\\d+)$`));
        if (match) {
          maxByPrefix[prefix] = Math.max(maxByPrefix[prefix], Number(match[1]));
          occupied.add(row.item_code!);
        }
      }

      for (const row of records) {
        const category = ITEM_CATEGORIES.includes(row.category as ItemCategory) ? row.category as ItemCategory : inferItemCategory(row.item_name);
        const prefix = ITEM_CATEGORY_CODES[category];
        let code = row.item_code;
        if (!code || !new RegExp(`^${prefix}-\\d+$`).test(code) || records.some((other) => other.id !== row.id && other.item_code === code)) {
          do {
            maxByPrefix[prefix] += 1;
            code = `${prefix}-${String(maxByPrefix[prefix]).padStart(3, '0')}`;
          } while (occupied.has(code));
          occupied.add(code);
        }
        await pool.query('UPDATE `items` SET `category` = ?, `item_code` = ? WHERE `id` = ?', [category, code, row.id]);
      }

      await pool.query("ALTER TABLE `items` MODIFY COLUMN `category` VARCHAR(40) NOT NULL");
      await pool.query("ALTER TABLE `items` MODIFY COLUMN `item_code` VARCHAR(20) NOT NULL");
      const [indexes] = await pool.query("SHOW INDEX FROM `items` WHERE `Key_name` = 'uq_items_item_code'");
      if ((indexes as any[]).length === 0) {
        await pool.query('ALTER TABLE `items` ADD UNIQUE INDEX `uq_items_item_code` (`item_code`)');
      }
    })().catch((error) => {
      itemCategorySchemaReady = undefined;
      throw error;
    });
  }
  return itemCategorySchemaReady;
}

async function generateNextItemCode(category: string, executor: InventoryExecutor = db) {
  await ensureItemCategorySchema();
  const prefix = categoryPrefix(category);
  const existing = await executor.select({ itemCode: items.itemCode }).from(items);
  const maxSequence = existing.reduce((max, row) => {
    const match = row.itemCode.match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}-${String(maxSequence + 1).padStart(3, '0')}`;
}

type InventoryExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Users
export const DEFAULT_USERS_SEED = [
  {
    name: 'Staff Gudang HD',
    email: 'warehouse@hd.com',
    password: 'warehouse123',
    role: 'WAREHOUSE' as const,
  },
  {
    name: 'April Adzania (User Outlet)',
    email: 'user@hd.com',
    password: 'user123',
    role: 'OUTLET' as const,
  },
  {
    name: 'April Adzania',
    email: 'april.adzania@gmail.com',
    password: 'password123',
    role: 'OUTLET' as const,
  },
];

let outletRoleMigration: Promise<void> | null = null;
export function migrateLegacyUserRoles() {
  if (!outletRoleMigration) {
    outletRoleMigration = db.execute(sql`UPDATE users SET role = 'OUTLET' WHERE UPPER(role) = 'USER'`)
      .then(() => undefined)
      .catch((err) => {
        outletRoleMigration = null;
        console.warn('Outlet role migration warning:', err instanceof Error ? err.message : err);
      });
  }
  return outletRoleMigration;
}

export async function seedDefaultUsersIfEmpty() {
  try {
    await migrateLegacyUserRoles();
    for (const u of DEFAULT_USERS_SEED) {
      const existing = await db.select().from(users).where(eq(users.email, u.email.toLowerCase()));
      if (existing.length === 0) {
        await db.insert(users).values({
          name: u.name,
          email: u.email.toLowerCase(),
          password: u.password,
          role: u.role,
        });
      }
    }
  } catch (err) {
    console.error('seedDefaultUsersIfEmpty error:', err);
  }
}

// In-memory fallback user store for resilience during DB setup
const inMemoryUsers: Array<{
  id: number;
  name: string;
  email: string;
  password?: string;
  role: string;
}> = DEFAULT_USERS_SEED.map((u, i) => ({ id: i + 1, ...u }));

export async function authenticateUser(email: string, password?: string) {
  const cleanEmail = email.trim().toLowerCase();
  if (!password) {
    return null;
  }

  // 1. Check MySQL database first if connected
  try {
    await seedDefaultUsersIfEmpty();
    const found = await db.select().from(users).where(eq(users.email, cleanEmail));
    if (found.length > 0) {
      const u = found[0];
      // STRICT password verification
      if (u.password === password) {
        return { ...u, role: u.role.toUpperCase() === 'USER' ? 'OUTLET' : u.role };
      }
      // Password did NOT match
      return null;
    }
  } catch (err: any) {
    console.warn('MySQL auth query warning:', err.message);
  }

  // 2. Check in-memory users (seeded & newly registered)
  const memUser = inMemoryUsers.find((u) => u.email.toLowerCase() === cleanEmail);
  if (memUser) {
    // STRICT password verification
    if (memUser.password === password) {
      return memUser;
    }
    // Password did NOT match
    return null;
  }

  // User not found anywhere
  return null;
}

export async function registerUser(name: string, email: string, password?: string, role: string = 'OUTLET') {
  const cleanEmail = email.trim().toLowerCase();
  if (!name || !name.trim()) {
    throw new Error('Nama lengkap wajib diisi');
  }
  if (!cleanEmail) {
    throw new Error('Email wajib diisi');
  }
  if (!password || password.length < 6) {
    throw new Error('Password minimal harus 6 karakter');
  }

  const normalizedRole = role.toUpperCase();
  const targetRole = normalizedRole === 'WAREHOUSE' ? 'WAREHOUSE' : 'OUTLET';

  // Check in-memory store for duplicates
  if (inMemoryUsers.some((u) => u.email.toLowerCase() === cleanEmail)) {
    throw new Error('Email sudah terdaftar. Silakan gunakan email lain atau langsung masuk.');
  }

  let dbUser: any = null;

  // Try inserting into MySQL database
  try {
    await seedDefaultUsersIfEmpty();
    const existing = await db.select().from(users).where(eq(users.email, cleanEmail));
    if (existing.length > 0) {
      throw new Error('Email sudah terdaftar di database. Silakan langsung masuk.');
    }

    const [result] = await db.insert(users).values({
      name: name.trim(),
      email: cleanEmail,
      password: password,
      role: targetRole,
    });
    const [newUser] = await db.select().from(users).where(eq(users.id, result.insertId));
    dbUser = newUser;
  } catch (err: any) {
    if (err.message?.includes('sudah terdaftar')) {
      throw err;
    }
    console.warn('MySQL register warning (check MySQL connection / .env):', err.message);
  }

  const createdUser = dbUser || {
    id: inMemoryUsers.length + 10,
    name: name.trim(),
    email: cleanEmail,
    password: password,
    role: targetRole,
  };

  inMemoryUsers.push(createdUser);
  return createdUser;
}

export async function getAllUsers() {
  try {
    await migrateLegacyUserRoles();
    return await db.select().from(users);
  } catch (err) {
    console.error('getAllUsers error:', err);
    return [];
  }
}

// Vendors
export async function getVendors() {
  try {
    return await db.select().from(vendors).orderBy(vendors.vendorName);
  } catch (err) {
    console.error('getVendors error:', err);
    return [];
  }
}

export async function getOrCreateVendor(code: string, name: string) {
  try {
    const existing = await db.select().from(vendors).where(eq(vendors.vendorCode, code.trim()));
    if (existing.length > 0) return existing[0];

    const [result] = await db.insert(vendors).values({
      vendorCode: code.trim(),
      vendorName: name.trim(),
    });
    const [inserted] = await db.select().from(vendors).where(eq(vendors.id, result.insertId));
    return inserted;
  } catch (err) {
    console.error('getOrCreateVendor error:', err);
    throw err;
  }
}

export async function createVendor(code: string, name: string) {
  return await getOrCreateVendor(code, name);
}

export async function updateVendor(id: number, code: string, name: string) {
  try {
    await db
      .update(vendors)
      .set({
        vendorCode: code.trim(),
        vendorName: name.trim(),
      })
      .where(eq(vendors.id, id));
    const [updated] = await db.select().from(vendors).where(eq(vendors.id, id));
    return updated;
  } catch (err) {
    console.error('updateVendor error:', err);
    throw err;
  }
}

export async function deleteVendor(id: number) {
  try {
    // Check if vendor has purchase transactions
    const txs = await db
      .select({ id: purchaseTransactions.id })
      .from(purchaseTransactions)
      .where(eq(purchaseTransactions.vendorId, id));
    if (txs.length > 0) {
      throw new Error(`Vendor tidak dapat dihapus karena tercatat dalam ${txs.length} transaksi penerimaan barang masuk.`);
    }

    // Unlink items referencing this vendor
    await db.update(items).set({ vendorId: null }).where(eq(items.vendorId, id));

    const [deleted] = await db.select().from(vendors).where(eq(vendors.id, id));
    await db.delete(vendors).where(eq(vendors.id, id));
    return deleted;
  } catch (err) {
    console.error('deleteVendor error:', err);
    throw err;
  }
}

// Item-Vendor Many-to-Many Relations
export async function getItemVendors(itemId: number) {
  try {
    const list = await db
      .select({
        id: itemVendors.id,
        vendorId: vendors.id,
        vendorCode: vendors.vendorCode,
        vendorName: vendors.vendorName,
      })
      .from(itemVendors)
      .innerJoin(vendors, eq(itemVendors.vendorId, vendors.id))
      .where(eq(itemVendors.itemId, itemId));
    return list;
  } catch (err) {
    console.error('getItemVendors error:', err);
    return [];
  }
}

export async function addItemVendor(itemId: number, vendorId: number, executor: InventoryExecutor = db) {
  try {
    const existing = await executor
      .select()
      .from(itemVendors)
      .where(and(eq(itemVendors.itemId, itemId), eq(itemVendors.vendorId, vendorId)));
    if (existing.length === 0) {
      await executor.insert(itemVendors).values({
        itemId,
        vendorId,
      });
    }
    // Update items.vendorId if not set
    const itemRows = await executor.select().from(items).where(eq(items.id, itemId));
    if (itemRows.length > 0 && !itemRows[0].vendorId) {
      await executor.update(items).set({ vendorId }).where(eq(items.id, itemId));
    }
    return true;
  } catch (err) {
    console.error('addItemVendor error:', err);
    throw err;
  }
}

export async function removeItemVendor(itemId: number, vendorId: number) {
  try {
    // Delete relation from item_vendors
    await db
      .delete(itemVendors)
      .where(and(eq(itemVendors.itemId, itemId), eq(itemVendors.vendorId, vendorId)));

    // Re-check remaining active vendors for items.vendorId
    const remaining = await db
      .select()
      .from(itemVendors)
      .where(eq(itemVendors.itemId, itemId));

    const nextVendorId = remaining.length > 0 ? remaining[0].vendorId : null;
    await db.update(items).set({ vendorId: nextVendorId }).where(eq(items.id, itemId));

    return { success: true, remainingCount: remaining.length };
  } catch (err) {
    console.error('removeItemVendor error:', err);
    throw err;
  }
}

export async function setItemVendors(itemId: number, vendorIds: number[]) {
  try {
    await db.delete(itemVendors).where(eq(itemVendors.itemId, itemId));
    for (const vId of vendorIds) {
      await db.insert(itemVendors).values({
        itemId,
        vendorId: vId,
      });
    }
    const nextVendorId = vendorIds.length > 0 ? vendorIds[0] : null;
    await db.update(items).set({ vendorId: nextVendorId }).where(eq(items.id, itemId));
    return true;
  } catch (err) {
    console.error('setItemVendors error:', err);
    throw err;
  }
}

export async function backfillAvgCostAfter() {
  try {
    const rows = await db
      .select({
        id: purchaseItems.id,
        itemId: purchaseItems.itemId,
        quantity: purchaseItems.quantity,
        price: purchaseItems.price,
        purchaseId: purchaseItems.purchaseId,
        avgCostAfter: purchaseItems.avgCostAfter,
      })
      .from(purchaseItems)
      .orderBy(purchaseItems.id);

    const hasNulls = rows.some((r) => r.avgCostAfter === null || r.avgCostAfter === undefined);
    if (!hasNulls && rows.length > 0) return;

    // Cumulative calculation per item
    const itemCumMap = new Map<number, { cumQty: number; cumVal: number }>();

    for (const row of rows) {
      const state = itemCumMap.get(row.itemId) || { cumQty: 0, cumVal: 0 };
      const newQty = state.cumQty + row.quantity;
      const newVal = state.cumVal + (row.quantity * row.price);
      const avgAfter = newQty > 0 ? Math.round(newVal / newQty) : row.price;

      itemCumMap.set(row.itemId, { cumQty: newQty, cumVal: newVal });

      if (row.avgCostAfter !== avgAfter) {
        await db
          .update(purchaseItems)
          .set({ avgCostAfter: avgAfter })
          .where(eq(purchaseItems.id, row.id));
      }
    }
  } catch (err) {
    console.error('backfillAvgCostAfter error:', err);
  }
}

export const HD_ITEMS_SEEDS = [
  { itemName: 'Ayam Mentah (kg)', vendorCode: 'VND-01', vendorName: 'Supplier Unggas & Daging', price: 38000, initialStock: 150 },
  { itemName: 'Kulit mentah (kg)', vendorCode: 'VND-01', vendorName: 'Supplier Unggas & Daging', price: 28000, initialStock: 80 },
  { itemName: 'Kulit matang (pcs)', vendorCode: 'VND-01', vendorName: 'Supplier Unggas & Daging', price: 15000, initialStock: 120 },
  { itemName: 'Tepung (pcs)', vendorCode: 'VND-02', vendorName: 'Distributor Bahan Baku Sembako', price: 18000, initialStock: 200 },
  { itemName: 'Beras (kg)', vendorCode: 'VND-02', vendorName: 'Distributor Bahan Baku Sembako', price: 15500, initialStock: 300 },
  { itemName: 'Minyak (lt)', vendorCode: 'VND-02', vendorName: 'Distributor Bahan Baku Sembako', price: 17000, initialStock: 250 },
  { itemName: 'S.Pedas (pack/60)', vendorCode: 'VND-03', vendorName: 'Supplier Saus & Bumbu HD', price: 45000, initialStock: 100 },
  { itemName: 'S.Tomat (pack/60)', vendorCode: 'VND-03', vendorName: 'Supplier Saus & Bumbu HD', price: 42000, initialStock: 90 },
  { itemName: 'S.BBQ', vendorCode: 'VND-03', vendorName: 'Supplier Saus & Bumbu HD', price: 48000, initialStock: 75 },
  { itemName: 'S.Geprek (pack/10)', vendorCode: 'VND-03', vendorName: 'Supplier Saus & Bumbu HD', price: 35000, initialStock: 110 },
  { itemName: 'S.Chili (pack/10)', vendorCode: 'VND-03', vendorName: 'Supplier Saus & Bumbu HD', price: 32000, initialStock: 85 },
  { itemName: 'K.Ayam (pack/100)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 30000, initialStock: 150 },
  { itemName: 'K.Nasi (pack/50)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 24000, initialStock: 180 },
  { itemName: 'Box Nasi (pack/10)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 28000, initialStock: 200 },
  { itemName: 'Tray Nasi (pack/10)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 22000, initialStock: 160 },
  { itemName: 'Plastic 15 (pack/100)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 18000, initialStock: 140 },
  { itemName: 'Plastic 24 (pack/100)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 25000, initialStock: 130 },
  { itemName: 'H.glove (pack/100)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 35000, initialStock: 100 },
  { itemName: 'Cup mika (pack/25)', vendorCode: 'VND-04', vendorName: 'Supplier Packaging & Plastik', price: 16000, initialStock: 120 },
];

export async function seedHDItemsIfEmpty() {
  try {
    await ensureItemCategorySchema();
    for (const seed of HD_ITEMS_SEEDS) {
      const vendor = await getOrCreateVendor(seed.vendorCode, seed.vendorName);
      const existing = await db
        .select()
        .from(items)
        .where(eq(items.itemName, seed.itemName));
      if (existing.length === 0) {
        const category = inferItemCategory(seed.itemName);
        await db.insert(items).values({
          itemName: seed.itemName,
          category,
          itemCode: await generateNextItemCode(category),
          price: seed.price,
          currentStock: seed.initialStock,
          vendorId: vendor.id,
        });
      }
    }
  } catch (err) {
    console.error('seedHDItemsIfEmpty error:', err);
  }
}

// Items & Inventory
// All vendors and dates contribute to the same Inventory item. Stock is not a weight.
const inventoryAverage = sql<number>`COALESCE((
  SELECT SUM(${purchaseItems.quantity} * ${purchaseItems.price}) / NULLIF(SUM(${purchaseItems.quantity}), 0)
  FROM ${purchaseItems}
  WHERE ${purchaseItems.itemId} = ${items.id}
    AND ${purchaseItems.quantity} > 0 AND ${purchaseItems.price} >= 0
), 0)`;

export async function recalculateItemAvgPurchasePrice(itemId: number, executor: InventoryExecutor = db) {
  await ensureItemCategorySchema();
  await executor.update(items).set({ avgPurchasePrice: inventoryAverage }).where(eq(items.id, itemId));
  const [item] = await executor.select({ avgPurchasePrice: items.avgPurchasePrice }).from(items).where(eq(items.id, itemId));
  return Number(item?.avgPurchasePrice ?? 0);
}

export async function syncAllItemAveragePrices() {
  await ensureItemCategorySchema();
  // A single statement also resets items without valid purchase history to zero.
  await db.update(items).set({ avgPurchasePrice: inventoryAverage });
}

let averagePricesReady: Promise<void> | undefined;
function ensureInventoryAveragePrices() {
  if (!averagePricesReady) {
    averagePricesReady = syncAllItemAveragePrices().then(() => backfillAvgCostAfter()).catch((err) => {
      averagePricesReady = undefined;
      throw err;
    });
  }
  return averagePricesReady;
}

export async function getInventory() {
  try {
    await ensureItemCategorySchema();
    await ensureInventoryAveragePrices();
    let rows = await db
      .select({
        id: items.id,
        itemName: items.itemName,
        category: items.category,
        itemCode: items.itemCode,
        price: items.price,
        avgPurchasePrice: items.avgPurchasePrice,
        currentStock: items.currentStock,
        vendorId: items.vendorId,
        vendorName: vendors.vendorName,
        vendorCode: vendors.vendorCode,
      })
      .from(items)
      .leftJoin(vendors, eq(items.vendorId, vendors.id))
      .orderBy(items.itemName);

    // Auto-seed HD items if catalog doesn't have them yet
    const hasHDItems = rows.some((r) => r.itemName.includes('Ayam Mentah') || r.itemName.includes('Kulit mentah'));
    if (!hasHDItems || rows.length < 10) {
      await seedHDItemsIfEmpty();
      rows = await db
        .select({
          id: items.id,
          itemName: items.itemName,
          category: items.category,
          itemCode: items.itemCode,
          price: items.price,
          avgPurchasePrice: items.avgPurchasePrice,
          currentStock: items.currentStock,
          vendorId: items.vendorId,
          vendorName: vendors.vendorName,
          vendorCode: vendors.vendorCode,
        })
        .from(items)
        .leftJoin(vendors, eq(items.vendorId, vendors.id))
        .orderBy(items.itemName);
    }

    // Load active vendors explicitly from item_vendors table
    // DO NOT use purchase_items historical vendor data, so unlinking a vendor immediately takes effect
    let activeVendorRows: Array<{
      itemId: number;
      vendorId: number;
      vendorName: string;
      vendorCode: string;
    }> = [];
    try {
      activeVendorRows = await db
        .select({
          itemId: itemVendors.itemId,
          vendorId: vendors.id,
          vendorName: vendors.vendorName,
          vendorCode: vendors.vendorCode,
        })
        .from(itemVendors)
        .innerJoin(vendors, eq(itemVendors.vendorId, vendors.id));
    } catch (err) {
      console.error('Failed to read item_vendors:', err);
    }

    // Map active vendors by itemId
    const activeVendorsMap = new Map<
      number,
      Array<{ id: number; vendorCode: string; vendorName: string }>
    >();

    activeVendorRows.forEach((av) => {
      if (!activeVendorsMap.has(av.itemId)) {
        activeVendorsMap.set(av.itemId, []);
      }
      activeVendorsMap.get(av.itemId)!.push({
        id: av.vendorId,
        vendorCode: av.vendorCode,
        vendorName: av.vendorName,
      });
    });

    // Map each item with strictly active vendors and accurate weighted average
    const inventoryItems = rows.map((r) => {
      let activeVendors = activeVendorsMap.get(r.id) || [];

      // Fallback: If item has items.vendorId but item_vendors has 0 entries, link it
      if (activeVendors.length === 0 && r.vendorId && r.vendorName) {
        activeVendors = [
          {
            id: r.vendorId,
            vendorCode: r.vendorCode || '',
            vendorName: r.vendorName,
          },
        ];
        // Asynchronously persist to item_vendors
        addItemVendor(r.id, r.vendorId).catch(() => { });
      }

      const vendorsSupplied = activeVendors.map((v) =>
        v.vendorCode ? `[${v.vendorCode}] ${v.vendorName}` : v.vendorName
      );

      let status: 'Available' | 'Low Stock' | 'Out of Stock' = 'Available';
      if (r.currentStock <= 0) status = 'Out of Stock';
      else if (r.currentStock <= 15) status = 'Low Stock';

      return {
        id: r.id,
        itemName: r.itemName,
        category: r.category,
        itemCode: r.itemCode,
        price: r.price, // Harga Katalog
        avgPurchasePrice: Number(r.avgPurchasePrice), // Harga Rata-Rata Pembelian (Weighted Average)
        currentStock: r.currentStock,
        vendorId: activeVendors[0]?.id || r.vendorId || undefined,
        vendorName: activeVendors[0]?.vendorName || r.vendorName || undefined,
        vendorCode: activeVendors[0]?.vendorCode || r.vendorCode || undefined,
        activeVendors,
        vendorIds: activeVendors.map((v) => v.id),
        vendorsSupplied,
        status,
      };
    });

    return inventoryItems;
  } catch (err) {
    console.error('getInventory error:', err);
    return [];
  }
}

type StockOpnameLine = {
  itemId: number;
  itemName: string;
  systemStock: number;
  physicalStock: number | null;
  difference: number | null;
  status: 'Sesuai' | 'Selisih' | 'Belum Diperiksa';
};

async function ensureStockOpnameTable() {
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS stock_opnames (
    id INT AUTO_INCREMENT PRIMARY KEY,
    examination_date VARCHAR(10) NOT NULL,
    notes LONGTEXT NULL,
    created_by VARCHAR(255) NOT NULL DEFAULT 'Warehouse',
    items_json LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`));
}

export async function saveStockOpname(data: {
  examinationDate: string;
  notes?: string;
  createdBy?: string;
  physicalStocks: Array<{ itemId: number; physicalStock: number | null }>;
}) {
  await ensureStockOpnameTable();
  const inventoryItems = await db.select({ id: items.id, itemName: items.itemName, currentStock: items.currentStock })
    .from(items).orderBy(items.itemName);
  const physicalById = new Map(data.physicalStocks.map((entry) => [entry.itemId, entry.physicalStock]));
  const opnameItems: StockOpnameLine[] = inventoryItems.map((item) => {
    const physicalStock = physicalById.get(item.id) ?? null;
    const systemStock = Number(item.currentStock);
    const difference = physicalStock === null ? null : physicalStock - systemStock;
    return {
      itemId: item.id,
      itemName: item.itemName,
      systemStock,
      physicalStock,
      difference,
      status: physicalStock === null ? 'Belum Diperiksa' : difference === 0 ? 'Sesuai' : 'Selisih',
    };
  });
  const result = await db.insert(stockOpnames).values({
    examinationDate: data.examinationDate,
    notes: data.notes?.trim() || null,
    createdBy: data.createdBy?.trim() || 'Warehouse',
    itemsJson: JSON.stringify(opnameItems),
  });
  const id = Number(result[0].insertId);
  return {
    id,
    examinationDate: data.examinationDate,
    notes: data.notes?.trim() || null,
    createdBy: data.createdBy?.trim() || 'Warehouse',
    items: opnameItems,
    createdAt: new Date().toISOString(),
  };
}

export async function getStockOpnameHistory() {
  await ensureStockOpnameTable();
  const rows = await db.select().from(stockOpnames).orderBy(desc(stockOpnames.examinationDate), desc(stockOpnames.id));
  return rows.map((row) => ({
    id: row.id,
    examinationDate: row.examinationDate,
    notes: row.notes || '',
    createdBy: row.createdBy,
    items: JSON.parse(row.itemsJson) as StockOpnameLine[],
    createdAt: row.createdAt,
  }));
}

export async function createItem(
  name: string,
  price: number,
  stock: number,
  category: ItemCategory,
  vendorId?: number,
  vendorIds?: number[]
) {
  try {
    await ensureItemCategorySchema();
    categoryPrefix(category);
    const cleanStock =
      stock !== undefined && stock !== null && String(stock).trim() !== '' && !isNaN(Number(stock)) && Number(stock) >= 0
        ? Number(stock)
        : 0;

    let result: any;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const itemCode = await generateNextItemCode(category);
        [result] = await db.insert(items).values({
          itemName: name.trim(),
          category,
          itemCode,
          price: Number(price),
          avgPurchasePrice: 0,
          currentStock: cleanStock,
          vendorId: vendorId || null,
        });
        break;
      } catch (error: any) {
        if ((error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) && attempt < 4) continue;
        throw error;
      }
    }
    const insertId = result.insertId;

    if (Array.isArray(vendorIds) && vendorIds.length > 0) {
      await setItemVendors(insertId, vendorIds);
    } else if (vendorId) {
      await addItemVendor(insertId, vendorId);
    }

    const [inserted] = await db.select().from(items).where(eq(items.id, insertId));
    return inserted;
  } catch (err) {
    console.error('createItem error:', err);
    throw err;
  }
}

export async function updateItem(
  id: number,
  data: {
    itemName?: string;
    category?: ItemCategory;
    price?: number;
    currentStock?: number;
    vendorId?: number | null;
    vendorIds?: number[];
  }
) {
  try {
    await ensureItemCategorySchema();
    const patch: any = {};
    if (data.itemName !== undefined && data.itemName !== null) patch.itemName = data.itemName.trim();
    if (data.price !== undefined && data.price !== null) patch.price = Number(data.price);

    // Logic Stok 0:
    // 0 -> VALID!
    // null, undefined, '', NaN, < 0 -> tidak valid
    if (data.currentStock !== undefined && data.currentStock !== null && String(data.currentStock).trim() !== '') {
      const parsedStock = Number(data.currentStock);
      if (!isNaN(parsedStock) && parsedStock >= 0) {
        patch.currentStock = parsedStock;
      }
    }

    if (data.vendorId !== undefined) {
      patch.vendorId = data.vendorId ? Number(data.vendorId) : null;
    }

    if (data.category !== undefined) {
      categoryPrefix(data.category);
      const [current] = await db.select({ category: items.category }).from(items).where(eq(items.id, id));
      if (current && current.category !== data.category) {
        patch.category = data.category;
      }
    }

    if (patch.category) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          patch.itemCode = await generateNextItemCode(patch.category);
          await db.update(items).set(patch).where(eq(items.id, id));
          break;
        } catch (error: any) {
          if ((error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) && attempt < 4) continue;
          throw error;
        }
      }
    } else if (Object.keys(patch).length > 0) {
      await db.update(items).set(patch).where(eq(items.id, id));
    }

    if (Array.isArray(data.vendorIds)) {
      await setItemVendors(id, data.vendorIds);
    } else if (data.vendorId) {
      await addItemVendor(id, Number(data.vendorId));
    }

    const [updated] = await db.select().from(items).where(eq(items.id, id));
    return updated;
  } catch (err) {
    console.error('updateItem error:', err);
    throw err;
  }
}

export async function deleteItem(id: number) {
  try {
    await ensureItemCategorySchema();
    const [pItems, rItems] = await Promise.all([
      db.select({ id: purchaseItems.id }).from(purchaseItems).where(eq(purchaseItems.itemId, id)),
      db.select({ id: requestItems.id }).from(requestItems).where(eq(requestItems.itemId, id)),
    ]);

    if (pItems.length > 0 || rItems.length > 0) {
      throw new Error(
        `Barang tidak dapat dihapus karena sudah memiliki riwayat transaksi (${pItems.length} penerimaan, ${rItems.length} permintaan).`
      );
    }

    const [deleted] = await db.select().from(items).where(eq(items.id, id));
    await db.delete(itemVendors).where(eq(itemVendors.itemId, id));
    await db.delete(stockMovements).where(eq(stockMovements.itemId, id));
    await db.delete(items).where(eq(items.id, id));
    return deleted;
  } catch (err) {
    console.error('deleteItem error:', err);
    throw err;
  }
}

export async function createMasterItem(data: {
  vendorCode: string;
  vendorName: string;
  itemName: string;
  category?: ItemCategory;
  price: number;
  initialStock?: number;
}) {
  try {
    await ensureItemCategorySchema();
    const vendor = await getOrCreateVendor(data.vendorCode, data.vendorName);
    const existing = await db
      .select()
      .from(items)
      .where(eq(items.itemName, data.itemName.trim()));

    const cleanStock =
      data.initialStock !== undefined &&
        data.initialStock !== null &&
        String(data.initialStock).trim() !== '' &&
        !isNaN(Number(data.initialStock)) &&
        Number(data.initialStock) >= 0
        ? Number(data.initialStock)
        : 0;

    if (existing.length > 0) {
      const existingItem = existing[0];
      // Update data master katalog tanpa merusak harga rata-rata pembelian (weighted average)
      const category = data.category || existingItem.category;
      categoryPrefix(category);
      const categoryChanged = category !== existingItem.category;
      const patch: any = {
          price: data.price, // Harga katalog murni
          vendorId: vendor.id,
          currentStock: existingItem.currentStock + cleanStock,
      };
      if (categoryChanged) {
        patch.category = category;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            patch.itemCode = await generateNextItemCode(category);
            await db.update(items).set(patch).where(eq(items.id, existingItem.id));
            break;
          } catch (error: any) {
            if ((error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) && attempt < 4) continue;
            throw error;
          }
        }
      } else {
        await db.update(items).set(patch).where(eq(items.id, existingItem.id));
      }

      await addItemVendor(existingItem.id, vendor.id);

      const [updated] = await db.select().from(items).where(eq(items.id, existingItem.id));
      return {
        item: updated,
        vendor,
        isNew: false,
        previousPrice: existingItem.price,
      };
    }

    const category = data.category || inferItemCategory(data.itemName);
    categoryPrefix(category);
    let result: any;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        [result] = await db.insert(items).values({
          itemName: data.itemName.trim(),
          category,
          itemCode: await generateNextItemCode(category),
          price: data.price,
          avgPurchasePrice: 0,
          currentStock: cleanStock,
          vendorId: vendor.id,
        });
        break;
      } catch (error: any) {
        if ((error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) && attempt < 4) continue;
        throw error;
      }
    }

    await addItemVendor(result.insertId, vendor.id);

    const [inserted] = await db.select().from(items).where(eq(items.id, result.insertId));

    return { item: inserted, vendor, isNew: true };
  } catch (err) {
    console.error('createMasterItem error:', err);
    throw err;
  }
}

// Generate unique transaction code IN-xxx based on highest existing number
export async function generateNextTransactionCode(): Promise<string> {
  const existingRows = await db
    .select({ transactionCode: purchaseTransactions.transactionCode })
    .from(purchaseTransactions);

  let maxNum = 0;
  const existingCodes = new Set<string>();
  for (const r of existingRows) {
    if (r.transactionCode) {
      existingCodes.add(r.transactionCode);
      const match = r.transactionCode.match(/^IN-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  let nextNum = maxNum + 1;
  let code = `IN-${String(nextNum).padStart(3, '0')}`;
  while (existingCodes.has(code)) {
    nextNum++;
    code = `IN-${String(nextNum).padStart(3, '0')}`;
  }
  return code;
}

function validateIncomingItems(rows: Array<{ itemName: string; quantity: number; price: number }>) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Daftar barang penerimaan harus diisi');
  for (const row of rows) {
    if (!row || typeof row.itemName !== 'string' || !row.itemName.trim()
      || !Number.isSafeInteger(row.quantity) || row.quantity <= 0
      || !Number.isSafeInteger(row.price) || row.price < 0
      || !Number.isSafeInteger(row.quantity * row.price)) {
      throw new Error('Nama barang, quantity positif, dan harga pembelian yang valid wajib diisi');
    }
  }
}

// Incoming Purchases (Barang Masuk)
export async function registerIncomingGoods(data: {
  vendorCode: string;
  vendorName: string;
  paymentMethod: string;
  transactionDate: string;
  transactionCode?: string;
  items: Array<{
    itemId?: number;
    itemName: string;
    price: number;
    quantity: number;
  }>;
  createdBy?: string;
}) {
  try {
    await ensureItemCategorySchema();
    validateIncomingItems(data.items);
    const vendor = await getOrCreateVendor(data.vendorCode, data.vendorName);

    // Generate transaction code IN-xxx safely avoiding any duplicates
    let transactionCode = data.transactionCode?.trim();
    if (!transactionCode) {
      transactionCode = await generateNextTransactionCode();
    } else {
      const [existing] = await db
        .select({ id: purchaseTransactions.id })
        .from(purchaseTransactions)
        .where(eq(purchaseTransactions.transactionCode, transactionCode));
      if (existing) {
        transactionCode = await generateNextTransactionCode();
      }
    }

    // Subtotal = Quantity * Harga Beli Input Manual
    let totalAmount = 0;
    for (const it of data.items) {
      totalAmount += it.price * it.quantity;
    }

    return await db.transaction(async (tx) => {
      const [txResult] = await tx.insert(purchaseTransactions).values({
        transactionCode,
        vendorId: vendor.id,
        paymentMethod: data.paymentMethod || 'Transfer',
        transactionDate: data.transactionDate,
        totalAmount,
        createdBy: data.createdBy || 'Staff Gudang',
      });
      const [purchase] = await tx
        .select()
        .from(purchaseTransactions)
        .where(eq(purchaseTransactions.id, txResult.insertId));

      for (const it of data.items) {
        let actualItemId = it.itemId;
        let existingItem: typeof items.$inferSelect | null = null;

        if (actualItemId) {
          const found = await tx.select().from(items).where(eq(items.id, actualItemId)).for('update');
          if (found.length > 0) {
            existingItem = found[0];
          }
        }

        if (!existingItem) {
          // Resolve one catalog item across vendors, and lock before changing its stock/history.
          const [matched] = await tx.select().from(items)
            .where(sql`LOWER(TRIM(${items.itemName})) = ${it.itemName.trim().toLowerCase()}`)
            .for('update');
          if (matched) {
            existingItem = matched;
            actualItemId = matched.id;
          }
        }

        if (existingItem) {
          // KETENTUAN PENTING:
          // 1. JANGAN mengubah harga katalog (items.price)!
          // 2. Tambah stok gudang
          // 3. Update vendor pengirim terakhir
          await tx.update(items).set({
            vendorId: vendor.id,
            currentStock: sql`${items.currentStock} + ${it.quantity}`,
          }).where(eq(items.id, existingItem.id));
          actualItemId = existingItem.id;
        } else {
          // Create item baru jika belum ada sama sekali di katalog
          const category = inferItemCategory(it.itemName);
          let newItemResult: any;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              [newItemResult] = await tx.insert(items).values({
                itemName: it.itemName.trim(),
                category,
                itemCode: await generateNextItemCode(category, tx),
                price: it.price, // Inisialisasi harga katalog awal
                avgPurchasePrice: it.price,
                currentStock: it.quantity,
                vendorId: vendor.id,
              });
              break;
            } catch (error: any) {
              if ((error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) && attempt < 4) continue;
              throw error;
            }
          }
          actualItemId = newItemResult.insertId;
        }

        // Record manual purchase price; fill the history snapshot after all lines are saved.
        // Subtotal = Quantity * Harga Beli Input
        await tx.insert(purchaseItems).values({
          purchaseId: purchase.id,
          itemId: actualItemId,
          quantity: it.quantity,
          price: it.price,
          subtotal: it.quantity * it.price,
          avgCostAfter: null,
        });

        // Link vendor to item in item_vendors if not already linked
        await addItemVendor(actualItemId, vendor.id, tx);

        // Record stock movement (Barang Masuk)
        await tx.insert(stockMovements).values({
          itemId: actualItemId,
          movementType: 'IN',
          quantity: it.quantity,
          referenceId: transactionCode,
          createdBy: data.createdBy || 'Staff Gudang',
        });

      }

      const receivedItems = await tx.select({ itemId: purchaseItems.itemId }).from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, purchase.id));
      for (const itemId of new Set(receivedItems.map((row) => row.itemId))) {
        const avgPrice = await recalculateItemAvgPurchasePrice(itemId, tx);
        // Keep the existing integer history snapshot; Inventory retains the decimal average.
        await tx.update(purchaseItems).set({ avgCostAfter: Math.round(avgPrice) })
          .where(and(eq(purchaseItems.purchaseId, purchase.id), eq(purchaseItems.itemId, itemId)));
      }

      // Retrieve all saved items for this purchase transaction
      const allTxItems = await tx
        .select({
          id: purchaseItems.id,
          purchaseId: purchaseItems.purchaseId,
          itemId: purchaseItems.itemId,
          itemName: items.itemName,
          quantity: purchaseItems.quantity,
          price: purchaseItems.price,
          subtotal: purchaseItems.subtotal,
          avgCostAfter: purchaseItems.avgCostAfter,
        })
        .from(purchaseItems)
        .leftJoin(items, eq(purchaseItems.itemId, items.id))
        .where(eq(purchaseItems.purchaseId, purchase.id));

      return {
        ...purchase,
        items: allTxItems,
      };
    }, { isolationLevel: 'read committed' });
  } catch (err) {
    console.error('registerIncomingGoods error:', err);
    throw err;
  }
}

// HD R&S (Gudang) Receiving / Penerimaan List
export async function registerHDReceiving(data: {
  transactionDate?: string;
  paymentMethod?: string;
  notes?: string;
  createdBy?: string;
  items: Array<{
    itemId?: number;
    itemName: string;
    vendorCode?: string;
    vendorName?: string;
    price: number;
    quantity: number;
  }>;
}) {
  try {
    validateIncomingItems(data.items);
    // Group items by vendor
    const vendorMap = new Map<
      string,
      {
        vendorCode: string;
        vendorName: string;
        items: Array<{
          itemId?: number;
          itemName: string;
          price: number;
          quantity: number;
        }>;
      }
    >();

    for (const it of data.items) {
      const vCode = it.vendorCode || 'VND-01';
      const vName = it.vendorName || 'Supplier HD';
      const key = `${vCode}__${vName}`;
      if (!vendorMap.has(key)) {
        vendorMap.set(key, { vendorCode: vCode, vendorName: vName, items: [] });
      }
      vendorMap.get(key)!.items.push({
        itemId: it.itemId,
        itemName: it.itemName,
        price: it.price,
        quantity: it.quantity,
      });
    }

    const createdPurchases = [];
    for (const [, grp] of vendorMap.entries()) {
      const res = await registerIncomingGoods({
        vendorCode: grp.vendorCode,
        vendorName: grp.vendorName,
        paymentMethod: data.paymentMethod || 'Transfer',
        transactionDate: data.transactionDate || new Date().toISOString().split('T')[0],
        items: grp.items,
        createdBy: data.createdBy || 'Staff Gudang',
      });
      createdPurchases.push(res);
    }

    return createdPurchases;
  } catch (err) {
    console.error('registerHDReceiving error:', err);
    throw err;
  }
}

// User Requests (Permintaan)
// Generate unique request code REQ-xxx based on highest existing number
export async function generateNextRequestCode(): Promise<string> {
  const existingRows = await db
    .select({ requestCode: requests.requestCode })
    .from(requests);

  let maxNum = 0;
  const existingCodes = new Set<string>();
  for (const r of existingRows) {
    if (r.requestCode) {
      existingCodes.add(r.requestCode);
      const match = r.requestCode.match(/^REQ-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  let nextNum = maxNum + 1;
  let code = `REQ-${String(nextNum).padStart(3, '0')}`;
  while (existingCodes.has(code)) {
    nextNum++;
    code = `REQ-${String(nextNum).padStart(3, '0')}`;
  }
  return code;
}

export async function createRequest(data: {
  userId?: number;
  requesterName: string;
  paymentMethod: string;
  requestDate: string;
  requestCode?: string;
  items: Array<{
    itemId: number;
    quantity: number;
    price: number;
  }>;
}) {
  try {
    let requestCode = data.requestCode?.trim();
    if (!requestCode) {
      requestCode = await generateNextRequestCode();
    } else {
      const [existing] = await db
        .select({ id: requests.id })
        .from(requests)
        .where(eq(requests.requestCode, requestCode));
      if (existing) {
        requestCode = await generateNextRequestCode();
      }
    }

    let totalAmount = 0;
    for (const it of data.items) {
      totalAmount += it.price * it.quantity;
    }

    const [reqResult] = await db.insert(requests).values({
      requestCode,
      userId: data.userId || null,
      requesterName: data.requesterName,
      paymentMethod: data.paymentMethod || 'Transfer',
      requestDate: data.requestDate,
      status: 'Pending',
      totalAmount,
    });
    const [reqRecord] = await db.select().from(requests).where(eq(requests.id, reqResult.insertId));

    for (const it of data.items) {
      await db.insert(requestItems).values({
        requestId: reqRecord.id,
        itemId: it.itemId,
        requestedQuantity: it.quantity,
        approvedQuantity: 0,
        price: it.price,
        status: 'Pending',
      });
    }

    return reqRecord;
  } catch (err) {
    console.error('createRequest error:', err);
    throw err;
  }
}

export async function getRequests(filters?: {
  userId?: number;
  startDate?: string;
  endDate?: string;
  status?: string;
}) {
  try {
    let reqs = await db.select().from(requests).orderBy(desc(requests.requestDate), desc(requests.id));

    if (filters?.userId) {
      reqs = reqs.filter((r) => r.userId === filters.userId);
    }
    if (filters?.startDate) {
      reqs = reqs.filter((r) => r.requestDate >= filters.startDate!);
    }
    if (filters?.endDate) {
      reqs = reqs.filter((r) => r.requestDate <= filters.endDate!);
    }
    if (filters?.status && filters.status !== 'Semua Status' && filters.status !== 'ALL') {
      reqs = reqs.filter((r) => r.status === filters.status);
    }

    // Attach item summary
    const allItems = await db
      .select({
        id: requestItems.id,
        requestId: requestItems.requestId,
        itemId: requestItems.itemId,
        itemName: items.itemName,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
        price: requestItems.price,
        status: requestItems.status,
      })
      .from(requestItems)
      .leftJoin(items, eq(requestItems.itemId, items.id));

    return reqs.map((r) => {
      const matchingItems = allItems.filter((it) => it.requestId === r.id);
      return {
        ...r,
        itemCount: matchingItems.length,
        itemSummary: matchingItems.map((i) => i.itemName || 'Barang').join(', '),
        items: matchingItems,
      };
    });
  } catch (err) {
    console.error('getRequests error:', err);
    return [];
  }
}

export async function getRequestDetail(id: number) {
  try {
    const reqList = await db.select().from(requests).where(eq(requests.id, id));
    if (reqList.length === 0) return null;
    const request = reqList[0];

    const rItems = await db
      .select({
        id: requestItems.id,
        requestId: requestItems.requestId,
        itemId: requestItems.itemId,
        itemName: items.itemName,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
        price: requestItems.price,
        status: requestItems.status,
        currentStock: items.currentStock,
        approvedBy: requestItems.approvedBy,
        approvedAt: requestItems.approvedAt,
      })
      .from(requestItems)
      .leftJoin(items, eq(requestItems.itemId, items.id))
      .where(eq(requestItems.requestId, id));

    return {
      ...request,
      items: rItems,
    };
  } catch (err) {
    console.error('getRequestDetail error:', err);
    return null;
  }
}

// Approval & Rejection Logic
export async function updateRequestItemStatus(
  requestId: number,
  requestItemId: number,
  decision: 'Approve' | 'Reject',
  staffName: string = 'Staff Gudang',
  approvedQuantity?: number
) {
  try {
    // 1. Get the item
    const rItemRows = await db
      .select({
        id: requestItems.id,
        requestId: requestItems.requestId,
        itemId: requestItems.itemId,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
        status: requestItems.status,
        currentStock: items.currentStock,
        itemName: items.itemName,
        requestCode: requests.requestCode,
      })
      .from(requestItems)
      .innerJoin(requests, eq(requestItems.requestId, requests.id))
      .innerJoin(items, eq(requestItems.itemId, items.id))
      .where(eq(requestItems.id, requestItemId));

    if (rItemRows.length === 0) {
      throw new Error('Item permintaan tidak ditemukan');
    }

    const rItem = rItemRows[0];

    // Prevent re-approval duplicate deduction
    if (decision === 'Approve') {
      if (rItem.status === 'Approved') {
        return { success: true, message: 'Barang sudah disetujui sebelumnya' };
      }

      // Dukung persetujuan sebagian (misal minta 10 disetujui 7)
      const qtyToApprove =
        approvedQuantity !== undefined && approvedQuantity > 0
          ? Math.min(Number(approvedQuantity), rItem.requestedQuantity)
          : rItem.requestedQuantity;

      if (qtyToApprove <= 0) {
        throw new Error('Jumlah barang yang disetujui minimal 1 pcs');
      }

      if (rItem.currentStock < qtyToApprove) {
        throw new Error(
          `Stock tidak mencukupi untuk "${rItem.itemName}"! Tersedia: ${rItem.currentStock} pcs, Ingin disetujui: ${qtyToApprove} pcs`
        );
      }

      const today = new Date().toISOString().split('T')[0];

      // Reduce stock sesuai kuantitas yang disetujui
      await db
        .update(items)
        .set({
          currentStock: sql`${items.currentStock} - ${qtyToApprove}`,
        })
        .where(eq(items.id, rItem.itemId));

      // Update request item
      await db
        .update(requestItems)
        .set({
          approvedQuantity: qtyToApprove,
          status: 'Approved',
          approvedBy: staffName,
          approvedAt: today,
        })
        .where(eq(requestItems.id, requestItemId));

      // Record stock movement (Barang Keluar)
      await db.insert(stockMovements).values({
        itemId: rItem.itemId,
        movementType: 'OUT',
        quantity: qtyToApprove,
        referenceId: rItem.requestCode,
        createdBy: staffName,
      });
    } else {
      // Rejection logic:
      // If was previously approved, restore stock
      if (rItem.status === 'Approved' && rItem.approvedQuantity > 0) {
        await db
          .update(items)
          .set({
            currentStock: sql`${items.currentStock} + ${rItem.approvedQuantity}`,
          })
          .where(eq(items.id, rItem.itemId));
      }

      const today = new Date().toISOString().split('T')[0];
      await db
        .update(requestItems)
        .set({
          approvedQuantity: 0,
          status: 'Rejected',
          approvedBy: staffName,
          approvedAt: today,
        })
        .where(eq(requestItems.id, requestItemId));
    }

    // Recalculate overall request status
    const allItemsInReq = await db
      .select({
        status: requestItems.status,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
      })
      .from(requestItems)
      .where(eq(requestItems.requestId, requestId));

    let newStatus: 'Pending' | 'Partially Approved' | 'Approved' | 'Rejected' = 'Pending';
    const statuses = allItemsInReq.map((i) => i.status);
    const hasPending = statuses.includes('Pending');
    const hasApproved = statuses.includes('Approved');
    const hasRejected = statuses.includes('Rejected');
    const anyPartialQty = allItemsInReq.some(
      (i) => i.status === 'Approved' && i.approvedQuantity < i.requestedQuantity
    );

    if (hasPending) {
      if (hasApproved || hasRejected) {
        newStatus = 'Partially Approved';
      } else {
        newStatus = 'Pending';
      }
    } else {
      if (hasApproved && !hasRejected) {
        newStatus = anyPartialQty ? 'Partially Approved' : 'Approved';
      } else if (!hasApproved && hasRejected) {
        newStatus = 'Rejected';
      } else if (hasApproved && hasRejected) {
        newStatus = 'Partially Approved';
      }
    }

    await db.update(requests).set({ status: newStatus }).where(eq(requests.id, requestId));

    return { success: true, newStatus };
  } catch (err: any) {
    console.error('updateRequestItemStatus error:', err);
    throw err;
  }
}

// Batch Approve All Items in a Request
export async function approveAllRequestItems(
  requestId: number,
  customQuantities?: Record<number, number>,
  staffName: string = 'Staff Gudang'
) {
  try {
    const rItems = await db
      .select({
        id: requestItems.id,
        itemId: requestItems.itemId,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
        status: requestItems.status,
        currentStock: items.currentStock,
        itemName: items.itemName,
        requestCode: requests.requestCode,
      })
      .from(requestItems)
      .innerJoin(requests, eq(requestItems.requestId, requests.id))
      .innerJoin(items, eq(requestItems.itemId, items.id))
      .where(eq(requestItems.requestId, requestId));

    if (rItems.length === 0) {
      throw new Error('Permintaan tidak memiliki item barang');
    }

    const pendingItems = rItems.filter((i) => i.status === 'Pending');
    if (pendingItems.length === 0) {
      return { success: true, message: 'Semua barang sudah diproses sebelumnya' };
    }

    // 1. Validasi stok semua item sebelum memproses
    for (const it of pendingItems) {
      const desiredQty =
        customQuantities && customQuantities[it.id] !== undefined
          ? Math.min(Number(customQuantities[it.id]), it.requestedQuantity)
          : it.requestedQuantity;

      if (desiredQty > 0 && it.currentStock < desiredQty) {
        throw new Error(
          `Stok tidak mencukupi untuk "${it.itemName}"! Tersedia: ${it.currentStock} pcs, Ingin disetujui: ${desiredQty} pcs`
        );
      }
    }

    const today = new Date().toISOString().split('T')[0];

    // 2. Eksekusi persetujuan setiap item
    for (const it of pendingItems) {
      const desiredQty =
        customQuantities && customQuantities[it.id] !== undefined
          ? Math.min(Number(customQuantities[it.id]), it.requestedQuantity)
          : it.requestedQuantity;

      const qtyToApprove = Math.max(0, desiredQty);

      if (qtyToApprove === 0) {
        await db
          .update(requestItems)
          .set({
            approvedQuantity: 0,
            status: 'Rejected',
            approvedBy: staffName,
            approvedAt: today,
          })
          .where(eq(requestItems.id, it.id));
      } else {
        // Kurangi stok
        await db
          .update(items)
          .set({
            currentStock: sql`${items.currentStock} - ${qtyToApprove}`,
          })
          .where(eq(items.id, it.itemId));

        // Update request item
        await db
          .update(requestItems)
          .set({
            approvedQuantity: qtyToApprove,
            status: 'Approved',
            approvedBy: staffName,
            approvedAt: today,
          })
          .where(eq(requestItems.id, it.id));

        // Catat mutasi barang keluar
        await db.insert(stockMovements).values({
          itemId: it.itemId,
          movementType: 'OUT',
          quantity: qtyToApprove,
          referenceId: it.requestCode,
          createdBy: staffName,
        });
      }
    }

    // 3. Hitung ulang status keseluruhan permintaan
    const allItemsInReq = await db
      .select({
        status: requestItems.status,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
      })
      .from(requestItems)
      .where(eq(requestItems.requestId, requestId));

    const statuses = allItemsInReq.map((i) => i.status);
    const hasPending = statuses.includes('Pending');
    const hasApproved = statuses.includes('Approved');
    const hasRejected = statuses.includes('Rejected');
    const anyPartialQty = allItemsInReq.some(
      (i) => i.status === 'Approved' && i.approvedQuantity < i.requestedQuantity
    );

    let newStatus: 'Pending' | 'Partially Approved' | 'Approved' | 'Rejected' = 'Pending';
    if (hasPending) {
      newStatus = hasApproved || hasRejected ? 'Partially Approved' : 'Pending';
    } else {
      if (hasApproved && !hasRejected) {
        newStatus = anyPartialQty ? 'Partially Approved' : 'Approved';
      } else if (!hasApproved && hasRejected) {
        newStatus = 'Rejected';
      } else if (hasApproved && hasRejected) {
        newStatus = 'Partially Approved';
      }
    }

    await db.update(requests).set({ status: newStatus }).where(eq(requests.id, requestId));

    return { success: true, newStatus };
  } catch (err: any) {
    console.error('approveAllRequestItems error:', err);
    throw err;
  }
}

// History Queries
export async function getIncomingHistory(startDate?: string, endDate?: string) {
  try {
    let txs = await db
      .select({
        id: purchaseTransactions.id,
        transactionCode: purchaseTransactions.transactionCode,
        vendorId: purchaseTransactions.vendorId,
        vendorName: vendors.vendorName,
        vendorCode: vendors.vendorCode,
        paymentMethod: purchaseTransactions.paymentMethod,
        transactionDate: purchaseTransactions.transactionDate,
        totalAmount: purchaseTransactions.totalAmount,
        createdBy: purchaseTransactions.createdBy,
        createdAt: purchaseTransactions.createdAt,
      })
      .from(purchaseTransactions)
      .leftJoin(vendors, eq(purchaseTransactions.vendorId, vendors.id))
      .orderBy(desc(purchaseTransactions.transactionDate), desc(purchaseTransactions.id));

    if (startDate) txs = txs.filter((t) => t.transactionDate >= startDate);
    if (endDate) txs = txs.filter((t) => t.transactionDate <= endDate);

    // Attach items to each transaction
    const pItems = await db
      .select({
        id: purchaseItems.id,
        purchaseId: purchaseItems.purchaseId,
        itemId: purchaseItems.itemId,
        itemName: items.itemName,
        quantity: purchaseItems.quantity,
        price: purchaseItems.price,
        subtotal: purchaseItems.subtotal,
        avgCostAfter: purchaseItems.avgCostAfter,
      })
      .from(purchaseItems)
      .leftJoin(items, eq(purchaseItems.itemId, items.id));

    return txs.map((t) => {
      const itemsForTx = pItems
        .filter((pi) => pi.purchaseId === t.id)
        .map((pi) => ({
          ...pi,
          vendorName: t.vendorName,
          vendorCode: t.vendorCode,
          avgCostAfter: pi.avgCostAfter,
        }));
      return {
        ...t,
        itemCount: itemsForTx.length,
        itemSummary: itemsForTx.map((i) => `${i.itemName} (+${i.quantity} pcs)`).join(', '),
        items: itemsForTx,
      };
    });
  } catch (err) {
    console.error('getIncomingHistory error:', err);
    return [];
  }
}

export async function getOutgoingHistory(startDate?: string, endDate?: string) {
  try {
    // Return requests that have at least one approved item
    let reqs = await db
      .select()
      .from(requests)
      .orderBy(desc(requests.requestDate), desc(requests.id));

    if (startDate) reqs = reqs.filter((r) => r.requestDate >= startDate);
    if (endDate) reqs = reqs.filter((r) => r.requestDate <= endDate);

    const rItems = await db
      .select({
        id: requestItems.id,
        requestId: requestItems.requestId,
        itemId: requestItems.itemId,
        itemName: items.itemName,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
        price: requestItems.price,
        status: requestItems.status,
        approvedBy: requestItems.approvedBy,
        approvedAt: requestItems.approvedAt,
      })
      .from(requestItems)
      .leftJoin(items, eq(requestItems.itemId, items.id));

    // Only include requests that have approved items
    const results = [];
    for (const r of reqs) {
      const reqItemsList = rItems.filter((i) => i.requestId === r.id);
      const approvedItems = reqItemsList.filter((i) => i.status === 'Approved');
      if (approvedItems.length > 0) {
        const approvedTotal = approvedItems.reduce((sum, item) => sum + item.approvedQuantity * item.price, 0);
        results.push({
          ...r,
          totalApprovedAmount: approvedTotal,
          itemCount: approvedItems.length,
          itemSummary: approvedItems.map((i) => `${i.itemName} (-${i.approvedQuantity} pcs)`).join(', '),
          items: reqItemsList, // includes approved and rejected for full detail
          approvedItems,
        });
      }
    }

    return results;
  } catch (err) {
    console.error('getOutgoingHistory error:', err);
    return [];
  }
}

// Dashboard statistics
export async function getUserDashboardStats(userId?: number) {
  try {
    const allReqs = await getRequests(userId ? { userId } : undefined);
    const total = allReqs.length;
    const pending = allReqs.filter((r) => r.status === 'Pending').length;
    const approved = allReqs.filter((r) => r.status === 'Approved' || r.status === 'Partially Approved').length;
    const rejected = allReqs.filter((r) => r.status === 'Rejected').length;

    return {
      total,
      pending,
      approved,
      rejected,
      recentRequests: allReqs.slice(0, 5),
    };
  } catch (err) {
    console.error('getUserDashboardStats error:', err);
    return { total: 0, pending: 0, approved: 0, rejected: 0, recentRequests: [] };
  }
}

export async function getWarehouseDashboardStats(startDate?: string, endDate?: string, itemIds?: number[], outletNames?: string[], categories?: ItemCategory[]) {
  try {
    await ensureInventoryAveragePrices();
    // 1. Total Stock
    const stockSumRows = await db
      .select({ total: sql<number>`COALESCE(SUM(${items.currentStock}), 0)` })
      .from(items);
    const totalStock = Number(stockSumRows[0]?.total || 0);

    // 2. Total Incoming (pcs)
    let inMovements = await db
      .select({
        id: stockMovements.id,
        movementType: stockMovements.movementType,
        quantity: stockMovements.quantity,
        referenceId: stockMovements.referenceId,
        itemName: items.itemName,
        createdAt: stockMovements.createdAt,
      })
      .from(stockMovements)
      .leftJoin(items, eq(stockMovements.itemId, items.id))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id));

    if (startDate) {
      inMovements = inMovements.filter((m) => {
        const dateStr = m.createdAt ? new Date(m.createdAt).toISOString().split('T')[0] : '';
        return dateStr >= startDate;
      });
    }
    if (endDate) {
      inMovements = inMovements.filter((m) => {
        const dateStr = m.createdAt ? new Date(m.createdAt).toISOString().split('T')[0] : '';
        return dateStr <= endDate;
      });
    }

    const barangMasukPcs = inMovements
      .filter((m) => m.movementType === 'IN')
      .reduce((sum, m) => sum + m.quantity, 0);

    const barangKeluarPcs = inMovements
      .filter((m) => m.movementType === 'OUT')
      .reduce((sum, m) => sum + m.quantity, 0);

    // 3. Request Pending
    const pendingReqRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(requests)
      .where(eq(requests.status, 'Pending'));
    const requestPending = Number(pendingReqRows[0]?.count || 0);

    // 4. Riwayat Masuk (Total Belanja Masuk Gudang)
    let pTxs = await db
      .select({
        totalAmount: purchaseTransactions.totalAmount,
        transactionDate: purchaseTransactions.transactionDate,
      })
      .from(purchaseTransactions);
    if (startDate) {
      pTxs = pTxs.filter((t) => t.transactionDate >= startDate);
    }
    if (endDate) {
      pTxs = pTxs.filter((t) => t.transactionDate <= endDate);
    }
    const totalIncomingAmount = pTxs.reduce((sum, t) => sum + Number(t.totalAmount || 0), 0);

    // 5. Recent transactions list for dashboard
    const recentTransactions = inMovements.slice(0, 8).map((m) => ({
      id: m.id,
      itemName: m.itemName || 'Barang',
      quantity: m.quantity,
      movementType: m.movementType as 'IN' | 'OUT',
      typeLabel: m.movementType === 'IN' ? 'Barang Masuk' : 'Barang Keluar',
      date: m.createdAt ? new Date(m.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '16 Sep 2026',
      referenceId: m.referenceId,
    }));

    // 6. Item Profitability Calculation (Warehouse Dashboard Improvement)
    // - Harga rata-rata pembelian menggunakan field Inventory items.avgPurchasePrice
    // - Harga katalog diambil dari master katalog barang (items.price)
    // - Kuantitas diambil dari transaksi barang ke outlet yang sudah disetujui (requestItems.status = 'Approved')
    const allItems = await db.select().from(items).orderBy(items.itemName);
    const itemList = allItems.map((it) => ({ id: it.id, itemName: it.itemName }));

    let allReqs = await db.select().from(requests);
    if (startDate) {
      allReqs = allReqs.filter((r) => r.requestDate >= startDate);
    }
    if (endDate) {
      allReqs = allReqs.filter((r) => r.requestDate <= endDate);
    }
    if (outletNames?.length) {
      const selectedOutlets = new Set(outletNames);
      allReqs = allReqs.filter((r) => Array.from(selectedOutlets).some(
        (outlet) => r.requesterName === outlet || r.requesterName.startsWith(`${outlet} (`)
      ));
    }

    const validReqIds = new Set(allReqs.map((r) => r.id));

    const approvedReqItems = await db
      .select({
        id: requestItems.id,
        requestId: requestItems.requestId,
        itemId: requestItems.itemId,
        approvedQuantity: requestItems.approvedQuantity,
        price: requestItems.price,
        status: requestItems.status,
      })
      .from(requestItems)
      .where(eq(requestItems.status, 'Approved'));

    // Filter by valid requests in date range with approved quantity > 0
    const filteredReqItems = approvedReqItems.filter(
      (ri) => validReqIds.has(ri.requestId) && ri.approvedQuantity > 0
    );

    // Aggregate quantity per item
    const qtyByItemId = new Map<number, number>();
    for (const ri of filteredReqItems) {
      const current = qtyByItemId.get(ri.itemId) || 0;
      qtyByItemId.set(ri.itemId, current + ri.approvedQuantity);
    }

    // Aggregate receiving lines independently from outlet quantities, joined by Inventory item ID.
    const purchaseConditions = [sql`${purchaseItems.quantity} > 0`, sql`${purchaseItems.price} >= 0`];
    if (startDate) purchaseConditions.push(gte(purchaseTransactions.transactionDate, startDate));
    if (endDate) purchaseConditions.push(lte(purchaseTransactions.transactionDate, endDate));
    if (itemIds?.length) purchaseConditions.push(inArray(purchaseItems.itemId, itemIds));
    if (categories?.length) {
      const categoryItemIds = allItems.filter((it) => categories.includes(it.category as ItemCategory)).map((it) => it.id);
      purchaseConditions.push(categoryItemIds.length ? inArray(purchaseItems.itemId, categoryItemIds) : sql`1 = 0`);
    }
    const purchaseTotals = await db.select({
      itemId: purchaseItems.itemId,
      quantity: sql<number>`SUM(${purchaseItems.quantity})`,
      amount: sql<number>`SUM(${purchaseItems.quantity} * ${purchaseItems.price})`,
    }).from(purchaseItems)
      .innerJoin(purchaseTransactions, eq(purchaseItems.purchaseId, purchaseTransactions.id))
      .where(and(...purchaseConditions))
      .groupBy(purchaseItems.itemId);
    const purchasesByItemId = new Map(purchaseTotals.map((row) => [row.itemId, row]));

    let itemProfitability = allItems.map((it) => {
      const qty = qtyByItemId.get(it.id) || 0;
      const catalogPrice = it.price || 0;
      const avgPurchasePrice = Number(it.avgPurchasePrice);
      const purchase = purchasesByItemId.get(it.id);
      const purchaseQuantity = Number(purchase?.quantity ?? 0);
      const totalPurchaseAmount = Number(purchase?.amount ?? 0);
      const totalCogsAmount = qty * avgPurchasePrice;
      const totalSellingAmount = qty * catalogPrice;
      const totalProfit = totalSellingAmount - totalCogsAmount;

      return {
        itemId: it.id,
        itemName: it.itemName,
        category: it.category,
        itemCode: it.itemCode,
        currentStock: it.currentStock,
        quantity: qty,
        purchaseQuantity,
        totalCogsAmount,
        avgPurchasePrice,
        totalPurchaseAmount,
        catalogPrice,
        totalSellingAmount,
        totalProfit,
      };
    });

    // Item and category selection apply to both purchase and approved outlet totals.
    if (itemIds?.length || categories?.length) {
      const selectedItems = new Set(itemIds || []);
      const selectedCategories = new Set(categories || []);
      itemProfitability = itemProfitability.filter((row) =>
        (!itemIds?.length || selectedItems.has(row.itemId)) &&
        (!categories?.length || selectedCategories.has(row.category as ItemCategory))
      );
    }

    const categoryPurchaseTotals = ITEM_CATEGORIES.map((category) => ({
      category,
      code: ITEM_CATEGORY_CODES[category],
      totalAmount: itemProfitability
        .filter((row) => row.category === category)
        .reduce((sum, row) => sum + row.totalPurchaseAmount, 0),
    }));

    // Summary Totals
    const totalQuantity = itemProfitability.reduce((sum, row) => sum + row.quantity, 0);
    const totalPurchaseAmount = itemProfitability.reduce((sum, row) => sum + row.totalPurchaseAmount, 0);
    const totalSellingAmount = itemProfitability.reduce((sum, row) => sum + row.totalSellingAmount, 0);
    const totalCogsAmount = itemProfitability.reduce((sum, row) => sum + row.totalCogsAmount, 0);
    const totalProfit = totalSellingAmount - totalCogsAmount;

    return {
      totalStock,
      barangMasukPcs,
      barangKeluarPcs,
      requestPending,
      recentTransactions,
      totalPurchaseAmount,
      totalCogsAmount,
      totalIncomingAmount,
      totalSellingAmount,
      totalProfit,
      totalQuantity,
      itemProfitability,
      itemList,
      categoryPurchaseTotals,
    };
  } catch (err) {
    console.error('getWarehouseDashboardStats error:', err);
    return {
      totalStock: 0,
      barangMasukPcs: 0,
      barangKeluarPcs: 0,
      requestPending: 0,
      recentTransactions: [],
      totalPurchaseAmount: 0,
      totalSellingAmount: 0,
      totalProfit: 0,
      totalQuantity: 0,
      itemProfitability: [],
      itemList: [],
      categoryPurchaseTotals: ITEM_CATEGORIES.map((category) => ({
        category,
        code: ITEM_CATEGORY_CODES[category],
        totalAmount: 0,
      })),
    };
  }
}
