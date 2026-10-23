import { eq, desc, and, gt, inArray, sql } from 'drizzle-orm';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { db, pool } from './index.ts';
import {
  users,
  outlets,
  vendors,
  items,
  itemVendors,
  purchaseTransactions,
  purchaseItems,
  requests,
  requestItems,
  stockMovements,
  stockOpnames,
  inventoryCostPeriods,
  inventoryCostSnapshots,
} from './schema.ts';

export const ITEM_CATEGORIES = ['Raw Material', 'Support Material', 'Packaging'] as const;
export type ItemCategory = typeof ITEM_CATEGORIES[number];
export const OUTLET_MASTER_SEED = [
  'Cisalak', 'Cieunteung', 'Cigeureung', 'Ciburuyan', 'Aboh', 'BRP', 'Indihiang',
  'Taman Sari', 'Kawalu', 'Bantar Malam', 'Ria Busana', 'City Garden', 'Central Kitchen (CK)',
] as const;
function jakartaDate(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function todayJakarta(): string { return jakartaDate(new Date()); }
function transactionDateKey(value: Date | string | null | undefined): string {
  if (value instanceof Date) return jakartaDate(value);
  const raw = String(value || '');
  const dateKey = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : '';
}
function isWithinDateRange(value: Date | string | null | undefined, startDate?: string, endDate?: string): boolean {
  const dateKey = transactionDateKey(value);
  return Boolean(dateKey) && (!startDate || dateKey >= startDate) && (!endDate || dateKey <= endDate);
}

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
    name: 'Finance HD',
    email: 'finance@hd.com',
    password: 'HdFinance#2026',
    role: 'FINANCE' as const,
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

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const match = /^scrypt\$([a-f\d]{32})\$([a-f\d]{128})$/i.exec(stored);
  // Legacy account creation could persist a single terminal newline from a
  // password prompt. Login fields cannot submit that terminator, so accept it
  // once for plaintext legacy values; a successful login then stores a hash
  // of the exact password entered by the user.
  if (!match) return stored === password || stored.replace(/(?:\r\n|\n|\r)$/, '') === password;
  const expected = Buffer.from(match[2], 'hex');
  const actual = scryptSync(password, Buffer.from(match[1], 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

async function generateUsername(connection: import('mysql2/promise').PoolConnection | typeof pool, preferred: string, exceptId?: number) {
  const base = normalizeUsername(preferred).replace(/[^a-z0-9._-]/g, '').slice(0, 85) || 'user';
  let candidate = base;
  let suffix = 2;
  while (true) {
    const [rows] = await connection.query('SELECT id FROM users WHERE LOWER(username) = ? AND (? IS NULL OR id <> ?) LIMIT 1', [candidate, exceptId ?? null, exceptId ?? null]);
    if (!(rows as any[]).length) return candidate;
    candidate = `${base.slice(0, 95 - String(suffix).length)}-${suffix++}`;
  }
}

let adminOutletSchemaMigration: Promise<void> | null = null;
export function ensureAdminOutletSchema() {
  if (!adminOutletSchemaMigration) {
    adminOutletSchemaMigration = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS outlets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        outlet_code VARCHAR(100) NOT NULL UNIQUE,
        outlet_name VARCHAR(255) NOT NULL UNIQUE,
        address VARCHAR(500) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      const [addressColumn] = await pool.query("SHOW COLUMNS FROM `outlets` LIKE 'address'");
      if ((addressColumn as any[]).length === 0) await pool.query('ALTER TABLE `outlets` ADD COLUMN `address` VARCHAR(500) NULL AFTER `outlet_name`');
      const seeds = OUTLET_MASTER_SEED.map((name) => [name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name]);
      await pool.query('INSERT IGNORE INTO outlets (outlet_code, outlet_name) VALUES ?', [seeds]);

      const [userOutletColumn] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'outlet_id'");
      if ((userOutletColumn as any[]).length === 0) await pool.query('ALTER TABLE `users` ADD COLUMN `outlet_id` INT NULL AFTER `role`');
      const [userActiveColumn] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'is_active'");
      if ((userActiveColumn as any[]).length === 0) await pool.query('ALTER TABLE `users` ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `outlet_id`');
      const [requestOutletColumn] = await pool.query("SHOW COLUMNS FROM `requests` LIKE 'outlet_id'");
      if ((requestOutletColumn as any[]).length === 0) await pool.query('ALTER TABLE `requests` ADD COLUMN `outlet_id` INT NULL AFTER `user_id`');

      const [userOutletIndex] = await pool.query("SHOW INDEX FROM `users` WHERE `Key_name` = 'idx_users_outlet_id'");
      if ((userOutletIndex as any[]).length === 0) await pool.query('ALTER TABLE `users` ADD INDEX `idx_users_outlet_id` (`outlet_id`)');
      const [requestOutletIndex] = await pool.query("SHOW INDEX FROM `requests` WHERE `Key_name` = 'idx_requests_outlet_id'");
      if ((requestOutletIndex as any[]).length === 0) await pool.query('ALTER TABLE `requests` ADD INDEX `idx_requests_outlet_id` (`outlet_id`)');

      const [userOutletFk] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'outlet_id' AND REFERENCED_TABLE_NAME = 'outlets'");
      if ((userOutletFk as any[]).length === 0) await pool.query('ALTER TABLE `users` ADD CONSTRAINT `fk_users_outlet` FOREIGN KEY (`outlet_id`) REFERENCES `outlets` (`id`) ON DELETE SET NULL ON UPDATE CASCADE');
      const [requestOutletFk] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'outlet_id' AND REFERENCED_TABLE_NAME = 'outlets'");
      if ((requestOutletFk as any[]).length === 0) await pool.query('ALTER TABLE `requests` ADD CONSTRAINT `fk_requests_outlet` FOREIGN KEY (`outlet_id`) REFERENCES `outlets` (`id`) ON DELETE SET NULL ON UPDATE CASCADE');

      // Preserve the outlet name that was already captured in each legacy request.
      await pool.query(`UPDATE requests r JOIN outlets o
        ON r.requester_name = o.outlet_name OR r.requester_name LIKE CONCAT(o.outlet_name, ' (%')
        SET r.outlet_id = o.id WHERE r.outlet_id IS NULL`);
    })().catch((err) => {
      adminOutletSchemaMigration = null;
      console.warn('Admin/outlet schema migration warning:', err instanceof Error ? err.message : err);
      throw err;
    });
  }
  return adminOutletSchemaMigration;
}

let adminSettingsSchemaReady: Promise<void> | null = null;
export const DEFAULT_BRANDING = { appName: 'HD Management System', subtitle: 'Inventory & Operations', mainLogo: '', sidebarLogo: '', favicon: '' };
export const DEFAULT_SYSTEM_SETTINGS = { systemName: 'HD Management System', dateFormat: 'DD MMM YYYY', timeZone: 'Asia/Jakarta', currency: 'IDR', organizationInfo: '' };
export async function ensureAdminSettingsSchema() {
  if (!adminSettingsSchemaReady) adminSettingsSchemaReady = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value LONGTEXT NOT NULL,
      updated_by INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      actor_id INT NULL,
      actor_name VARCHAR(255) NOT NULL,
      action VARCHAR(100) NOT NULL,
      target_type VARCHAR(100) NOT NULL,
      target_id VARCHAR(100) NULL,
      details LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_activity_logs_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  })().catch((error) => { adminSettingsSchemaReady = null; throw error; });
  return adminSettingsSchemaReady;
}

export async function getApplicationConfig() {
  await ensureAdminSettingsSchema();
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)', ['branding', 'system']);
  const config = Object.fromEntries((rows as any[]).map((row) => [row.setting_key, JSON.parse(row.setting_value)]));
  return { branding: { ...DEFAULT_BRANDING, ...(config.branding || {}) }, system: { ...DEFAULT_SYSTEM_SETTINGS, ...(config.system || {}) } };
}

export async function saveApplicationConfig(key: 'branding' | 'system', value: Record<string, unknown>, actorId: number) {
  await ensureAdminSettingsSchema();
  await pool.query('INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)', [key, JSON.stringify(value), actorId]);
}

export async function logAdminActivity(input: { actorId: number; actorName: string; action: string; targetType: string; targetId?: string | number | null; details?: unknown }) {
  await ensureAdminSettingsSchema();
  await pool.query('INSERT INTO activity_logs (actor_id, actor_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)', [input.actorId, input.actorName, input.action, input.targetType, input.targetId == null ? null : String(input.targetId), input.details == null ? null : JSON.stringify(input.details)]);
}

