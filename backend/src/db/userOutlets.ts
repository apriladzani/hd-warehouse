import { pool } from './index.ts';

// Outlet placement of an account: one account may hold several outlets, one of
// them the default. Only an admin changes it (User Management).
//
// users.outlet_id is the old single placement. It is kept, and kept equal to
// the default outlet (NULL when the account has none), until every reader has
// moved to user_outlets. That also makes the migration below safe to repeat: an
// account that already has rows here is never touched, and an outlet the admin
// removed is gone from users.outlet_id too, so it never comes back.

type Executor = { query: (sql: string, values?: unknown[]) => Promise<any> };

export const USER_OUTLET_COLUMNS = `
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      outlet_id INT NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INT NULL,
      UNIQUE KEY uq_user_outlets_user_outlet (user_id, outlet_id),
      INDEX idx_user_outlets_outlet (outlet_id)`;

// Copies users.outlet_id into user_outlets (as default) for accounts that have
// no rows yet. `userId` limits it to one account. Read first, then insert: a
// statement may name a TEMPORARY table (the tests) only once.
async function migrateLegacyPlacement(executor: Executor, userId?: number) {
  const [rows] = await executor.query(
    `SELECT u.id AS userId, u.outlet_id AS outletId FROM users u
     JOIN outlets o ON o.id = u.outlet_id
     LEFT JOIN user_outlets x ON x.user_id = u.id
     WHERE u.outlet_id IS NOT NULL AND x.id IS NULL ${userId == null ? '' : 'AND u.id = ?'}`,
    userId == null ? [] : [userId]);
  const legacy = rows as any[];
  if (!legacy.length) return;
  await executor.query(`INSERT IGNORE INTO user_outlets (user_id, outlet_id, is_default, created_by) VALUES ${legacy.map(() => '(?, ?, 1, NULL)').join(', ')}`,
    legacy.flatMap((row) => [Number(row.userId), Number(row.outletId)]));
}

