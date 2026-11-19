import { pool } from '../db/index.ts';
import { logAdminActivity } from '../db/repository.ts';
import { MappingError } from './hdOutletSync.ts';

// Finance view of Warehouse outlets. An old Warehouse outlet (Cisalak Pagi,
// Cisalak Malam) can be merged into another (Cisalak): Finance reports its
// numbers under that outlet. Nothing in Warehouse changes: requests keep their
// outlet; only the Finance report adds them up under the target.
export const FINANCE_OUTLET_MERGE_COLUMNS = `
  outlet_id INT NOT NULL PRIMARY KEY,
  target_outlet_id INT NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_finance_outlet_merge_target (target_outlet_id)`;

let ready: Promise<void> | null = null;
export function ensureOutletMergeSchema() {
  if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS finance_outlet_merges (${FINANCE_OUTLET_MERGE_COLUMNS}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    .then(() => undefined).catch((error) => { ready = null; throw error; });
  return ready;
}

const names = async (sql: string) => {
  try { const [rows] = await pool.query(sql); return rows as any[]; }
  catch (error: any) { if (error?.code === 'ER_NO_SUCH_TABLE') return []; throw error; }
};

// Every Warehouse outlet with what Finance knows about it.
export async function outletDisplayOverview() {
  await ensureOutletMergeSchema();
  const [outlets] = await pool.query('SELECT o.id, o.outlet_name AS name, o.is_active AS isActive, m.target_outlet_id AS mergedInto FROM outlets o LEFT JOIN finance_outlet_merges m ON m.outlet_id = o.id ORDER BY o.outlet_name, o.id');
  const hdo = await names('SELECT outlet_id AS outletId, hd_outlet_name AS name FROM hdoutlet_outlet_mappings WHERE outlet_id IS NOT NULL ORDER BY hd_outlet_name');
  const hda = await names('SELECT outlet_id AS outletId, hda_outlet_name AS name FROM hdattendance_outlet_mappings WHERE outlet_id IS NOT NULL ORDER BY hda_outlet_name');
  const requests = await names('SELECT outlet_id AS outletId, COUNT(*) AS n FROM requests WHERE outlet_id IS NOT NULL GROUP BY outlet_id');
  const of = (rows: any[], outletId: number) => rows.filter(r => Number(r.outletId) === outletId).map(r => String(r.name));
  return {
    outlets: (outlets as any[]).map(o => ({
      id: Number(o.id), name: String(o.name), isActive: Number(o.isActive) === 1, mergedInto: o.mergedInto == null ? null : Number(o.mergedInto),
      hdOutlet: of(hdo, Number(o.id)), hdAttendance: of(hda, Number(o.id)), requestCount: Number(requests.find(r => Number(r.outletId) === Number(o.id))?.n ?? 0),
    })),
  };
}

export async function setOutletMerge(outletId: number, input: { targetOutletId?: unknown }, actor: { id: number; name?: string }) {
  await ensureOutletMergeSchema();
  const [found] = await pool.query('SELECT id, outlet_name AS name FROM outlets WHERE id = ?', [outletId]);
  const outlet = (found as any[])[0];
  if (!outlet) throw new MappingError('Outlet tidak ditemukan.');
  const [beforeRows] = await pool.query('SELECT target_outlet_id AS target FROM finance_outlet_merges WHERE outlet_id = ?', [outletId]);
  const before = (beforeRows as any[])[0]?.target ?? null;
  const raw = input.targetOutletId;
  let target: number | null = null;
  if (raw !== null && raw !== undefined && raw !== '') {
    target = Number(raw);
    if (!Number.isSafeInteger(target) || target <= 0) throw new MappingError('Outlet tujuan tidak valid.');
    if (target === outletId) throw new MappingError('Outlet tidak bisa digabung ke dirinya sendiri.');
    const [targets] = await pool.query('SELECT o.id, o.outlet_name AS name, m.target_outlet_id AS mergedInto FROM outlets o LEFT JOIN finance_outlet_merges m ON m.outlet_id = o.id WHERE o.id = ?', [target]);
    const row = (targets as any[])[0];
    if (!row) throw new MappingError('Outlet tujuan tidak ditemukan.');
    if (row.mergedInto != null) throw new MappingError(`${row.name} sudah digabung ke outlet lain; pilih outlet tujuannya langsung.`);
    const [children] = await pool.query('SELECT COUNT(*) AS n FROM finance_outlet_merges WHERE target_outlet_id = ?', [outletId]);
    if (Number((children as any[])[0].n)) throw new MappingError(`Outlet lain sudah digabung ke ${outlet.name}. Lepas gabungan itu dulu.`);
    await pool.query('INSERT INTO finance_outlet_merges (outlet_id, target_outlet_id, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE target_outlet_id = VALUES(target_outlet_id), updated_by = VALUES(updated_by)', [outletId, target, actor.id]);
  } else {
    await pool.query('DELETE FROM finance_outlet_merges WHERE outlet_id = ?', [outletId]);
  }
  await logAdminActivity({ actorId: actor.id, actorName: actor.name || `user#${actor.id}`, action: 'FINANCE_OUTLET_MERGE', targetType: 'outlet', targetId: String(outletId), details: { name: outlet.name, before, after: target } }).catch(() => {});
  return { outletId, mergedInto: target };
}