let financeAccessSchemaReady: Promise<void> | null = null;
export async function ensureFinanceAccessSchema() {
  if (!financeAccessSchemaReady) financeAccessSchemaReady = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_security (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      password_hash VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL DEFAULT NULL,
      updated_by INT NULL,
      password_version INT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`INSERT IGNORE INTO finance_security (id, password_version) VALUES (1, 0)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_access_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL,
      password_version INT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_finance_access_user (user_id),
      INDEX idx_finance_access_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_access_attempts (
      user_id INT NOT NULL PRIMARY KEY,
      window_started_at DATETIME NOT NULL,
      failed_count INT UNSIGNED NOT NULL DEFAULT 0,
      locked_until DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  })().catch((error) => { financeAccessSchemaReady = null; throw error; });
  return financeAccessSchemaReady;
}

export async function getFinanceSecurityStatus() {
  await ensureFinanceAccessSchema();
  const [rows] = await pool.query(`SELECT password_hash IS NOT NULL AS configured, updated_at AS updatedAt,
    updated_by AS updatedBy, u.name AS updatedByName, password_version AS passwordVersion
    FROM finance_security s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1`);
  const row = (rows as any[])[0] || {};
  return { configured: Boolean(row.configured), updatedAt: row.updatedAt || null, updatedBy: row.updatedBy == null ? null : Number(row.updatedBy), updatedByName: row.updatedByName || null, passwordVersion: Number(row.passwordVersion || 0) };
}

export async function getFinancePasswordHash() {
  await ensureFinanceAccessSchema();
  const [rows] = await pool.query('SELECT password_hash AS passwordHash, password_version AS passwordVersion FROM finance_security WHERE id = 1');
  return (rows as any[])[0] || { passwordHash: null, passwordVersion: 0 };
}

export async function setFinancePasswordHash(passwordHash: string, actorId: number) {
  await ensureFinanceAccessSchema();
  await pool.query(`UPDATE finance_security SET password_hash = ?, updated_at = CURRENT_TIMESTAMP,
    updated_by = ?, password_version = password_version + 1 WHERE id = 1`, [passwordHash, actorId]);
  await pool.query('DELETE FROM finance_access_sessions');
  await pool.query('DELETE FROM finance_access_attempts');
}

export async function resetFinancePassword(actorId: number) {
  await ensureFinanceAccessSchema();
  await pool.query(`UPDATE finance_security SET password_hash = NULL, updated_at = CURRENT_TIMESTAMP,
    updated_by = ?, password_version = password_version + 1 WHERE id = 1`, [actorId]);
  await pool.query('DELETE FROM finance_access_sessions');
  await pool.query('DELETE FROM finance_access_attempts');
}

const hashFinanceToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function createFinanceAccessSession(userId: number) {
  await ensureFinanceAccessSchema();
  await pool.query('DELETE FROM finance_access_sessions WHERE expires_at <= UTC_TIMESTAMP()');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashFinanceToken(token);
  const [versionRows] = await pool.query('SELECT password_version AS passwordVersion FROM finance_security WHERE id = 1 AND password_hash IS NOT NULL');
  if (!(versionRows as any[]).length) throw new Error('Password Finance belum dikonfigurasi oleh Admin.');
  await pool.query(`INSERT INTO finance_access_sessions (token_hash, user_id, password_version, expires_at)
    VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))`, [tokenHash, userId, Number((versionRows as any[])[0].passwordVersion)]);
  return { token, expiresIn: 900 };
}

export async function validateFinanceAccessSession(token: string, userId: number) {
  if (!token) return false;
  await ensureFinanceAccessSchema();
  const [rows] = await pool.query(`SELECT 1 FROM finance_access_sessions s JOIN finance_security f ON f.id = 1
    WHERE s.token_hash = ? AND s.user_id = ? AND s.password_version = f.password_version
      AND f.password_hash IS NOT NULL AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`, [hashFinanceToken(token), userId]);
  return (rows as any[]).length > 0;
}

export async function getFinanceAccessSessionSeconds(token: string, userId: number) {
  if (!token) return 0;
  await ensureFinanceAccessSchema();
  const [rows] = await pool.query(`SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), s.expires_at)) AS secondsLeft
    FROM finance_access_sessions s JOIN finance_security f ON f.id = 1
    WHERE s.token_hash = ? AND s.user_id = ? AND s.password_version = f.password_version
      AND f.password_hash IS NOT NULL AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`, [hashFinanceToken(token), userId]);
  return Number((rows as any[])[0]?.secondsLeft || 0);
}

export async function revokeFinanceAccessSession(token: string, userId?: number) {
  if (!token) return;
  await ensureFinanceAccessSchema();
  const tokenHash = hashFinanceToken(token);
  if (userId == null) await pool.query('DELETE FROM finance_access_sessions WHERE token_hash = ?', [tokenHash]);
  else await pool.query('DELETE FROM finance_access_sessions WHERE token_hash = ? AND user_id = ?', [tokenHash, userId]);
}

export async function getFinanceAccessLock(userId: number) {
  await ensureFinanceAccessSchema();
  const [rows] = await pool.query('SELECT failed_count AS failedCount, locked_until AS lockedUntil, (locked_until > UTC_TIMESTAMP()) AS locked FROM finance_access_attempts WHERE user_id = ?', [userId]);
  const row = (rows as any[])[0];
  return { failedCount: Number(row?.failedCount || 0), lockedUntil: row?.lockedUntil || null, locked: Boolean(row?.locked) };
}

export async function recordFinanceAccessFailure(userId: number) {
  await ensureFinanceAccessSchema();
  await pool.query(`INSERT INTO finance_access_attempts (user_id, window_started_at, failed_count, locked_until)
    VALUES (?, UTC_TIMESTAMP(), 1, NULL)
    ON DUPLICATE KEY UPDATE
      locked_until = IF(IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), 1, failed_count + 1) >= 5,
        DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), locked_until),
      failed_count = IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), 1, failed_count + 1),
      window_started_at = IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), UTC_TIMESTAMP(), window_started_at)`, [userId]);
}

export async function clearFinanceAccessFailures(userId: number) {
  await ensureFinanceAccessSchema();
  await pool.query('DELETE FROM finance_access_attempts WHERE user_id = ?', [userId]);
}

export async function getAdminActivityLogs(limit = 200) {
  await ensureAdminSettingsSchema();
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const [rows] = await pool.query(`SELECT id, actor_id AS actorId, actor_name AS actorName, action, target_type AS targetType, target_id AS targetId, details, created_at AS createdAt FROM activity_logs ORDER BY created_at DESC, id DESC LIMIT ${boundedLimit}`);
  return (rows as any[]).map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}

let outletRoleMigration: Promise<void> | null = null;
let adminUserSchemaReady: Promise<void> | null = null;
export function ensureAdminUserSchema() {
  if (!adminUserSchemaReady) adminUserSchemaReady = (async () => {
    await ensureAdminOutletSchema();
    const [usernameColumn] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'username'");
    if ((usernameColumn as any[]).length === 0) await pool.query("ALTER TABLE `users` ADD COLUMN `username` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER `name`");
    const [emailDuplicates] = await pool.query('SELECT COUNT(*) AS duplicateGroups FROM (SELECT LOWER(TRIM(email)) AS normalized FROM users GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1) duplicate_emails');
    if (Number((emailDuplicates as any[])[0]?.duplicateGroups || 0) > 0) throw new Error('Terdapat email duplikat tanpa membedakan huruf besar/kecil. Selesaikan akun yang bentrok sebelum migrasi unique email.');
    await pool.query('UPDATE users SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email))');
    const [usernameRows] = await pool.query('SELECT id, email, username FROM users ORDER BY id');
    const used = new Set<string>();
    for (const row of usernameRows as any[]) {
      const id = Number(row.id);
      const fromEmail = String(row.email || '').split('@')[0];
      const base = String(row.username || fromEmail || `user${id}`).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 85) || `user${id}`;
      let username = base;
      if (used.has(username)) username = `${base.slice(0, 85)}-${id}`;
      let suffix = 2;
      while (used.has(username)) username = `${base.slice(0, 85 - String(suffix).length)}-${id}-${suffix++}`;
      used.add(username);
      if (username !== row.username) await pool.query('UPDATE users SET username = ? WHERE id = ?', [username, id]);
    }
    const [emailColumn] = await pool.query("SHOW FULL COLUMNS FROM `users` LIKE 'email'");
    if (!(String((emailColumn as any[])[0]?.Collation || '').endsWith('_ci'))) await pool.query('ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL');
    await pool.query('ALTER TABLE `users` MODIFY COLUMN `username` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL');
    const [usernameIndex] = await pool.query("SHOW INDEX FROM `users` WHERE `Key_name` = 'uq_users_username'");
    if ((usernameIndex as any[]).length === 0) await pool.query('ALTER TABLE `users` ADD UNIQUE INDEX `uq_users_username` (`username`)');
    const [emailIndex] = await pool.query("SHOW INDEX FROM `users` WHERE `Non_unique` = 0 AND `Column_name` = 'email'");
    if ((emailIndex as any[]).length === 0) await pool.query('ALTER TABLE `users` ADD UNIQUE INDEX `uq_users_email` (`email`)');
  })().catch((error) => { adminUserSchemaReady = null; throw error; });
  return adminUserSchemaReady;
}

let financeSnapshotSchemaReady: Promise<void> | null = null;
async function ensureFinanceSnapshotSchema() {
  if (!financeSnapshotSchemaReady) financeSnapshotSchemaReady = (async () => {
    const [column] = await pool.query("SHOW COLUMNS FROM `request_items` LIKE 'unit_cost_snapshot'");
    if (!(column as any[]).length) {
      await pool.query('ALTER TABLE `request_items` ADD COLUMN `unit_cost_snapshot` DECIMAL(18,6) NULL AFTER `approved_at`');
    } else {
      await pool.query('ALTER TABLE `request_items` MODIFY COLUMN `unit_cost_snapshot` DECIMAL(18,6) NULL');
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS manual_finance_entries (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      account_code VARCHAR(20) NOT NULL,
      entry_type ENUM('INCOME','EXPENSE') NOT NULL,
      outlet_id INT NULL,
      transaction_date VARCHAR(10) NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      description VARCHAR(500) NOT NULL,
      is_voided TINYINT(1) NOT NULL DEFAULT 0,
      void_reason VARCHAR(500) NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_manual_finance_date (transaction_date),
      INDEX idx_manual_finance_outlet (outlet_id),
      INDEX idx_manual_finance_account (account_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS inventory_cost_periods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stock_opname_id INT NOT NULL,
      item_id INT NOT NULL,
      cutoff_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      system_stock INT NOT NULL,
      physical_stock INT NOT NULL,
      difference INT NOT NULL,
      avg_cost_before DECIMAL(18,6) NOT NULL,
      avg_cost_after DECIMAL(18,6) NOT NULL,
      inventory_value_after DECIMAL(18,6) NOT NULL,
      adjustment_value DECIMAL(18,6) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Closed',
      performed_by_user_id INT NULL,
      performed_by VARCHAR(255) NOT NULL,
      notes LONGTEXT NULL,
      UNIQUE KEY uq_inventory_cost_period_opname_item (stock_opname_id, item_id),
      INDEX idx_inventory_cost_period_item_cutoff (item_id, cutoff_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS inventory_cost_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_item_id INT NOT NULL,
      item_id INT NOT NULL,
      cutoff_period_id INT NULL,
      approved_quantity INT NOT NULL,
      unit_cost DECIMAL(18,6) NULL,
      sales_amount DECIMAL(18,6) NOT NULL,
      cogs_amount DECIMAL(18,6) NULL,
      profit_amount DECIMAL(18,6) NULL,
      source VARCHAR(32) NOT NULL,
      snapshot_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_inventory_cost_snapshot_request_item (request_item_id),
      INDEX idx_inventory_cost_snapshot_item (item_id),
      INDEX idx_inventory_cost_snapshot_cutoff (cutoff_period_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [fk] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='manual_finance_entries' AND COLUMN_NAME='outlet_id' AND REFERENCED_TABLE_NAME='outlets'");
    if (!(fk as any[]).length) await pool.query('ALTER TABLE `manual_finance_entries` ADD CONSTRAINT `fk_manual_finance_outlet` FOREIGN KEY (`outlet_id`) REFERENCES `outlets` (`id`) ON DELETE SET NULL ON UPDATE CASCADE');
  })().catch((error) => { financeSnapshotSchemaReady = null; throw error; });
  return financeSnapshotSchemaReady;
}

export const FINANCE_MANUAL_ACCOUNT_CODES = [
  { code: 'OI', label: 'Other Income', type: 'INCOME' },
  { code: 'LC', label: 'Labor Cost (Salary, Overtime, Bonus, Meal, THR, Uniform)', type: 'EXPENSE' },
  { code: 'UC', label: 'Utilities (Electricity, Water, Gas LPG, Telecom)', type: 'EXPENSE' },
  { code: 'MC', label: 'Maintenance', type: 'EXPENSE' },
  { code: 'TC', label: 'Transportation', type: 'EXPENSE' },
  { code: 'AC', label: 'Advertising', type: 'EXPENSE' },
  { code: 'LP', label: 'Rent', type: 'EXPENSE' },
  { code: 'TX', label: 'Tax', type: 'EXPENSE' },
  { code: 'DA01', label: 'Depreciation', type: 'DEPRECIATION' },
  { code: 'DA02', label: 'Amortization', type: 'DEPRECIATION' },
] as const;

export async function getManualFinanceEntries(filters: { startDate?: string; endDate?: string; startAt?: string; endAt?: string; outletIds?: number[] } = {}) {
  await ensureFinanceSnapshotSchema();
  const conditions: string[] = ['e.is_voided = 0'];
  const params: unknown[] = [];
  if (filters.startDate) { conditions.push('e.transaction_date >= ?'); params.push(filters.startDate); }
  if (filters.endDate) { conditions.push('e.transaction_date <= ?'); params.push(filters.endDate); }
  if (filters.startAt) { conditions.push('e.created_at >= ?'); params.push(new Date(filters.startAt)); }
  if (filters.endAt) { conditions.push('e.created_at < ?'); params.push(new Date(filters.endAt)); }
  if (filters.outletIds?.length) {
    conditions.push(`e.outlet_id IN (${filters.outletIds.map(() => '?').join(',')})`);
    params.push(...filters.outletIds);
  }
  const [rows] = await pool.query(`SELECT e.id, e.account_code AS accountCode, e.entry_type AS entryType,
    e.outlet_id AS outletId, o.outlet_name AS outletName, e.transaction_date AS transactionDate,
    e.amount, e.description, e.created_by AS createdBy, e.created_at AS createdAt
    FROM manual_finance_entries e LEFT JOIN outlets o ON o.id=e.outlet_id
    WHERE ${conditions.join(' AND ')} ORDER BY e.transaction_date DESC, e.id DESC`, params);
  return (rows as any[]).map((row) => ({ ...row, id: Number(row.id), outletId: row.outletId == null ? null : Number(row.outletId), amount: Number(row.amount) }));
}

export async function createManualFinanceEntry(input: { accountCode: string; outletId?: number | null; transactionDate: string; amount: number; description: string; createdBy: number }) {
  await ensureFinanceSnapshotSchema();
  const account = FINANCE_MANUAL_ACCOUNT_CODES.find((row) => row.code === input.accountCode);
  if (!account) throw new Error('Kode akun Finance tidak valid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate) || Number.isNaN(Date.parse(`${input.transactionDate}T00:00:00Z`))) throw new Error('Tanggal transaksi tidak valid');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Nominal harus bilangan bulat positif dalam Rupiah');
  const description = input.description.trim();
  if (!description || description.length > 500) throw new Error('Keterangan wajib diisi (maksimal 500 karakter)');
  const outletId = input.outletId == null ? null : Number(input.outletId);
  if (outletId != null) {
    const [outletsFound] = await pool.query('SELECT id FROM outlets WHERE id = ? AND is_active = 1 LIMIT 1', [outletId]);
    if (!(outletsFound as any[]).length) throw new Error('Outlet tidak ditemukan atau nonaktif');
  }
  const entryType = account.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const [result] = await pool.query('INSERT INTO manual_finance_entries (account_code, entry_type, outlet_id, transaction_date, amount, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [account.code, entryType, outletId, input.transactionDate, input.amount, description, input.createdBy]);
  return { id: Number((result as any).insertId), ...input, outletId, entryType };
}

export async function voidManualFinanceEntry(id: number, reason: string) {
  await ensureFinanceSnapshotSchema();
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID transaksi tidak valid');
  const cleanReason = reason.trim();
  if (!cleanReason || cleanReason.length > 500) throw new Error('Alasan koreksi wajib diisi (maksimal 500 karakter)');
  const [result] = await pool.query('UPDATE manual_finance_entries SET is_voided = 1, void_reason = ? WHERE id = ? AND is_voided = 0', [cleanReason, id]);
  if (!(result as any).affectedRows) throw new Error('Transaksi tidak ditemukan atau sudah dikoreksi');
}

export function migrateLegacyUserRoles() {
  if (!outletRoleMigration) {
    outletRoleMigration = ensureAdminOutletSchema()
      .then(() => ensureAdminUserSchema())
      .then(() => db.execute(sql`UPDATE users SET role = 'OUTLET' WHERE UPPER(role) = 'USER'`))
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
        await ensureAdminUserSchema();
        const connection = await pool.getConnection();
        const username = await generateUsername(connection, u.email.split('@')[0]);
        connection.release();
        await db.insert(users).values({
          name: u.name,
          username,
          email: u.email.toLowerCase(),
          password: hashPassword(u.password),
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
  username?: string;
  email: string;
  password?: string;
  role: string;
}> = DEFAULT_USERS_SEED.map((u, i) => ({ id: i + 1, ...u, username: u.email.split('@')[0].toLowerCase() }));

export async function authenticateUser(email: string, password?: string): Promise<any> {
  const cleanEmail = email.trim().toLowerCase();
  if (!password) {
    return null;
  }

  // 1. Check MySQL database first if connected
  try {
    await seedDefaultUsersIfEmpty();
    await ensureAdminUserSchema();
    const found = await db.select().from(users).where(sql`LOWER(${users.email}) = ${cleanEmail} OR LOWER(${users.username}) = ${cleanEmail}`);
    if (found.length > 0) {
      const u = found[0];
      if (Number(u.isActive) === 0) return null;
      if (verifyPassword(password, u.password)) {
        if (!String(u.password || '').startsWith('scrypt$')) await db.update(users).set({ password: hashPassword(password) }).where(eq(users.id, u.id));
        const profile = await getOutletRequestProfile(u.id).catch(() => null);
        return {
          ...u,
          password,
          role: u.role.toUpperCase() === 'USER' ? 'OUTLET' : u.role.toUpperCase(),
          outletId: profile?.outletId ?? null,
          outletName: profile?.outletName ?? null,
          isActive: true,
        };
      }
      // Password did NOT match
      return null;
    }
  } catch (err: any) {
    console.warn('MySQL auth query warning:', err.message);
  }

  // 2. Check in-memory users (seeded & newly registered)
  const memUser = inMemoryUsers.find((u) => u.email.toLowerCase() === cleanEmail || u.username?.toLowerCase() === cleanEmail);
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
  // Finance accounts are provisioned by an administrator in the shared users table;
  // public self-registration must not grant access to financial data.
  const targetRole = normalizedRole === 'WAREHOUSE' ? 'WAREHOUSE' : 'OUTLET';

  // Check in-memory store for duplicates
  if (inMemoryUsers.some((u) => u.email.toLowerCase() === cleanEmail)) {
    throw new Error('Email sudah terdaftar. Silakan gunakan email lain atau langsung masuk.');
  }

  let dbUser: any = null;

  // Try inserting into MySQL database
  try {
    await seedDefaultUsersIfEmpty();
    await ensureAdminUserSchema();
    const existing = await db.select().from(users).where(sql`LOWER(${users.email}) = ${cleanEmail}`);
    if (existing.length > 0) {
      throw new Error('Email sudah terdaftar di database. Silakan langsung masuk.');
    }

    const connection = await pool.getConnection();
    const username = await generateUsername(connection, cleanEmail.split('@')[0]);
    connection.release();
    const [result] = await db.insert(users).values({
      name: name.trim(),
      username,
      email: cleanEmail,
      password: hashPassword(password),
      role: targetRole,
    });
    const [newUser] = await db.select().from(users).where(eq(users.id, result.insertId));
    dbUser = { ...newUser, password };
  } catch (err: any) {
    if (err.message?.includes('sudah terdaftar')) {
      throw err;
    }
    if (err?.code === 'ER_DUP_ENTRY') {
      if (/email/i.test(String(err.message || ''))) throw new Error('Email sudah terdaftar.');
      if (/username/i.test(String(err.message || ''))) throw new Error('Username sudah digunakan.');
      throw new Error('Username atau email sudah digunakan.');
    }
    console.warn('MySQL register warning (check MySQL connection / .env):', err.message);
  }

  const createdUser = dbUser || {
    id: inMemoryUsers.length + 10,
    name: name.trim(),
    email: cleanEmail,
    username: cleanEmail.split('@')[0].toLowerCase(),
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

export async function getOutletMaster(activeOnly = true) {
  await ensureAdminOutletSchema();
  return db.select().from(outlets).where(activeOnly ? eq(outlets.isActive, true) : undefined).orderBy(outlets.outletName);
}

export async function createManagedOutlet(input: { code: string; name: string; address?: string }) {
  await ensureAdminOutletSchema();
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  const address = String(input.address || '').trim() || null;
  if (!code || !name) throw new Error('Kode dan nama outlet wajib diisi');
  try {
    const [result] = await pool.query('INSERT INTO outlets (outlet_code, outlet_name, address, is_active) VALUES (?, ?, ?, 1)', [code, name, address]);
    const [rows] = await pool.query('SELECT id, outlet_code AS code, outlet_name AS name, address, is_active AS isActive FROM outlets WHERE id = ?', [(result as any).insertId]);
    return (rows as any[])[0];
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') throw new Error('Kode atau nama outlet sudah digunakan');
    throw error;
  }
}

export async function updateManagedOutlet(id: number, input: { code: string; name: string; address?: string; isActive: boolean }) {
  await ensureAdminOutletSchema();
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID outlet tidak valid');
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  const address = String(input.address || '').trim() || null;
  if (!code || !name) throw new Error('Kode dan nama outlet wajib diisi');
  if (typeof input.isActive !== 'boolean') throw new Error('Status outlet tidak valid');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT id FROM outlets WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!(rows as any[]).length) throw new Error('Outlet tidak ditemukan');
    await connection.query('UPDATE outlets SET outlet_code = ?, outlet_name = ?, address = ?, is_active = ? WHERE id = ?', [code, name, address, input.isActive ? 1 : 0, id]);
    await connection.commit();
    const [updated] = await pool.query('SELECT id, outlet_code AS code, outlet_name AS name, address, is_active AS isActive FROM outlets WHERE id = ?', [id]);
    return (updated as any[])[0];
  } catch (error: any) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') throw new Error('Kode atau nama outlet sudah digunakan');
    throw error;
  } finally { connection.release(); }
}

export async function getAdminUsers() {
  await ensureAdminUserSchema();
  await migrateLegacyUserRoles();
  return db.select({
    id: users.id,
    name: users.name,
    username: users.username,
    email: users.email,
    role: users.role,
    outletId: users.outletId,
    outletName: outlets.outletName,
    isActive: users.isActive,
    createdAt: users.createdAt,
  }).from(users).leftJoin(outlets, eq(users.outletId, outlets.id)).orderBy(users.name);
}

export async function getOutletRequestProfile(userId: number) {
  await ensureAdminOutletSchema();
  const [rows] = await pool.query(`SELECT u.id, u.name, u.email, u.role, u.is_active AS isActive,
    u.outlet_id AS outletId, o.outlet_name AS outletName, o.is_active AS outletIsActive
    FROM users u LEFT JOIN outlets o ON o.id = u.outlet_id WHERE u.id = ? LIMIT 1`, [userId]);
  return (rows as any[])[0] || null;
}

const MANAGED_ROLES = new Set(['ADMIN', 'WAREHOUSE', 'FINANCE', 'OUTLET']);
function validateManagedRole(role: unknown): string {
  const normalized = String(role || '').toUpperCase();
  if (!MANAGED_ROLES.has(normalized)) throw new Error('Role pengguna tidak valid');
  return normalized;
}

async function validateOutletAssignment(connection: import('mysql2/promise').PoolConnection, role: string, outletId: unknown) {
  if (role !== 'OUTLET') {
    if (outletId !== undefined && outletId !== null && outletId !== '') throw new Error('Penempatan outlet hanya berlaku untuk role Outlet');
    return null;
  }
  const id = Number(outletId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Pengguna dengan role Outlet wajib memiliki penempatan outlet');
  const [rows] = await connection.query('SELECT id FROM outlets WHERE id = ? AND is_active = 1 LIMIT 1', [id]);
  if (!(rows as any[]).length) throw new Error('Outlet tidak ditemukan atau sudah nonaktif');
  return id;
}

export async function createManagedUser(input: { name: string; username: string; email: string; password: string; role: string; outletId?: number | null }) {
  await ensureAdminUserSchema();
  const name = String(input.name || '').trim();
  const username = normalizeUsername(String(input.username || ''));
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const role = validateManagedRole(input.role);
  if (!name || name.length > 255 || !/^[a-z0-9._-]{3,100}$/.test(username)) throw new Error('Nama wajib diisi (maks. 255 karakter) dan username harus 3–100 karakter berisi huruf, angka, titik, garis bawah, atau tanda hubung');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email tidak valid');
  if (password.length < 6) throw new Error('Password minimal harus 6 karakter');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const outletId = await validateOutletAssignment(connection, role, input.outletId);
    const [existingUsername] = await connection.query('SELECT id FROM users WHERE LOWER(username) = ? LIMIT 1 FOR UPDATE', [username]);
    if ((existingUsername as any[]).length) throw new Error('Username sudah digunakan.');
    const [existingEmail] = await connection.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE', [email]);
    if ((existingEmail as any[]).length) throw new Error('Email sudah terdaftar.');
    const [result] = await connection.query('INSERT INTO users (name, username, email, password, role, outlet_id, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)', [name, username, email, hashPassword(password), role, outletId]);
    await connection.commit();
    const [created] = await pool.query('SELECT id, name, username, email, role, outlet_id AS outletId, is_active AS isActive, created_at AS createdAt FROM users WHERE id = ?', [(result as any).insertId]);
    return (created as any[])[0];
  } catch (err: any) {
    await connection.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      const key = String(err.message || '');
      if (/username/i.test(key)) throw new Error('Username sudah digunakan.');
      if (/email/i.test(key)) throw new Error('Email sudah terdaftar.');
      throw new Error('Username atau email sudah digunakan.');
    }
    throw err;
  } finally {
    connection.release();
  }
}

export async function updateManagedUser(id: number, input: { name?: string; username?: string; email?: string; password?: string; role: string; isActive: boolean; outletId?: number | null }) {
  await ensureAdminUserSchema();
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID pengguna tidak valid');
  const role = validateManagedRole(input.role);
  const nameInput = String(input.name || '').trim();
  const usernameInput = normalizeUsername(String(input.username || ''));
  const emailInput = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (password && password.length < 6) throw new Error('Password minimal harus 6 karakter');
  if (typeof input.isActive !== 'boolean') throw new Error('Status akun tidak valid');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [userRows] = await connection.query('SELECT id, name, username, email, role, is_active AS isActive FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    const target = (userRows as any[])[0];
    if (!target) throw new Error('Pengguna tidak ditemukan');
    const name = nameInput || target.name;
    const username = usernameInput || target.username;
    const email = emailInput || String(target.email).toLowerCase();
    if (!name || name.length > 255 || !/^[a-z0-9._-]{3,100}$/.test(username)) throw new Error('Nama dan username yang valid wajib diisi');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email tidak valid');
    const [duplicateUsername] = await connection.query('SELECT id FROM users WHERE LOWER(username) = ? AND id <> ? LIMIT 1 FOR UPDATE', [username, id]);
    if ((duplicateUsername as any[]).length) throw new Error('Username sudah digunakan.');
    const [duplicateEmail] = await connection.query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1 FOR UPDATE', [email, id]);
    if ((duplicateEmail as any[]).length) throw new Error('Email sudah terdaftar.');
    const outletId = await validateOutletAssignment(connection, role, input.outletId);
    const isRemovingActiveAdmin = String(target.role).toUpperCase() === 'ADMIN' && Number(target.isActive) === 1 && (role !== 'ADMIN' || !input.isActive);
    if (isRemovingActiveAdmin) {
      const [adminRows] = await connection.query("SELECT id FROM users WHERE UPPER(role) = 'ADMIN' AND is_active = 1 FOR UPDATE");
      if ((adminRows as any[]).length <= 1) throw new Error('Admin aktif terakhir tidak dapat diubah role atau dinonaktifkan');
    }
    if (password) await connection.query('UPDATE users SET name = ?, username = ?, email = ?, password = ?, role = ?, is_active = ?, outlet_id = ? WHERE id = ?', [name, username, email, hashPassword(password), role, input.isActive ? 1 : 0, outletId, id]);
    else await connection.query('UPDATE users SET name = ?, username = ?, email = ?, role = ?, is_active = ?, outlet_id = ? WHERE id = ?', [name, username, email, role, input.isActive ? 1 : 0, outletId, id]);
    await connection.commit();
    const [updated] = await pool.query(`SELECT u.id, u.name, u.username, u.email, u.role, u.outlet_id AS outletId,
      o.outlet_name AS outletName, u.is_active AS isActive, u.created_at AS createdAt
      FROM users u LEFT JOIN outlets o ON o.id = u.outlet_id WHERE u.id = ?`, [id]);
    return (updated as any[])[0];
  } catch (err: any) {
    await connection.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      const key = String(err.message || '');
      if (/username/i.test(key)) throw new Error('Username sudah digunakan.');
      if (/email/i.test(key)) throw new Error('Email sudah terdaftar.');
      throw new Error('Username atau email sudah digunakan.');
    }
    throw err;
  } finally {
    connection.release();
  }
}

export async function deleteManagedUser(id: number, actorId?: number) {
  await ensureAdminUserSchema();
  await ensureAdminSettingsSchema();
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID pengguna tidak valid');
  if (actorId != null && id === actorId) throw new Error('Akun yang sedang digunakan tidak dapat dihapus');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT id, role, is_active AS isActive, name FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    const target = (rows as any[])[0];
    if (!target) throw new Error('Pengguna tidak ditemukan');
    if (actorId != null && Number(target.id) === actorId) throw new Error('Akun yang sedang digunakan tidak dapat dihapus');
    if (String(target.role).toUpperCase() === 'ADMIN' && Number(target.isActive) === 1) {
      const [admins] = await connection.query("SELECT id FROM users WHERE UPPER(role) = 'ADMIN' AND is_active = 1 FOR UPDATE");
      if ((admins as any[]).length <= 1) throw new Error('Admin aktif terakhir tidak dapat dihapus atau dinonaktifkan');
    }

    // Keep the account row whenever it is referenced or has audit history. Discover
    // foreign keys from the active schema so optional app tables are covered too.
    const [requestHistory] = await connection.query('SELECT id FROM requests WHERE user_id = ? OR requester_name LIKE CONCAT("% (", ?, ")%") LIMIT 1', [id, target.name]);
    const [auditHistory] = await connection.query('SELECT id FROM activity_logs WHERE actor_id = ? OR (target_type = ? AND target_id = ?) LIMIT 1', [id, 'user', String(id)]);
    const [references] = await connection.query(`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME = 'users'
        AND REFERENCED_COLUMN_NAME = 'id'
        AND NOT (TABLE_NAME = 'requests' AND COLUMN_NAME = 'user_id')
    `);
    let hasForeignKeyHistory = false;
    for (const reference of references as any[]) {
      const tableName = `\`${String(reference.tableName).replace(/`/g, '``')}\``;
      const columnName = `\`${String(reference.columnName).replace(/`/g, '``')}\``;
      const [linkedRows] = await connection.query(`SELECT 1 FROM ${tableName} WHERE ${columnName} = ? LIMIT 1`, [id]);
      if ((linkedRows as any[]).length) { hasForeignKeyHistory = true; break; }
    }
    if ((requestHistory as any[]).length || (auditHistory as any[]).length || hasForeignKeyHistory) {
      await connection.query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
      await connection.commit();
      return { id, mode: 'deactivated', name: target.name };
    }
    await connection.query('DELETE FROM users WHERE id = ?', [id]);
    await connection.commit();
    return { id, mode: 'deleted', name: target.name };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
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
  // Historical purchase cost snapshots are immutable. Missing values cannot
  // be safely reconstructed by cumulatively summing purchases because Stock
  // Opname can close a cost basis between receipts. Finance resolves only
  // rows with a defensible dated source and leaves the rest marked incomplete.
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