let schemaReady: Promise<void> | null = null;
export async function ensureUserOutletSchema() {
  if (!schemaReady) schemaReady = (async () => {
    // Reach for the table first: CREATE TABLE IF NOT EXISTS would build a real
    // table beside a test's TEMPORARY one.
    let exists = true;
    try { await pool.query('SELECT 1 FROM user_outlets LIMIT 0'); } catch { exists = false; }
    if (!exists) {
      await pool.query(`CREATE TABLE IF NOT EXISTS user_outlets (${USER_OUTLET_COLUMNS},
        CONSTRAINT fk_user_outlets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_user_outlets_outlet FOREIGN KEY (outlet_id) REFERENCES outlets (id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    await migrateLegacyPlacement(pool);
  })().catch((error) => { schemaReady = null; throw error; });
  await schemaReady;
}

export type UserOutlet = { id: number; code: string; name: string; isActive: boolean; isDefault: boolean };

// Outlets of one account, default first, then by name.
export async function getUserOutlets(userId: number, executor: Executor = pool): Promise<UserOutlet[]> {
  await ensureUserOutletSchema();
  await migrateLegacyPlacement(executor, userId);
  const [rows] = await executor.query(
    `SELECT o.id, o.outlet_code AS code, o.outlet_name AS name, o.is_active AS isActive, uo.is_default AS isDefault
     FROM user_outlets uo JOIN outlets o ON o.id = uo.outlet_id
     WHERE uo.user_id = ? ORDER BY uo.is_default DESC, o.outlet_name`, [userId]);
  return (rows as any[]).map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name), isActive: Number(row.isActive) === 1, isDefault: Number(row.isDefault) === 1 }));
}

// Outlets of every account, for User Management.
export async function getAllUserOutlets(): Promise<Map<number, UserOutlet[]>> {
  await ensureUserOutletSchema();
  await migrateLegacyPlacement(pool);
  const [rows] = await pool.query(
    `SELECT uo.user_id AS userId, o.id, o.outlet_code AS code, o.outlet_name AS name, o.is_active AS isActive, uo.is_default AS isDefault
     FROM user_outlets uo JOIN outlets o ON o.id = uo.outlet_id ORDER BY uo.is_default DESC, o.outlet_name`);
  const map = new Map<number, UserOutlet[]>();
  for (const row of rows as any[]) {
    const list = map.get(Number(row.userId)) ?? [];
    list.push({ id: Number(row.id), code: String(row.code), name: String(row.name), isActive: Number(row.isActive) === 1, isDefault: Number(row.isDefault) === 1 });
    map.set(Number(row.userId), list);
  }
  return map;
}

export type OutletSelection = { outletIds: number[]; defaultOutletId: number | null };

// Reads the outlet part of a create/update body. `outletIds` + `defaultOutletId`
// is the current shape; a single `outletId` (old clients) means that one outlet.
export function readOutletSelection(body: { outletIds?: unknown; defaultOutletId?: unknown; outletId?: unknown }): OutletSelection {
  const raw = body.outletIds !== undefined ? body.outletIds
    : body.outletId === undefined || body.outletId === null || body.outletId === '' ? [] : [body.outletId];
  if (!Array.isArray(raw)) throw new Error('Daftar outlet tidak valid');
  const outletIds = [...new Set(raw.map(Number))];
  if (outletIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Daftar outlet tidak valid');
  const requestedDefault = body.defaultOutletId === undefined || body.defaultOutletId === null || body.defaultOutletId === '' ? null : Number(body.defaultOutletId);
  if (requestedDefault !== null && !outletIds.includes(requestedDefault)) throw new Error('Outlet default harus salah satu outlet yang dipilih');
  return { outletIds, defaultOutletId: requestedDefault };
}

// Replaces the outlets of one account inside the caller's transaction and keeps
// users.outlet_id equal to the default. Rules: only role OUTLET has outlets; an
// outlet added now must be active; an inactive outlet the account already has
// may stay. Returns what changed, by outlet name, for the activity log.
export async function replaceUserOutlets(connection: Executor, userId: number, role: string, selection: OutletSelection, actorId: number | null) {
  if (role !== 'OUTLET' && selection.outletIds.length) throw new Error('Penempatan outlet hanya berlaku untuk role Outlet');
  const [currentRows] = await connection.query('SELECT outlet_id AS outletId, is_default AS isDefault FROM user_outlets WHERE user_id = ? FOR UPDATE', [userId]);
  const current = (currentRows as any[]).map((row) => ({ outletId: Number(row.outletId), isDefault: Number(row.isDefault) === 1 }));
  const currentIds = new Set(current.map((row) => row.outletId));

  const names = new Map<number, { name: string; isActive: boolean }>();
  const wanted = [...new Set([...selection.outletIds, ...currentIds])];
  if (wanted.length) {
    const [outletRows] = await connection.query(`SELECT id, outlet_name AS name, is_active AS isActive FROM outlets WHERE id IN (${wanted.map(() => '?').join(',')})`, wanted);
    for (const row of outletRows as any[]) names.set(Number(row.id), { name: String(row.name), isActive: Number(row.isActive) === 1 });
  }
  for (const id of selection.outletIds) {
    const outlet = names.get(id);
    if (!outlet) throw new Error('Outlet tidak ditemukan');
    if (!outlet.isActive && !currentIds.has(id)) throw new Error(`Outlet ${outlet.name} sedang nonaktif dan tidak dapat ditambahkan`);
  }

  // Default: the one asked for; else keep the current one if it stays; else the
  // first active outlet chosen; else the first chosen.
  const previousDefault = current.find((row) => row.isDefault)?.outletId ?? null;
  const defaultOutletId = selection.defaultOutletId
    ?? (previousDefault !== null && selection.outletIds.includes(previousDefault) ? previousDefault : null)
    ?? selection.outletIds.find((id) => names.get(id)?.isActive)
    ?? selection.outletIds[0] ?? null;

  const added = selection.outletIds.filter((id) => !currentIds.has(id));
  const removed = [...currentIds].filter((id) => !selection.outletIds.includes(id));
  if (removed.length) await connection.query(`DELETE FROM user_outlets WHERE user_id = ? AND outlet_id IN (${removed.map(() => '?').join(',')})`, [userId, ...removed]);
  for (const id of added) await connection.query('INSERT INTO user_outlets (user_id, outlet_id, is_default, created_by) VALUES (?, ?, 0, ?)', [userId, id, actorId]);
  await connection.query('UPDATE user_outlets SET is_default = (outlet_id = ?) WHERE user_id = ?', [defaultOutletId ?? 0, userId]);
  await connection.query('UPDATE users SET outlet_id = ? WHERE id = ?', [defaultOutletId, userId]);

  const name = (id: number | null) => (id === null ? null : names.get(id)?.name ?? `Outlet #${id}`);
  return {
    changed: added.length > 0 || removed.length > 0 || previousDefault !== defaultOutletId,
    added: added.map(name), removed: removed.map(name),
    defaultFrom: name(previousDefault), defaultTo: name(defaultOutletId),
  };
}