export type FinancePeriod = {
  id: string;
  label: string;
  status: 'Open' | 'Closed' | 'All';
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
};

function dateInJakarta(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function transactionTimestamp(createdAt: Date | string | null | undefined, businessDate?: string | null): number | null {
  if (createdAt) {
    const parsed = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  const dateOnly = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const parsed = new Date(`${dateOnly}T00:00:00+07:00`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getFinancePeriods(): Promise<FinancePeriod[]> {
  await ensureFinanceSnapshotSchema();
  await ensureStockOpnameTable();
  const [purchases, sales, opnameRows] = await Promise.all([
    db.select({ createdAt: purchaseTransactions.createdAt, transactionDate: purchaseTransactions.transactionDate }).from(purchaseTransactions),
    db.select({ createdAt: requests.createdAt, requestDate: requests.requestDate }).from(requestItems)
      .innerJoin(requests, eq(requestItems.requestId, requests.id))
      .where(and(eq(requestItems.status, 'Approved'), sql`${requestItems.approvedQuantity} > 0`)),
    db.select({
      id: stockOpnames.id,
      createdAt: stockOpnames.createdAt,
      examinationDate: stockOpnames.examinationDate,
      cutoffAt: sql<Date | null>`MAX(${inventoryCostPeriods.cutoffAt})`,
    }).from(stockOpnames).leftJoin(inventoryCostPeriods, eq(inventoryCostPeriods.stockOpnameId, stockOpnames.id))
      .groupBy(stockOpnames.id, stockOpnames.createdAt, stockOpnames.examinationDate).orderBy(stockOpnames.id),
  ]);
  const firstTransaction = [...purchases.map((row) => transactionTimestamp(row.createdAt, row.transactionDate)), ...sales.map((row) => transactionTimestamp(row.createdAt, row.requestDate))]
    .filter((value): value is number => value != null).sort((a, b) => a - b)[0] ?? null;
  const cutoffs = opnameRows.map((row) => ({ id: Number(row.id), at: transactionTimestamp(row.cutoffAt || row.createdAt, row.examinationDate) }))
    .filter((row): row is { id: number; at: number } => row.at != null && (firstTransaction == null || row.at > firstTransaction))
    .sort((a, b) => a.at - b.at || a.id - b.id);
  const asIso = (value: number | null) => value == null ? null : new Date(value).toISOString();
  const period = (id: string, label: string, status: FinancePeriod['status'], start: number | null, end: number | null): FinancePeriod => ({
    id, label, status, startAt: asIso(start), endAt: asIso(end),
    startDate: start == null ? null : dateInJakarta(new Date(start)),
    endDate: end == null ? null : dateInJakarta(new Date(end)),
  });
  const periods: FinancePeriod[] = [];
  let cursor = firstTransaction;
  for (const [index, cutoff] of cutoffs.entries()) {
    periods.push(period(`period-${index + 1}`, `Periode ${index + 1}`, 'Closed', cursor, cutoff.at));
    cursor = cutoff.at;
  }
  periods.push(period('running', 'Periode Berjalan', 'Open', cursor, null));
  periods.push(period('all', 'Semua Periode', 'All', firstTransaction, null));
  return periods;
}

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
  await ensureInventoryPrecisionSchema();
  // Backfill only items with active stock and no stored average. Existing averages
  // are cycle state and must survive later stockouts and subsequent purchases.
  await db.update(items).set({ avgPurchasePrice: inventoryAverage })
    .where(and(gt(items.currentStock, 0), eq(items.avgPurchasePrice, 0), sql`NOT EXISTS (
      SELECT 1 FROM inventory_cost_periods cp WHERE cp.item_id = ${items.id}
    )`));
}

let averagePricesReady: Promise<void> | undefined;
function ensureInventoryAveragePrices() {
  if (!averagePricesReady) {
    averagePricesReady = ensureInventoryPrecisionSchema().then(() => ensureFinanceSnapshotSchema()).then(() => syncAllItemAveragePrices()).then(() => backfillAvgCostAfter()).catch((err) => {
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
      else if (r.currentStock < 10) status = 'Low Stock';

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
  avgPurchasePriceBefore: number;
  avgPurchasePriceAfter: number;
  inventoryValueAfter?: number;
  cutoffPeriodId?: number;
  cutoffAt?: string;
  adjustmentValue: number;
  notes: string;
  status: 'Sesuai' | 'Selisih' | 'Belum Diperiksa';
};

async function reconstructHistoricalUnitCost(executor: InventoryExecutor, itemId: number, saleDate: string, asOfTimestamp?: string): Promise<number | null> {
  // Replay dated cost events instead of selecting the latest non-null snapshot.
  // Older receipt rows may not have avg_cost_after; their actual receipt price
  // is still a valid cost source and can rebuild weighted average since the
  // last recorded Stock Opname cut-off.
  const purchases = await executor.select({
    transactionDate: purchaseTransactions.transactionDate,
    createdAt: purchaseTransactions.createdAt,
    purchaseId: purchaseTransactions.id,
    quantity: purchaseItems.quantity,
    price: purchaseItems.price,
    avgCostAfter: purchaseItems.avgCostAfter,
  }).from(purchaseItems)
    .innerJoin(purchaseTransactions, eq(purchaseItems.purchaseId, purchaseTransactions.id))
    .where(and(eq(purchaseItems.itemId, itemId), sql`${purchaseItems.quantity} > 0`, ...(asOfTimestamp ? [] : [sql`LEFT(${purchaseTransactions.transactionDate}, 10) <= ${saleDate}`])));
  const cutoffs = await executor.select({
    cutoffAt: inventoryCostPeriods.cutoffAt,
    physicalStock: inventoryCostPeriods.physicalStock,
    avgCostAfter: inventoryCostPeriods.avgCostAfter,
  }).from(inventoryCostPeriods)
    .where(and(eq(inventoryCostPeriods.itemId, itemId), sql`DATE(${inventoryCostPeriods.cutoffAt}) < ${saleDate}`));
  const sales = await executor.select({
    saleDate: requests.requestDate,
    createdAt: requests.createdAt,
    quantity: requestItems.approvedQuantity,
  }).from(requestItems).innerJoin(requests, eq(requestItems.requestId, requests.id))
    .where(and(eq(requestItems.itemId, itemId), eq(requestItems.status, 'Approved'), sql`${requestItems.approvedQuantity} > 0`, ...(asOfTimestamp ? [] : [sql`LEFT(${requests.requestDate}, 10) <= ${saleDate}`])));

  const eventTime = (createdAt: Date | string | null | undefined, businessDate: string | null | undefined) => {
    const time = transactionTimestamp(createdAt, businessDate);
    return time == null ? '' : new Date(time).toISOString();
  };

  const events: Array<{ date: string; order: number; kind: 'purchase' | 'sale' | 'cutoff'; quantity?: number; price?: number; snapshot?: number | null; stock?: number; cost?: number }> = [
    ...purchases.map((row) => ({ date: asOfTimestamp ? eventTime(row.createdAt, row.transactionDate) : String(row.transactionDate || '').slice(0, 10), order: Number(row.purchaseId), kind: 'purchase' as const, quantity: Number(row.quantity), price: Number(row.price), snapshot: row.avgCostAfter == null ? null : Number(row.avgCostAfter) })),
    ...sales.map((row, index) => ({ date: asOfTimestamp ? eventTime(row.createdAt, row.saleDate) : String(row.saleDate || '').slice(0, 10), order: 1_000_000_000 + index, kind: 'sale' as const, quantity: Number(row.quantity) })),
    ...cutoffs.map((row, index) => ({ date: asOfTimestamp ? eventTime(row.cutoffAt, null) : jakartaDate(row.cutoffAt), order: 2_000_000_000 + index, kind: 'cutoff' as const, stock: Number(row.physicalStock), cost: Number(row.avgCostAfter) })),
  ].filter((event) => event.date && event.date <= saleDate);
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  let stock = 0;
  let average: number | null = null;
  for (const event of events) {
    if (event.kind === 'cutoff') {
      stock = event.stock || 0;
      average = event.cost != null && event.cost > 0 ? event.cost : null;
    } else if (event.kind === 'sale') {
      stock = Math.max(0, stock - (event.quantity || 0));
    } else {
      const quantity = event.quantity || 0;
      const price = event.price || 0;
      if (event.snapshot != null && Number.isFinite(event.snapshot) && event.snapshot > 0) {
        average = event.snapshot;
      } else if (price > 0) {
        average = average == null || stock <= 0
          ? price
          : ((stock * average) + (quantity * price)) / (stock + quantity);
      }
      stock += quantity;
    }
  }
  return average != null && Number.isFinite(average) && average > 0 ? average : null;
}

let inventoryPrecisionReady: Promise<void> | null = null;
async function ensureInventoryPrecisionSchema() {
  if (!inventoryPrecisionReady) inventoryPrecisionReady = (async () => {
    const [averageColumn] = await pool.query("SHOW COLUMNS FROM `items` LIKE 'avg_purchase_price'");
    if ((averageColumn as any[]).length) await pool.query('ALTER TABLE `items` MODIFY COLUMN `avg_purchase_price` DECIMAL(18,6) NOT NULL DEFAULT 0');
    const [purchaseAverageColumn] = await pool.query("SHOW COLUMNS FROM `purchase_items` LIKE 'avg_cost_after'");
    if ((purchaseAverageColumn as any[]).length) await pool.query('ALTER TABLE `purchase_items` MODIFY COLUMN `avg_cost_after` DECIMAL(18,6) NULL');
    const [movementColumn] = await pool.query("SHOW COLUMNS FROM `stock_movements` LIKE 'movement_type'");
    if ((movementColumn as any[]).length) await pool.query("ALTER TABLE `stock_movements` MODIFY COLUMN `movement_type` VARCHAR(40) NOT NULL");
    const movementAuditColumns: Array<[string, string]> = [
      ['stock_before', 'INT NULL'],
      ['stock_after', 'INT NULL'],
      ['unit_cost', 'DECIMAL(18,6) NULL'],
      ['adjustment_value', 'DECIMAL(18,6) NULL'],
      ['notes', 'LONGTEXT NULL'],
      ['created_by_user_id', 'INT NULL'],
    ];
    for (const [columnName, definition] of movementAuditColumns) {
      const [column] = await pool.query(`SHOW COLUMNS FROM \`stock_movements\` LIKE '${columnName}'`);
      if (!(column as any[]).length) await pool.query(`ALTER TABLE \`stock_movements\` ADD COLUMN \`${columnName}\` ${definition}`);
    }
  })().catch((error) => { inventoryPrecisionReady = null; throw error; });
  return inventoryPrecisionReady;
}

async function ensureStockOpnameTable() {
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS stock_opnames (
    id INT AUTO_INCREMENT PRIMARY KEY,
    examination_date VARCHAR(10) NOT NULL,
    notes LONGTEXT NULL,
    created_by VARCHAR(255) NOT NULL DEFAULT 'Warehouse',
    created_by_user_id INT NULL,
    submission_key VARCHAR(64) NULL,
    items_json LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`));
  const [userIdColumn] = await pool.query("SHOW COLUMNS FROM `stock_opnames` LIKE 'created_by_user_id'");
  if (!(userIdColumn as any[]).length) await pool.query('ALTER TABLE `stock_opnames` ADD COLUMN `created_by_user_id` INT NULL AFTER `created_by`');
  const [submissionKeyColumn] = await pool.query("SHOW COLUMNS FROM `stock_opnames` LIKE 'submission_key'");
  if (!(submissionKeyColumn as any[]).length) await pool.query('ALTER TABLE `stock_opnames` ADD COLUMN `submission_key` VARCHAR(64) NULL AFTER `created_by_user_id`');
  const [submissionKeyIndex] = await pool.query("SHOW INDEX FROM `stock_opnames` WHERE `Key_name` = 'uq_stock_opnames_submission_key'");
  if (!(submissionKeyIndex as any[]).length) await pool.query('ALTER TABLE `stock_opnames` ADD UNIQUE INDEX `uq_stock_opnames_submission_key` (`submission_key`)');
  await ensureInventoryPrecisionSchema();
}

export async function saveStockOpname(data: {
  examinationDate: string;
  notes?: string;
  createdBy?: string;
  createdByUserId?: number | null;
  submissionKey?: string | null;
  physicalStocks: Array<{ itemId: number; physicalStock: number | null; notes?: string }>;
}) {
  await ensureInventoryAveragePrices();
  await ensureStockOpnameTable();
  await ensureFinanceSnapshotSchema();
  const physicalById = new Map(data.physicalStocks.map((entry) => [entry.itemId, entry.physicalStock]));
  if (physicalById.size !== data.physicalStocks.length) throw new Error('Daftar barang Stock Opname memiliki item duplikat');
  const createdBy = data.createdBy?.trim().slice(0, 100) || 'Warehouse';
  const notesById = new Map(data.physicalStocks.map((entry) => [entry.itemId, entry.notes?.trim() || '']));

  return db.transaction(async (tx) => {
    // Lock inventory rows in stable order so a receipt, approval, or concurrent
    // opname cannot overwrite stock based on a stale snapshot.
    const lockedItems = await tx.select({
      id: items.id,
      itemName: items.itemName,
      currentStock: items.currentStock,
      avgPurchasePrice: items.avgPurchasePrice,
    }).from(items).orderBy(items.id).for('update');
    if (data.submissionKey) {
      const [existingRecord] = await tx.select().from(stockOpnames)
        .where(eq(stockOpnames.submissionKey, data.submissionKey)).limit(1);
      if (existingRecord) {
        return {
          id: existingRecord.id,
          examinationDate: existingRecord.examinationDate,
          notes: existingRecord.notes || '',
          createdBy: existingRecord.createdBy,
          createdByUserId: existingRecord.createdByUserId || null,
          items: JSON.parse(existingRecord.itemsJson) as StockOpnameLine[],
          createdAt: existingRecord.createdAt?.toISOString?.() || new Date().toISOString(),
        };
      }
    }
    const itemById = new Map(lockedItems.map((item) => [item.id, item]));
    for (const itemId of physicalById.keys()) {
      if (!itemById.has(itemId)) throw new Error(`Barang ID ${itemId} tidak ditemukan`);
    }

    const opnameItems: StockOpnameLine[] = lockedItems.map((item) => {
      const physicalStock = physicalById.get(item.id) ?? null;
      const systemStock = Number(item.currentStock);
      const avgPurchasePriceBefore = Number(item.avgPurchasePrice || 0);
      const difference = physicalStock === null ? null : physicalStock - systemStock;
      const avgPurchasePriceAfter = physicalStock === 0 ? 0 : avgPurchasePriceBefore;
      const adjustmentValue = difference === null ? 0 : Number((difference * avgPurchasePriceBefore).toFixed(6));
      return {
        itemId: item.id,
        itemName: item.itemName,
        systemStock,
        physicalStock,
        difference,
        avgPurchasePriceBefore,
        avgPurchasePriceAfter,
        inventoryValueAfter: physicalStock === null ? 0 : Number((physicalStock * avgPurchasePriceAfter).toFixed(6)),
        adjustmentValue,
        notes: notesById.get(item.id) || '',
        status: physicalStock === null ? 'Belum Diperiksa' : difference === 0 ? 'Sesuai' : 'Selisih',
      };
    });

    const [insertResult] = await tx.insert(stockOpnames).values({
      examinationDate: data.examinationDate,
      notes: data.notes?.trim() || null,
      createdBy,
      createdByUserId: data.createdByUserId || null,
      submissionKey: data.submissionKey || null,
      itemsJson: JSON.stringify(opnameItems),
    });
    const id = Number(insertResult.insertId);
    const referenceId = `SO-${id}`;

    for (const line of opnameItems) {
      if (line.physicalStock === null || line.difference === null) continue;
      const [periodInsert] = await tx.insert(inventoryCostPeriods).values({
        stockOpnameId: id,
        itemId: line.itemId,
        systemStock: line.systemStock,
        physicalStock: line.physicalStock,
        difference: line.difference,
        avgCostBefore: line.avgPurchasePriceBefore,
        avgCostAfter: line.avgPurchasePriceAfter,
        inventoryValueAfter: line.inventoryValueAfter || 0,
        adjustmentValue: line.adjustmentValue,
        performedByUserId: data.createdByUserId || null,
        performedBy: createdBy,
        notes: line.notes || null,
      });
      line.cutoffPeriodId = Number(periodInsert.insertId);
      const [periodRow] = await tx.select({ cutoffAt: inventoryCostPeriods.cutoffAt }).from(inventoryCostPeriods).where(eq(inventoryCostPeriods.id, line.cutoffPeriodId));
      line.cutoffAt = periodRow?.cutoffAt instanceof Date ? periodRow.cutoffAt.toISOString() : String(periodRow?.cutoffAt || '');

      const historicalSales = await tx.select({
        requestItemId: requestItems.id,
        approvedQuantity: requestItems.approvedQuantity,
        unitCostSnapshot: requestItems.unitCostSnapshot,
        price: requestItems.price,
        requestDate: requests.requestDate,
      }).from(requestItems).innerJoin(requests, eq(requestItems.requestId, requests.id))
        .where(and(eq(requestItems.itemId, line.itemId), eq(requestItems.status, 'Approved'), sql`${requestItems.approvedQuantity} > 0`, sql`LEFT(${requests.requestDate}, 10) <= ${data.examinationDate}`));

      for (const sale of historicalSales) {
        const [existingSnapshot] = await tx.select({ id: inventoryCostSnapshots.id, cutoffPeriodId: inventoryCostSnapshots.cutoffPeriodId, unitCost: inventoryCostSnapshots.unitCost })
          .from(inventoryCostSnapshots).where(eq(inventoryCostSnapshots.requestItemId, sale.requestItemId)).limit(1);
        if (existingSnapshot) {
          if (existingSnapshot.unitCost == null || Number(existingSnapshot.unitCost) <= 0) {
            const reconstructedCost = await reconstructHistoricalUnitCost(tx, line.itemId, String(sale.requestDate || '').slice(0, 10));
            if (reconstructedCost != null) {
              const reconstructedCogs = Number((Number(sale.approvedQuantity) * reconstructedCost).toFixed(6));
              const reconstructedSales = Number(sale.approvedQuantity) * Number(sale.price);
              await tx.update(inventoryCostSnapshots).set({
                cutoffPeriodId: existingSnapshot.cutoffPeriodId || line.cutoffPeriodId,
                unitCost: reconstructedCost,
                cogsAmount: reconstructedCogs,
                profitAmount: Number((reconstructedSales - reconstructedCogs).toFixed(6)),
                source: 'RECONSTRUCTED',
              }).where(eq(inventoryCostSnapshots.id, existingSnapshot.id));
              if (sale.unitCostSnapshot == null) await tx.update(requestItems).set({ unitCostSnapshot: reconstructedCost }).where(eq(requestItems.id, sale.requestItemId));
            } else if (!existingSnapshot.cutoffPeriodId) {
              await tx.update(inventoryCostSnapshots).set({ cutoffPeriodId: line.cutoffPeriodId }).where(eq(inventoryCostSnapshots.id, existingSnapshot.id));
            }
          } else if (!existingSnapshot.cutoffPeriodId) {
            await tx.update(inventoryCostSnapshots).set({ cutoffPeriodId: line.cutoffPeriodId }).where(eq(inventoryCostSnapshots.id, existingSnapshot.id));
          }
          continue;
        }
        const unitCost = sale.unitCostSnapshot == null || Number(sale.unitCostSnapshot) <= 0
          ? await reconstructHistoricalUnitCost(tx, line.itemId, String(sale.requestDate || '').slice(0, 10))
          : Number(sale.unitCostSnapshot);
        const salesAmount = Number(sale.approvedQuantity) * Number(sale.price);
        const cogsAmount = unitCost == null ? null : Number((Number(sale.approvedQuantity) * unitCost).toFixed(6));
        await tx.insert(inventoryCostSnapshots).values({
          requestItemId: sale.requestItemId,
          itemId: line.itemId,
          cutoffPeriodId: line.cutoffPeriodId,
          approvedQuantity: Number(sale.approvedQuantity),
          unitCost,
          salesAmount,
          cogsAmount,
          profitAmount: cogsAmount == null ? null : Number((salesAmount - cogsAmount).toFixed(6)),
          source: unitCost == null ? 'MISSING' : sale.unitCostSnapshot == null ? 'RECONSTRUCTED' : 'SALE_APPROVAL',
        });
        if ((sale.unitCostSnapshot == null || Number(sale.unitCostSnapshot) <= 0) && unitCost != null) {
          await tx.update(requestItems).set({ unitCostSnapshot: unitCost }).where(eq(requestItems.id, sale.requestItemId));
        }
      }

      if (line.difference !== 0 || line.avgPurchasePriceAfter !== line.avgPurchasePriceBefore) {
        await tx.update(items).set({
          currentStock: line.physicalStock,
          avgPurchasePrice: line.avgPurchasePriceAfter,
        }).where(eq(items.id, line.itemId));
      }
      if (line.difference !== 0) {
        await tx.insert(stockMovements).values({
          itemId: line.itemId,
          movementType: 'STOCK_OPNAME_ADJUSTMENT',
          quantity: line.difference,
          stockBefore: line.systemStock,
          stockAfter: line.physicalStock,
          unitCost: line.avgPurchasePriceBefore,
          adjustmentValue: line.adjustmentValue,
          notes: line.notes || null,
          createdByUserId: data.createdByUserId || null,
          referenceId,
          createdBy,
        });
      }
    }

    await tx.update(stockOpnames).set({ itemsJson: JSON.stringify(opnameItems) }).where(eq(stockOpnames.id, id));
    return {
      id,
      examinationDate: data.examinationDate,
      notes: data.notes?.trim() || '',
      createdBy,
      createdByUserId: data.createdByUserId || null,
      items: opnameItems,
      createdAt: new Date().toISOString(),
    };
  }, { isolationLevel: 'read committed' });
}

export async function getStockOpnameHistory() {
  await ensureStockOpnameTable();
  const rows = await db.select().from(stockOpnames).orderBy(desc(stockOpnames.examinationDate), desc(stockOpnames.id));
  return rows.map((row) => ({
    id: row.id,
    examinationDate: row.examinationDate,
    notes: row.notes || '',
    createdBy: row.createdBy,
    createdByUserId: row.createdByUserId || null,
    items: JSON.parse(row.itemsJson) as StockOpnameLine[],
    createdAt: row.createdAt,
  }));
}

export async function createItem(
  name: string,
  price: number,
  category: ItemCategory,
  vendorId?: number,
  vendorIds?: number[]
) {
  try {
    await ensureItemCategorySchema();
    categoryPrefix(category);
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
          currentStock: 0,
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
    vendorId?: number | null;
    vendorIds?: number[];
  }
) {
  try {
    await ensureItemCategorySchema();
    const patch: any = {};
    if (data.itemName !== undefined && data.itemName !== null) patch.itemName = data.itemName.trim();
    if (data.price !== undefined && data.price !== null) patch.price = Number(data.price);

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
}) {
  try {
    await ensureItemCategorySchema();
    const vendor = await getOrCreateVendor(data.vendorCode, data.vendorName);
    const existing = await db
      .select()
      .from(items)
      .where(eq(items.itemName, data.itemName.trim()));

    if (existing.length > 0) {
      const existingItem = existing[0];
      // Update data master katalog tanpa merusak harga rata-rata pembelian (weighted average)
      const category = data.category || existingItem.category;
      categoryPrefix(category);
      const categoryChanged = category !== existingItem.category;
      const patch: any = {
          price: data.price, // Harga katalog murni
          vendorId: vendor.id,
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
          currentStock: 0,
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
    await ensureInventoryPrecisionSchema();
    await ensureInventoryAveragePrices();
    await ensureFinanceSnapshotSchema();
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
          const oldStock = Number(existingItem.currentStock);
          const oldAverage = Number(existingItem.avgPurchasePrice || 0).toFixed(6);
          const newStock = oldStock + it.quantity;
          await tx.update(items).set({
            vendorId: vendor.id,
            currentStock: newStock,
            avgPurchasePrice: oldStock > 0
              ? sql`ROUND(((${oldStock} * ${oldAverage}) + (${it.quantity} * ${it.price})) / ${newStock}, 6)`
              : Number(Number(it.price).toFixed(6)),
          }).where(eq(items.id, existingItem.id));
          actualItemId = existingItem.id;
          const [updatedItem] = await tx.select({ avgPurchasePrice: items.avgPurchasePrice }).from(items).where(eq(items.id, actualItemId));
          (it as typeof it & { avgCostAfter?: number }).avgCostAfter = Number(updatedItem.avgPurchasePrice);
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
          (it as typeof it & { avgCostAfter?: number }).avgCostAfter = Number(Number(it.price).toFixed(6));
        }

        // Record manual purchase price; fill the history snapshot after all lines are saved.
        // Subtotal = Quantity * Harga Beli Input
        await tx.insert(purchaseItems).values({
          purchaseId: purchase.id,
          itemId: actualItemId,
          quantity: it.quantity,
          price: it.price,
          subtotal: it.quantity * it.price,
          avgCostAfter: (it as typeof it & { avgCostAfter?: number }).avgCostAfter ?? Number(Number(it.price).toFixed(6)),
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
        transactionDate: data.transactionDate || todayJakarta(),
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
  outletId: number;
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
    await ensureAdminOutletSchema();
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
      outletId: data.outletId,
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
    await ensureAdminOutletSchema();
    let reqs = await db.select().from(requests).orderBy(desc(requests.requestDate), desc(requests.id));

    if (filters?.userId) {
      reqs = reqs.filter((r) => r.userId === filters.userId);
    }
    if (filters?.startDate || filters?.endDate) {
      reqs = reqs.filter((r) => isWithinDateRange(r.requestDate, filters?.startDate, filters?.endDate));
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

    const outletRows = await db.select({ id: outlets.id, name: outlets.outletName }).from(outlets);
    return reqs.map((r) => {
      const matchingItems = allItems.filter((it) => it.requestId === r.id);
      return {
        ...r,
        outletName: outletRows.find((outlet) => outlet.id === r.outletId)?.name || null,
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
    await ensureAdminOutletSchema();
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
      outletName: request.outletId ? (await db.select({ name: outlets.outletName }).from(outlets).where(eq(outlets.id, request.outletId)))[0]?.name || null : null,
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
    await ensureInventoryAveragePrices();
    await ensureFinanceSnapshotSchema();
    return await db.transaction(async (tx) => {
    const [lockedRequest] = await tx.select({ id: requests.id, status: requests.status })
      .from(requests).where(eq(requests.id, requestId)).for('update');
    if (!lockedRequest) throw new Error('Permintaan tidak ditemukan');
    if (lockedRequest.status !== 'Pending') throw new Error('Permintaan sudah diproses dan tidak dapat diubah kembali.');

    // Lock the request line so concurrent approvals cannot decrement stock twice.
    const rItemRows = await tx
      .select({
        id: requestItems.id,
        requestId: requestItems.requestId,
        itemId: requestItems.itemId,
        requestedQuantity: requestItems.requestedQuantity,
        approvedQuantity: requestItems.approvedQuantity,
        status: requestItems.status,
        price: requestItems.price,
        currentStock: items.currentStock,
        avgPurchasePrice: items.avgPurchasePrice,
        itemName: items.itemName,
        requestCode: requests.requestCode,
      })
      .from(requestItems)
      .innerJoin(requests, eq(requestItems.requestId, requests.id))
      .innerJoin(items, eq(requestItems.itemId, items.id))
      .where(eq(requestItems.id, requestItemId))
      .for('update');

    if (rItemRows.length === 0) {
      throw new Error('Item permintaan tidak ditemukan');
    }

    const rItem = rItemRows[0];
    if (rItem.requestId !== requestId) throw new Error('Item permintaan tidak ditemukan');

    if (rItem.status !== 'Pending') throw new Error('Barang permintaan sudah diproses.');

    if (decision === 'Approve') {

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

      const today = todayJakarta();

      // Capture weighted-average inventory cost at the point the outlet sale is
      // realized. A missing purchase history remains NULL and is reported as
      // missing cost data by Finance; a valid zero-cost purchase stays zero.
      const [costHistory] = await tx.select({ id: purchaseItems.id }).from(purchaseItems)
        .where(and(eq(purchaseItems.itemId, rItem.itemId), sql`${purchaseItems.quantity} > 0`, sql`${purchaseItems.price} > 0`))
        .limit(1);
      const unitCostSnapshot = costHistory && Number(rItem.avgPurchasePrice ?? 0) > 0 ? Number(rItem.avgPurchasePrice) : null;

      // Reduce stock sesuai kuantitas yang disetujui
      await tx
        .update(items)
        .set({
          currentStock: sql`${items.currentStock} - ${qtyToApprove}`,
        })
        .where(eq(items.id, rItem.itemId));

      // Update request item
      await tx
        .update(requestItems)
        .set({
          approvedQuantity: qtyToApprove,
          status: 'Approved',
          approvedBy: staffName,
          approvedAt: today,
          unitCostSnapshot,
        })
        .where(eq(requestItems.id, requestItemId));

      const [activeCostPeriod] = await tx.select({ id: inventoryCostPeriods.id }).from(inventoryCostPeriods)
        .where(eq(inventoryCostPeriods.itemId, rItem.itemId))
        .orderBy(desc(inventoryCostPeriods.cutoffAt), desc(inventoryCostPeriods.id)).limit(1);
      const salesAmount = qtyToApprove * Number(rItem.price || 0);
      const cogsAmount = unitCostSnapshot == null ? null : Number((qtyToApprove * unitCostSnapshot).toFixed(6));
      await tx.insert(inventoryCostSnapshots).values({
        requestItemId,
        itemId: rItem.itemId,
        cutoffPeriodId: activeCostPeriod?.id || null,
        approvedQuantity: qtyToApprove,
        unitCost: unitCostSnapshot,
        salesAmount,
        cogsAmount,
        profitAmount: cogsAmount == null ? null : Number((salesAmount - cogsAmount).toFixed(6)),
        source: unitCostSnapshot == null ? 'MISSING' : 'SALE_APPROVAL',
      });

      // Record stock movement (Barang Keluar)
      await tx.insert(stockMovements).values({
        itemId: rItem.itemId,
        movementType: 'OUT',
        quantity: qtyToApprove,
        referenceId: rItem.requestCode,
        createdBy: staffName,
      });
    } else {
      // Rejection applies only to an unprocessed request line.
      const today = todayJakarta();
      await tx
        .update(requestItems)
        .set({
          approvedQuantity: 0,
          status: 'Rejected',
          approvedBy: staffName,
          approvedAt: today,
          unitCostSnapshot: null,
        })
        .where(eq(requestItems.id, requestItemId));
    }

    // Recalculate overall request status
    const allItemsInReq = await tx
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

    // A request is processed once. Unresolved lines are explicitly closed as
    // rejected so they cannot remain pending after a partial decision.
    const processedAt = todayJakarta();
    await tx.update(requestItems).set({
      status: 'Rejected',
      approvedQuantity: 0,
      approvedBy: staffName,
      approvedAt: processedAt,
    }).where(and(eq(requestItems.requestId, requestId), eq(requestItems.status, 'Pending')));

    await tx.update(requests).set({ status: newStatus }).where(eq(requests.id, requestId));

    return { success: true, newStatus };
    });
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
    return await db.transaction(async (tx) => {
    const [lockedRequest] = await tx.select({ id: requests.id, status: requests.status })
      .from(requests).where(eq(requests.id, requestId)).for('update');
    if (!lockedRequest) throw new Error('Permintaan tidak ditemukan');
    if (lockedRequest.status !== 'Pending') throw new Error('Permintaan sudah diproses dan tidak dapat diubah kembali.');

    const rItems = await tx
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
      .where(eq(requestItems.requestId, requestId))
      .for('update');

    if (rItems.length === 0) {
      throw new Error('Permintaan tidak memiliki item barang');
    }

    const pendingItems = rItems.filter((i) => i.status === 'Pending');
    if (pendingItems.length === 0) throw new Error('Permintaan sudah diproses dan tidak dapat diubah kembali.');

    // 1. Validate the combined quantity for repeated item lines before processing.
    const plannedQuantityByItem = new Map<number, number>();
    for (const it of pendingItems) {
      const desiredQty =
        customQuantities && customQuantities[it.id] !== undefined
          ? Math.min(Number(customQuantities[it.id]), it.requestedQuantity)
          : it.requestedQuantity;
      if (desiredQty > 0) plannedQuantityByItem.set(it.itemId, (plannedQuantityByItem.get(it.itemId) || 0) + desiredQty);
    }
    for (const [itemId, desiredQty] of plannedQuantityByItem) {
      const item = pendingItems.find((entry) => entry.itemId === itemId)!;
      if (item.currentStock < desiredQty) {
        throw new Error(`Stok tidak mencukupi untuk "${item.itemName}"! Tersedia: ${item.currentStock} pcs, Ingin disetujui: ${desiredQty} pcs`);
      }
    }

    const today = todayJakarta();

    // 2. Eksekusi persetujuan setiap item
    for (const it of pendingItems) {
      const desiredQty =
        customQuantities && customQuantities[it.id] !== undefined
          ? Math.min(Number(customQuantities[it.id]), it.requestedQuantity)
          : it.requestedQuantity;

      const qtyToApprove = Math.max(0, desiredQty);

      if (qtyToApprove === 0) {
        await tx
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
        await tx
          .update(items)
          .set({
            currentStock: sql`${items.currentStock} - ${qtyToApprove}`,
          })
          .where(eq(items.id, it.itemId));

        // Update request item
        await tx
          .update(requestItems)
          .set({
            approvedQuantity: qtyToApprove,
            status: 'Approved',
            approvedBy: staffName,
            approvedAt: today,
          })
          .where(eq(requestItems.id, it.id));

        // Catat mutasi barang keluar
        await tx.insert(stockMovements).values({
          itemId: it.itemId,
          movementType: 'OUT',
          quantity: qtyToApprove,
          referenceId: it.requestCode,
          createdBy: staffName,
        });
      }
    }

    // 3. Hitung ulang status keseluruhan permintaan
    const allItemsInReq = await tx
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

    await tx.update(requests).set({ status: newStatus }).where(eq(requests.id, requestId));

    return { success: true, newStatus };
    });
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

    if (startDate || endDate) txs = txs.filter((t) => isWithinDateRange(t.transactionDate, startDate, endDate));

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

    if (startDate || endDate) reqs = reqs.filter((r) => isWithinDateRange(r.requestDate, startDate, endDate));

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

export async function getWarehouseDashboardStats(startDate?: string, endDate?: string, itemIds?: number[], outletIds?: number[], categories?: ItemCategory[], outletNames?: string[], financePeriod?: FinancePeriod) {
  try {
    await ensureFinanceSnapshotSchema();
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
        const dateStr = m.createdAt ? jakartaDate(m.createdAt) : '';
        return dateStr >= startDate;
      });
    }
    if (endDate) {
      inMovements = inMovements.filter((m) => {
        const dateStr = m.createdAt ? jakartaDate(m.createdAt) : '';
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
    if (startDate || endDate) pTxs = pTxs.filter((t) => isWithinDateRange(t.transactionDate, startDate, endDate));
    const totalIncomingAmount = pTxs.reduce((sum, t) => sum + Number(t.totalAmount || 0), 0);

    // 5. Recent transactions list for dashboard
    const recentTransactions = inMovements.slice(0, 8).map((m) => ({
      id: m.id,
      itemName: m.itemName || 'Barang',
      quantity: m.quantity,
      movementType: m.movementType as 'IN' | 'OUT' | 'STOCK_OPNAME_ADJUSTMENT',
      typeLabel: m.movementType === 'IN' ? 'Barang Masuk' : m.movementType === 'OUT' ? 'Barang Keluar' : 'Penyesuaian Stock Opname',
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
    if (startDate || endDate) {
      allReqs = allReqs.filter((r) => isWithinDateRange(r.requestDate, startDate, endDate));
    }
    if (financePeriod?.status !== 'All' && financePeriod) {
      const periodStart = financePeriod.startAt ? new Date(financePeriod.startAt).getTime() : null;
      const periodEnd = financePeriod.endAt ? new Date(financePeriod.endAt).getTime() : null;
      allReqs = allReqs.filter((request) => {
        const created = transactionTimestamp(request.createdAt, request.requestDate);
        return created != null && (periodStart == null || created >= periodStart) && (periodEnd == null || created < periodEnd);
      });
    }
    if (outletIds?.length) {
      const selectedOutlets = new Set(outletIds);
      allReqs = allReqs.filter((r) => r.outletId != null && selectedOutlets.has(Number(r.outletId)));
    } else if (outletNames?.length) {
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
        approvedAt: requestItems.approvedAt,
        status: requestItems.status,
        unitCostSnapshot: requestItems.unitCostSnapshot,
      })
      .from(requestItems)
      .where(and(eq(requestItems.status, 'Approved'), sql`${requestItems.approvedQuantity} > 0`));

    // Filter by valid requests in date range with approved quantity > 0
    const filteredReqItems = approvedReqItems.filter(
      (ri) => validReqIds.has(ri.requestId) && ri.approvedQuantity > 0
    );

    const snapshotRows = filteredReqItems.length ? await db.select({
      requestItemId: inventoryCostSnapshots.requestItemId,
      unitCost: inventoryCostSnapshots.unitCost,
    }).from(inventoryCostSnapshots).where(inArray(inventoryCostSnapshots.requestItemId, filteredReqItems.map((row) => row.id))) : [];
    const costSnapshotByRequestItem = new Map(snapshotRows.map((row) => [row.requestItemId, row.unitCost == null ? null : Number(row.unitCost)]));
    const requestDateById = new Map(allReqs.map((row) => [row.id, String(row.requestDate || '').slice(0, 10)]));

    // Aggregate only approved quantities and their persisted transaction prices.
    const qtyByItemId = new Map<number, number>();
    const salesAmountByItemId = new Map<number, number>();
    const cogsByItemId = new Map<number, number>();
    const missingCostByItemId = new Map<number, number>();
    const resolvedCostCache = new Map<string, number | null>();
    for (const ri of filteredReqItems) {
      const current = qtyByItemId.get(ri.itemId) || 0;
      qtyByItemId.set(ri.itemId, current + ri.approvedQuantity);
      const salesAmount = salesAmountByItemId.get(ri.itemId) || 0;
      salesAmountByItemId.set(ri.itemId, salesAmount + ri.approvedQuantity * Number(ri.price || 0));
      const saleDate = requestDateById.get(ri.requestId) || '';
      const snapshotCost = costSnapshotByRequestItem.get(ri.id);
      let unitCost = snapshotCost != null && snapshotCost > 0
        ? snapshotCost
        : ri.unitCostSnapshot == null || Number(ri.unitCostSnapshot) <= 0 ? null : Number(ri.unitCostSnapshot);
      const cacheKey = `${ri.itemId}:${saleDate}`;
      if (unitCost == null && saleDate) {
        if (resolvedCostCache.has(cacheKey)) unitCost = resolvedCostCache.get(cacheKey) ?? null;
        else {
          unitCost = await reconstructHistoricalUnitCost(db, ri.itemId, saleDate);
          resolvedCostCache.set(cacheKey, unitCost);
        }
      }
      if (unitCost == null || !Number.isFinite(unitCost)) {
        missingCostByItemId.set(ri.itemId, (missingCostByItemId.get(ri.itemId) || 0) + ri.approvedQuantity);
      } else {
        cogsByItemId.set(ri.itemId, (cogsByItemId.get(ri.itemId) || 0) + ri.approvedQuantity * unitCost);
      }
    }

    // Aggregate receiving lines independently from outlet quantities, joined by Inventory item ID.
    const purchaseConditions = [sql`${purchaseItems.quantity} > 0`, sql`${purchaseItems.price} >= 0`];
    if (startDate) purchaseConditions.push(sql`LEFT(${purchaseTransactions.transactionDate}, 10) >= ${startDate}`);
    if (endDate) purchaseConditions.push(sql`LEFT(${purchaseTransactions.transactionDate}, 10) <= ${endDate}`);
    if (financePeriod?.status !== 'All' && financePeriod?.startAt) purchaseConditions.push(sql`${purchaseTransactions.createdAt} >= ${new Date(financePeriod.startAt)}`);
    if (financePeriod?.status !== 'All' && financePeriod?.endAt) purchaseConditions.push(sql`${purchaseTransactions.createdAt} < ${new Date(financePeriod.endAt)}`);
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

    const periodCostDate = financePeriod?.endAt
      ? new Date(new Date(financePeriod.endAt).getTime() - 1).toISOString()
      : todayJakarta();
    const financeAverageByItem = new Map<number, number | null>();
    for (const item of allItems) {
      const storedAverage = item.avgPurchasePrice == null ? 0 : Number(item.avgPurchasePrice);
      if (financePeriod?.status === 'All') {
        const purchase = purchasesByItemId.get(item.id);
        const quantity = Number(purchase?.quantity || 0);
        const amount = Number(purchase?.amount || 0);
        financeAverageByItem.set(item.id, quantity > 0 && amount > 0 ? amount / quantity : storedAverage > 0 ? storedAverage : null);
      } else if (financePeriod?.status === 'Closed' && financePeriod.endAt) {
        financeAverageByItem.set(item.id, await reconstructHistoricalUnitCost(db, item.id, periodCostDate.slice(0, 10), periodCostDate));
      } else {
        financeAverageByItem.set(item.id, storedAverage > 0 && Number.isFinite(storedAverage)
          ? storedAverage
          : await reconstructHistoricalUnitCost(db, item.id, periodCostDate.slice(0, 10), periodCostDate.includes('T') ? periodCostDate : undefined));
      }
    }

    let itemProfitability = allItems.map((it) => {
      const qty = qtyByItemId.get(it.id) || 0;
      const catalogPrice = it.price || 0;
      const purchase = purchasesByItemId.get(it.id);
      const purchaseQuantity = Number(purchase?.quantity ?? 0);
      const totalPurchaseAmount = Number(purchase?.amount ?? 0);
      // Finance uses the immutable sale cost snapshot, or a date-valid cost-history
      // reconstruction for legacy sales. Current inventory average is display-only.
      const inventoryAverage = financeAverageByItem.get(it.id) ?? null;
      const avgPurchasePrice = inventoryAverage != null && Number.isFinite(inventoryAverage) ? inventoryAverage : 0;
      const totalSellingAmount = salesAmountByItemId.get(it.id) || 0;
      const missingCostQuantity = missingCostByItemId.get(it.id) || 0;
      const totalCogsAmount = cogsByItemId.get(it.id) || 0;
      const totalProfit = missingCostQuantity > 0 ? null : totalSellingAmount - totalCogsAmount;

      return {
        itemId: it.id,
        itemName: it.itemName,
        category: it.category,
        itemCode: it.itemCode,
        currentStock: it.currentStock,
        quantity: qty,
        purchaseQuantity,
        totalCogsAmount,
        missingCostQuantity,
        avgPurchasePrice,
        totalPurchaseAmount,
        catalogPrice,
        totalSellingAmount,
        averageSellingPrice: qty ? totalSellingAmount / qty : 0,
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
    const missingCostQuantity = itemProfitability.reduce((sum, row) => sum + Number((row as any).missingCostQuantity || 0), 0);
    const hasMissingCostData = missingCostQuantity > 0;
    const totalProfit = hasMissingCostData ? null : totalSellingAmount - totalCogsAmount;
    const manualEntries = await getManualFinanceEntries({
      startDate: financePeriod ? undefined : startDate,
      endDate: financePeriod ? undefined : endDate,
      startAt: financePeriod?.status !== 'All' ? financePeriod?.startAt || undefined : undefined,
      endAt: financePeriod?.status !== 'All' ? financePeriod?.endAt || undefined : undefined,
      outletIds,
    });
    const manualByCode = new Map<string, number>();
    for (const entry of manualEntries) manualByCode.set(entry.accountCode, (manualByCode.get(entry.accountCode) || 0) + entry.amount);
    const otherIncome = manualByCode.get('OI') || 0;
    const shrinkageAmount = null; // No verified/approved Stock Opname state exists in the current schema.
    const contributionMargin = shrinkageAmount == null ? null : totalSellingAmount + otherIncome - shrinkageAmount;
    const directCosts = ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX'].reduce((sum, code) => sum + (manualByCode.get(code) || 0), 0);
    const depreciationAmortization = (manualByCode.get('DA01') || 0) + (manualByCode.get('DA02') || 0);
    const contributionIncome = hasMissingCostData || contributionMargin == null ? null : contributionMargin - totalCogsAmount;
    const ebitda = contributionIncome == null ? null : contributionIncome - directCosts;
    const ebit = ebitda == null ? null : ebitda - depreciationAmortization;
    const cogsByCategory = ITEM_CATEGORIES.map((category) => {
      const rows = itemProfitability.filter((item) => item.category === category);
      const code = category === 'Raw Material' ? 'CRW' : category === 'Support Material' ? 'CSM' : 'CPM';
      return { category, code, amount: rows.reduce((sum, item) => sum + Number(item.totalCogsAmount || 0), 0), missingCostQuantity: rows.reduce((sum, item) => sum + Number((item as any).missingCostQuantity || 0), 0) };
    });

    const adjustmentRows = await db.select({ cutoffAt: inventoryCostPeriods.cutoffAt, adjustmentValue: inventoryCostPeriods.adjustmentValue })
      .from(inventoryCostPeriods).where(eq(inventoryCostPeriods.status, 'Closed'));
    const periodStartMs = financePeriod?.startAt ? new Date(financePeriod.startAt).getTime() : null;
    const periodEndMs = financePeriod?.endAt ? new Date(financePeriod.endAt).getTime() : null;
    const inventoryAdjustmentAmount = adjustmentRows.reduce((sum, row) => {
      if (financePeriod?.status === 'All') return sum + Number(row.adjustmentValue || 0);
      const timestamp = transactionTimestamp(row.cutoffAt, null);
      if (timestamp == null || (periodStartMs != null && timestamp < periodStartMs)) return sum;
      if (periodEndMs != null && timestamp > periodEndMs) return sum;
      if (financePeriod?.status === 'Open' && periodStartMs != null && timestamp <= periodStartMs) return sum;
      return sum + Number(row.adjustmentValue || 0);
    }, 0);

    return {
      totalStock,
      barangMasukPcs,
      barangKeluarPcs,
      requestPending,
      recentTransactions,
      totalPurchaseAmount,
      totalCogsAmount,
      inventoryAdjustmentAmount,
      financePeriod: financePeriod || null,
      missingCostQuantity,
      hasMissingCostData,
      totalIncomingAmount,
      // Payment status is not persisted, so cash received cannot be inferred from sales.
      totalIncomeReceived: null,
      totalSellingAmount,
      totalProfit,
      otherIncome,
      shrinkageAmount,
      contributionMargin,
      contributionIncome,
      directCosts,
      depreciationAmortization,
      ebitda,
      ebit,
      manualEntries,
      manualByCode: Object.fromEntries(manualByCode),
      cogsByCategory,
      shrinkageDataAvailable: false,
      hasMissingShrinkageData: true,
      shrinkageUnavailableReason: 'Stock Opname belum memiliki status verifikasi dan persetujuan.',
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
      totalIncomeReceived: null,
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
