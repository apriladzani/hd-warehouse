import { randomUUID } from 'node:crypto';
import { pool } from '../db/index.ts';
import { closedPeriodChecker, logAdminActivity } from '../db/repository.ts';
import { decimal, money } from './decimal.ts';
import { ensureFinanceTransactionSchema } from './transactionRepository.ts';
import { HDOUTLET_SYNC_RUN_COLUMNS, allowSharedOutlet, matchOutletName, MappingError, sameOutletName } from './hdOutletSync.ts';
import { HdAttendanceClient, HdAttendanceError, hdAttendanceConfig, type HdAttendanceConfig } from './hdAttendanceClient.ts';

// HD Attendance → Finance ledger, salary (LC01) per outlet per day:
//   every attendance with status "present" on a day at an outlet = 1 day ×
//   the daily wage (dailyWage) of the employee's position, also without a
//   check-out yet. One entry per HD Attendance outlet and day, source
//   'hdattendance', source_ref hda:<outlet id>:<date>:LC01, so a re-sync
//   updates instead of duplicating. The wage is taken at sync time; a day
//   inside a closed period keeps the amount it was booked with.
// Attendance rows are stored (no names or contact details) so a mapping change
// can be applied without calling HD Attendance again.

export const SALARY_ACCOUNT = 'LC01';
export const PAID_STATUSES = new Set(['present']);

export const HDATTENDANCE_OUTLET_MAPPING_COLUMNS = `
  hda_outlet_id INT NOT NULL PRIMARY KEY,
  hda_outlet_name VARCHAR(255) NOT NULL,
  outlet_id INT NULL,
  matched_by VARCHAR(10) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_hdattendance_mapping_outlet (outlet_id)`;
export const HDATTENDANCE_RECORD_COLUMNS = `
  attendance_id INT NOT NULL PRIMARY KEY,
  employee_id INT NOT NULL,
  hda_outlet_id INT NULL,
  hda_outlet_name VARCHAR(255) NULL,
  attendance_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL,
  position_name VARCHAR(100) NULL,
  daily_wage DECIMAL(24,6) NULL,
  deleted_at TIMESTAMP(3) NULL,
  first_synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_hdattendance_records_day (hda_outlet_id, attendance_date),
  INDEX idx_hdattendance_records_date (attendance_date)`;
export const HDATTENDANCE_SYNC_RUN_COLUMNS = HDOUTLET_SYNC_RUN_COLUMNS;

type Query = { query: (sql: string, values?: unknown[]) => Promise<any> };
let schemaReady: Promise<void> | null = null;
export function ensureHdAttendanceSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await ensureFinanceTransactionSchema();
    const exists = async (table: string) => { try { await pool.query(`SELECT 1 FROM \`${table}\` LIMIT 1`); return true; } catch { return false; } };
    for (const [table, columns] of [['hdattendance_outlet_mappings', HDATTENDANCE_OUTLET_MAPPING_COLUMNS], ['hdattendance_records', HDATTENDANCE_RECORD_COLUMNS],
      ['hdattendance_sync_runs', HDATTENDANCE_SYNC_RUN_COLUMNS]] as const) {
      if (!await exists(table)) await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (${columns}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    await allowSharedOutlet('hdattendance_outlet_mappings', 'uq_hdattendance_mapping_outlet', 'idx_hdattendance_mapping_outlet');
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

const rupiah = (amount: string) => `Rp${Number(amount).toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
export type DayRecord = { status: string; dailyWage: string | null; positionName: string | null };
// Pure: the salary of one outlet-day and how it was made up.
export function daySalary(records: DayRecord[]) {
  let total = 0n, paid = 0, withoutWage = 0;
  const byWage = new Map<string, { position: string; wage: string; count: number }>();
  for (const r of records) {
    if (!PAID_STATUSES.has(r.status)) continue;
    const wage = r.dailyWage == null ? 0n : decimal(money(decimal(r.dailyWage)));
    if (wage <= 0n) { withoutWage++; continue; }
    paid++; total += wage;
    const key = `${r.positionName ?? ''}|${money(wage)}`;
    const line = byWage.get(key) ?? { position: r.positionName ?? 'Tanpa posisi', wage: money(wage), count: 0 };
    line.count++; byWage.set(key, line);
  }
  const lines = [...byWage.values()].sort((a, b) => a.position.localeCompare(b.position)).map(l => `${l.count} × ${l.position} ${rupiah(l.wage)}`);
  return { amount: money(total), paid, withoutWage, breakdown: lines.join(', ') };
}

type Counts = { created: number; updated: number; voided: number; skippedClosed: number; closedDates: Set<string> };
const newCounts = (): Counts => ({ created: 0, updated: 0, voided: 0, skippedClosed: 0, closedDates: new Set() });
const closedMessage = (counts: Counts) => counts.skippedClosed
  ? [`${counts.skippedClosed} perubahan tidak diterapkan karena tanggalnya di periode yang sudah ditutup (${[...counts.closedDates].sort().join(', ')}).`] : [];
type Ctx = { outletOf: Map<number, number>; accountId: number; closed: (day: string) => string | null; actorId: number | null };

// Brings the LC01 entry of one HD Attendance outlet-day in line with its
// stored attendance and the current mapping. A day never booked is added even
// inside a closed period (as HD Outlet reports); changing or removing an entry
// already booked there is skipped and counted.
async function rebuildDay(conn: Query, hdaOutletId: number, day: string, ctx: Ctx, counts: Counts) {
  const [rows] = await conn.query(`SELECT r.status, CAST(r.daily_wage AS CHAR) AS dailyWage, r.position_name AS positionName, m.hda_outlet_name AS outletName
    FROM hdattendance_records r LEFT JOIN hdattendance_outlet_mappings m ON m.hda_outlet_id = r.hda_outlet_id
    WHERE r.hda_outlet_id = ? AND r.attendance_date = ? AND r.deleted_at IS NULL FOR UPDATE`, [hdaOutletId, day]);
  const outletId = ctx.outletOf.get(hdaOutletId) ?? null;
  const salary = daySalary(rows as DayRecord[]);
  const sourceRef = `hda:${hdaOutletId}:${day}:${SALARY_ACCOUNT}`;
  const name = (rows as any[])[0]?.outletName ?? `outlet #${hdaOutletId}`;
  const wanted = outletId !== null && decimal(salary.amount) > 0n
    ? { amount: salary.amount, notes: `Gaji harian HD Attendance ${name} · ${salary.paid} karyawan hadir (${salary.breakdown})`.slice(0, 500) } : null;
  const [existingRows] = await conn.query(`SELECT t.id, t.outlet_id AS outletId, DATE_FORMAT(t.transaction_date, '%Y-%m-%d') AS date, CAST(t.amount AS CHAR) AS amount,
    t.notes, t.status, t.account_id AS accountId FROM finance_transactions t WHERE t.source_ref = ? FOR UPDATE`, [sourceRef]);
  const before = (existingRows as any[])[0];
  const audit = async (id: string, before: unknown, after: unknown) => conn.query(
    'INSERT INTO finance_transaction_audits (transaction_id, action, actor_id, occurred_at, reason, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, 'SYNC', ctx.actorId ?? 0, new Date().toISOString(), `Sinkron HD Attendance ${name} ${day}`, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
  const skip = () => {
    if (!ctx.closed(day)) return false;
    counts.skippedClosed++; counts.closedDates.add(day); return true;
  };
  if (wanted) {
    const after = { accountCode: SALARY_ACCOUNT, ...wanted, date: day, unit: { type: 'OUTLET', outletId }, status: 'posted', source: 'hdattendance', sourceRef };
    if (!before) {
      const id = randomUUID();
      await conn.query(`INSERT INTO finance_transactions (id, account_id, unit_type, outlet_id, transaction_date, amount, notes, evidence_reference, status, nature,
        idempotency_key, version, source, source_ref, created_by) VALUES (?, ?, 'OUTLET', ?, ?, ?, ?, ?, 'posted', 'EXTERNAL', ?, 1, 'hdattendance', ?, ?)`,
        [id, ctx.accountId, outletId, day, wanted.amount, wanted.notes, `HDA-${hdaOutletId}-${day}`, sourceRef, sourceRef, ctx.actorId]);
      await audit(id, null, after); counts.created++;
      return;
    }
    const same = before.status === 'posted' && Number(before.accountId) === ctx.accountId && Number(before.outletId) === outletId && money(decimal(before.amount)) === wanted.amount && before.notes === wanted.notes;
    if (same || skip()) return;
    await conn.query(`UPDATE finance_transactions SET account_id = ?, unit_type = 'OUTLET', outlet_id = ?, amount = ?, notes = ?, status = 'posted', version = version + 1 WHERE id = ?`,
      [ctx.accountId, outletId, wanted.amount, wanted.notes, before.id]);
    await audit(before.id, before, after); counts.updated++;
    return;
  }
  if (!before || before.status !== 'posted' || skip()) return;
  await conn.query("UPDATE finance_transactions SET status = 'void', version = version + 1 WHERE id = ?", [before.id]);
  await audit(before.id, before, { ...before, status: 'void' }); counts.voided++;
}

type Day = { hdaOutletId: number; date: string };
async function rebuild(days: Day[], actorId: number | null, counts: Counts) {
  const unique = [...new Map(days.map(d => [`${d.hdaOutletId}|${d.date}`, d])).values()].sort((a, b) => a.date.localeCompare(b.date) || a.hdaOutletId - b.hdaOutletId);
  if (!unique.length) return;
  const closed = await closedPeriodChecker();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [mapRows] = await connection.query('SELECT hda_outlet_id AS id, outlet_id AS outletId FROM hdattendance_outlet_mappings WHERE outlet_id IS NOT NULL');
    const [[account]] = await connection.query('SELECT id FROM finance_accounts WHERE code = ?', [SALARY_ACCOUNT]) as any;
    if (!account) throw new Error(`Kode akun ${SALARY_ACCOUNT} tidak ada di master akun.`);
    const ctx: Ctx = { outletOf: new Map((mapRows as any[]).map(r => [Number(r.id), Number(r.outletId)])), accountId: Number(account.id), closed, actorId };
    for (const d of unique) await rebuildDay(connection, d.hdaOutletId, d.date, ctx, counts);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

// A new HD Attendance outlet is paired automatically, marked 'auto' for Finance
// to check: with the Warehouse outlet whose name it stands for (one only), or
// else with the Warehouse outlet of the HD Outlet outlet of the same name that
// is already mapped ("TMS Tamansari" follows "TMS TamanSari"). An ambiguous
// name is never guessed; a pairing Finance set or cleared is never touched.
export async function autoMatchHdaOutlets(executor: Query = pool) {
  const [rows] = await executor.query('SELECT hda_outlet_id AS id, hda_outlet_name AS name FROM hdattendance_outlet_mappings WHERE outlet_id IS NULL AND matched_by IS NULL');
  if (!(rows as any[]).length) return 0;
  const [outletRows] = await executor.query('SELECT id, outlet_name AS name FROM outlets WHERE is_active = 1');
  const outlets = (outletRows as any[]).map(o => ({ id: Number(o.id), name: String(o.name) }));
  let hdOutlet: { name: string; outletId: number }[] = [];
  try {
    const [hd] = await executor.query('SELECT hd_outlet_name AS name, outlet_id AS outletId FROM hdoutlet_outlet_mappings WHERE outlet_id IS NOT NULL');
    hdOutlet = (hd as any[]).map(r => ({ name: String(r.name), outletId: Number(r.outletId) }));
  } catch { /* HD Outlet integration never ran */ }
  const active = new Set(outlets.map(o => o.id));
  const [taken] = await executor.query('SELECT outlet_id AS outletId FROM hdattendance_outlet_mappings WHERE outlet_id IS NOT NULL');
  const used = new Set((taken as any[]).map(r => Number(r.outletId)));
  // A pairing taken over from HD Outlet was set there (and checked) by Finance,
  // merges included: it does not compete with the others for the outlet.
  const proposals = (rows as any[]).map(r => {
    const name = String(r.name);
    let outletId = matchOutletName(name, outlets), inherited = false;
    if (outletId === null) {
      const viaHd = [...new Set(hdOutlet.filter(h => sameOutletName(h.name, name)).map(h => h.outletId))];
      if (viaHd.length === 1 && active.has(viaHd[0])) { outletId = viaHd[0]; inherited = true; }
    }
    return { id: Number(r.id), outletId, inherited };
  });
  const claims = new Map<number, number>();
  for (const p of proposals) if (p.outletId !== null && !p.inherited) claims.set(p.outletId, (claims.get(p.outletId) ?? 0) + 1);
  let paired = 0;
  for (const p of proposals) {
    if (p.outletId === null || (!p.inherited && (claims.get(p.outletId) !== 1 || used.has(p.outletId)))) continue;
    await executor.query("UPDATE hdattendance_outlet_mappings SET outlet_id = ?, matched_by = 'auto' WHERE hda_outlet_id = ? AND outlet_id IS NULL", [p.outletId, p.id]);
    used.add(p.outletId); paired++;
  }
  return paired;
}

type RunInput = { trigger: 'manual' | 'schedule' | 'mapping'; startDate?: string | null; endDate?: string | null; actor?: { id: number; name?: string } | null };
async function startRun(input: RunInput) {
  const [result] = await pool.query("INSERT INTO hdattendance_sync_runs (trigger_type, start_date, end_date, status, triggered_by) VALUES (?, ?, ?, 'running', ?)",
    [input.trigger, input.startDate ?? null, input.endDate ?? null, input.actor?.id ?? null]);
  return Number((result as any).insertId);
}
async function finishRun(id: number, status: string, fields: { fetched?: number; counts?: Counts; messages: string[] }) {
  const c = fields.counts;
  await pool.query(`UPDATE hdattendance_sync_runs SET status = ?, finished_at = CURRENT_TIMESTAMP(3), reports_fetched = ?, entries_created = ?, entries_updated = ?,
    entries_voided = ?, skipped_closed = ?, message = ? WHERE id = ?`,
    [status, fields.fetched ?? 0, c?.created ?? 0, c?.updated ?? 0, c?.voided ?? 0, c?.skippedClosed ?? 0, fields.messages.join('\n').slice(0, 60000) || null, id]);
}

let running: Promise<unknown> | null = null;
export type HdaSyncResult = { runId: number; status: 'success' | 'partial' | 'failed'; recordsFetched: number; created: number; updated: number; voided: number; skippedClosed: number; messages: string[] };

// Reads outlets, positions, employees and the attendance of the period, stores
// the attendance with the wage of the moment, and rebuilds the salary entries.
// If HD Attendance cannot be reached the stored data stays as it was.
export async function syncHdAttendance(input: { startDate: string; endDate: string; trigger: 'manual' | 'schedule'; actor?: { id: number; name?: string } | null; client?: HdAttendanceClient; config?: HdAttendanceConfig }): Promise<HdaSyncResult> {
  if (running) throw new HdAttendanceError('BUSY', 'Sinkron HD Attendance sedang berjalan. Tunggu sampai selesai.');
  const task = (async () => {
    await ensureHdAttendanceSchema();
    const lock = await pool.getConnection();
    const [[got]] = await lock.query("SELECT GET_LOCK('hdattendance_sync', 0) AS got") as any;
    if (Number(got?.got) !== 1) { lock.release(); throw new HdAttendanceError('BUSY', 'Sinkron HD Attendance sedang berjalan di server lain. Tunggu sampai selesai.'); }
    try { return await runSync(input); }
    finally { await lock.query("SELECT RELEASE_LOCK('hdattendance_sync')").catch(() => {}); lock.release(); }
  })();
  running = task;
  try { return await task; } finally { running = null; }
}

async function runSync(input: Parameters<typeof syncHdAttendance>[0]): Promise<HdaSyncResult> {
  const runId = await startRun(input);
  const counts = newCounts(), messages: string[] = [];
  let fetched = 0;
  try {
    const config = input.config ?? hdAttendanceConfig();
    if (!input.client && !config.enabled) throw new HdAttendanceError('DISABLED', 'Integrasi HD Attendance nonaktif (HDATTENDANCE_API_ENABLED bukan true).');
    const client = input.client ?? new HdAttendanceClient(config.baseUrl, config.apiKey, config.timeoutMs);
    const [outlets, positions, employees, result] = await Promise.all([client.outlets(), client.positions(), client.employees(), client.attendance(input.startDate, input.endDate)]);
    fetched = result.rows.length;
    messages.push(...result.errors.slice(0, 20));
    for (const outlet of outlets) {
      await pool.query('INSERT INTO hdattendance_outlet_mappings (hda_outlet_id, hda_outlet_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE hda_outlet_name = VALUES(hda_outlet_name)', [outlet.id, outlet.name.slice(0, 255)]);
    }
    await autoMatchHdaOutlets();
    const positionOf = new Map(positions.map(p => [p.id, p])), employeeOf = new Map(employees.map(e => [e.id, e]));
    const outletIds = new Set(outlets.map(o => o.id));
    const days: Day[] = [];
    // Where each fetched attendance was before (an outlet or date corrected in HD Attendance).
    const ids = result.rows.map(r => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const [old] = await pool.query(`SELECT hda_outlet_id AS id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date FROM hdattendance_records WHERE hda_outlet_id IS NOT NULL AND attendance_id IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const r of old as any[]) days.push({ hdaOutletId: Number(r.id), date: String(r.date) });
    }
    let withoutOutlet = 0, withoutWage = 0;
    const otherStatus = new Map<string, number>();
    for (const row of result.rows) {
      let hdaOutletId = row.outletId !== null && outletIds.has(row.outletId) ? row.outletId : null;
      if (hdaOutletId === null && row.outletName) {
        const hits = outlets.filter(o => sameOutletName(o.name, row.outletName!));
        if (hits.length === 1) hdaOutletId = hits[0].id;
      }
      if (hdaOutletId === null) withoutOutlet++;
      const position = (() => { const e = employeeOf.get(row.employeeId); return e?.positionId ? positionOf.get(e.positionId) ?? null : null; })();
      if (PAID_STATUSES.has(row.status) && (!position || decimal(position.dailyWage) <= 0n)) withoutWage++;
      if (!PAID_STATUSES.has(row.status)) otherStatus.set(row.status, (otherStatus.get(row.status) ?? 0) + 1);
      await pool.query(`INSERT INTO hdattendance_records (attendance_id, employee_id, hda_outlet_id, hda_outlet_name, attendance_date, status, position_name, daily_wage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), hda_outlet_id = VALUES(hda_outlet_id), hda_outlet_name = VALUES(hda_outlet_name),
        attendance_date = VALUES(attendance_date), status = VALUES(status), position_name = VALUES(position_name), daily_wage = VALUES(daily_wage), deleted_at = NULL, last_synced_at = CURRENT_TIMESTAMP(3)`,
        [row.id, row.employeeId, hdaOutletId, row.outletName?.slice(0, 255) ?? null, row.date, row.status.slice(0, 30), position?.name.slice(0, 100) ?? null, position?.dailyWage ?? null]);
      if (hdaOutletId !== null) days.push({ hdaOutletId, date: row.date });
    }
    // An attendance removed in HD Attendance is removed here too, but only when
    // the whole list was read without errors.
    if (!result.errors.length) {
      const [gone] = await pool.query(`SELECT attendance_id AS id FROM hdattendance_records WHERE attendance_date BETWEEN ? AND ? AND deleted_at IS NULL${ids.length ? ` AND attendance_id NOT IN (${ids.map(() => '?').join(',')})` : ''}`,
        [input.startDate, input.endDate, ...ids]);
      const goneIds = (gone as any[]).map(r => Number(r.id));
      if (goneIds.length) {
        await pool.query(`UPDATE hdattendance_records SET deleted_at = CURRENT_TIMESTAMP(3) WHERE attendance_id IN (${goneIds.map(() => '?').join(',')})`, goneIds);
        messages.push(`${goneIds.length} absensi tidak lagi ada di HD Attendance; tidak dihitung lagi.`);
      }
    }
    const [stored] = await pool.query(`SELECT DISTINCT hda_outlet_id AS id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date FROM hdattendance_records WHERE hda_outlet_id IS NOT NULL AND attendance_date BETWEEN ? AND ?`, [input.startDate, input.endDate]);
    for (const r of stored as any[]) days.push({ hdaOutletId: Number(r.id), date: String(r.date) });
    await rebuild(days, input.actor?.id ?? null, counts);
    if (withoutOutlet) messages.push(`${withoutOutlet} absensi tanpa outlet yang dikenal; gajinya tidak masuk outlet mana pun.`);
    if (withoutWage) messages.push(`${withoutWage} absensi hadir tanpa upah harian (karyawan belum punya posisi atau upah posisinya Rp0); tidak dihitung.`);
    if (otherStatus.size) messages.push(`Absensi berstatus ${[...otherStatus].map(([s, n]) => `"${s}" (${n})`).join(', ')} tidak dihitung sebagai hari kerja.`);
    messages.push(...closedMessage(counts));
    const status = result.errors.length || counts.skippedClosed || withoutOutlet || withoutWage ? 'partial' : 'success';
    await finishRun(runId, status, { fetched, counts, messages });
    return { runId, status, recordsFetched: fetched, created: counts.created, updated: counts.updated, voided: counts.voided, skippedClosed: counts.skippedClosed, messages };
  } catch (error) {
    const message = error instanceof HdAttendanceError ? error.message : `Sinkron gagal: ${error instanceof Error ? error.message : 'kesalahan tidak dikenal'}`;
    await finishRun(runId, 'failed', { fetched, messages: [message, ...messages] }).catch(() => {});
    return { runId, status: 'failed', recordsFetched: fetched, created: 0, updated: 0, voided: 0, skippedClosed: 0, messages: [message, ...messages] };
  }
}

export async function setHdaOutletMapping(hdaOutletId: number, outletId: number | null, actor: { id: number; name?: string }) {
  await ensureHdAttendanceSchema();
  const [found] = await pool.query('SELECT hda_outlet_name AS name, outlet_id AS outletId FROM hdattendance_outlet_mappings WHERE hda_outlet_id = ?', [hdaOutletId]);
  const before = (found as any[])[0];
  if (!before) throw new MappingError('Outlet HD Attendance tidak dikenal. Jalankan sinkron dulu.');
  if (outletId !== null) {
    const [outlets] = await pool.query('SELECT id FROM outlets WHERE id = ? AND is_active = 1', [outletId]);
    if (!(outlets as any[]).length) throw new MappingError('Outlet Warehouse tidak ditemukan atau nonaktif.');
  }
  await pool.query("UPDATE hdattendance_outlet_mappings SET outlet_id = ?, matched_by = 'finance', updated_by = ? WHERE hda_outlet_id = ?", [outletId, actor.id, hdaOutletId]);
  await logAdminActivity({ actorId: actor.id, actorName: actor.name || `user#${actor.id}`, action: 'FINANCE_HDATTENDANCE_OUTLET_MAPPING', targetType: 'hdattendance_outlet', targetId: hdaOutletId, details: { hdaOutletName: before.name, before: before.outletId, after: outletId } }).catch(() => {});
  // Apply to the stored attendance of that outlet, without calling HD Attendance.
  const runId = await startRun({ trigger: 'mapping', actor });
  const counts = newCounts();
  try {
    const [rows] = await pool.query("SELECT DISTINCT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date FROM hdattendance_records WHERE hda_outlet_id = ?", [hdaOutletId]);
    await rebuild((rows as any[]).map(r => ({ hdaOutletId, date: String(r.date) })), actor.id, counts);
    const messages = closedMessage(counts);
    await finishRun(runId, counts.skippedClosed ? 'partial' : 'success', { fetched: (rows as any[]).length, counts, messages });
    return { created: counts.created, updated: counts.updated, voided: counts.voided, skippedClosed: counts.skippedClosed, messages };
  } catch (error) {
    await finishRun(runId, 'failed', { messages: [error instanceof Error ? error.message : 'Gagal menerapkan mapping'] }).catch(() => {});
    throw error;
  }
}

// For the Finance settings page.
export async function hdAttendanceOverview(config: HdAttendanceConfig = hdAttendanceConfig()) {
  await ensureHdAttendanceSchema();
  let host: string | null = null;
  try { host = config.baseUrl ? new URL(config.baseUrl).origin : null; } catch { host = null; }
  const [outlets] = await pool.query(`SELECT m.hda_outlet_id AS id, m.hda_outlet_name AS name, m.outlet_id AS outletId, o.outlet_name AS outletName, m.matched_by AS matchedBy,
    (SELECT COUNT(*) FROM hdattendance_records r WHERE r.hda_outlet_id = m.hda_outlet_id AND r.deleted_at IS NULL) AS recordCount
    FROM hdattendance_outlet_mappings m LEFT JOIN outlets o ON o.id = m.outlet_id ORDER BY m.hda_outlet_name`);
  const [runs] = await pool.query(`SELECT id, trigger_type AS triggerType, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate,
    CAST(ROUND(UNIX_TIMESTAMP(started_at) * 1000) AS CHAR) AS startedMs, CAST(ROUND(UNIX_TIMESTAMP(finished_at) * 1000) AS CHAR) AS finishedMs, status,
    reports_fetched AS recordsFetched, entries_created AS created, entries_updated AS updated, entries_voided AS voided, skipped_closed AS skippedClosed, message
    FROM hdattendance_sync_runs ORDER BY id DESC LIMIT 30`);
  return {
    config: { enabled: config.enabled, host, keyConfigured: Boolean(config.apiKey), syncHour: config.syncHour, syncDays: config.syncDays, account: SALARY_ACCOUNT },
    outlets: (outlets as any[]).map(r => ({ hdaOutletId: Number(r.id), hdaOutletName: r.name, outletId: r.outletId == null ? null : Number(r.outletId), outletName: r.outletName ?? null, matchedBy: r.matchedBy ?? null, recordCount: Number(r.recordCount) })),
    runs: (runs as any[]).map(({ startedMs, finishedMs, ...r }) => ({ ...r, id: Number(r.id), recordsFetched: Number(r.recordsFetched), created: Number(r.created), updated: Number(r.updated), voided: Number(r.voided), skippedClosed: Number(r.skippedClosed),
      startedAt: new Date(Number(startedMs)).toISOString(), finishedAt: finishedMs == null ? null : new Date(Number(finishedMs)).toISOString() })),
  };
}

const jakarta = (now: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
  .formatToParts(now).map(p => [p.type, p.value]));

// Nightly sync of the last `syncDays` days at `syncHour` (Asia/Jakarta), and on
// the first start with the integration on, the current month at once.
export function startHdAttendanceScheduler(config: HdAttendanceConfig = hdAttendanceConfig(), now = () => new Date()) {
  if (!config.enabled) return null;
  let lastDay = '';
  const tick = async () => {
    const parts = jakarta(now());
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) !== config.syncHour || lastDay === today || running) return;
    lastDay = today;
    const start = new Date(Date.parse(`${today}T00:00:00Z`) - config.syncDays * 86400000).toISOString().slice(0, 10);
    const result = await syncHdAttendance({ startDate: start, endDate: today, trigger: 'schedule', config }).catch(error => ({ status: 'failed', messages: [String(error?.message ?? error)] }));
    if (result.status !== 'success') console.warn('[hd-attendance-sync]', result.status, result.messages.join(' | '));
  };
  const timer = setInterval(() => { void tick(); }, 5 * 60 * 1000);
  timer.unref();
  const first = setTimeout(() => { void initialHdAttendanceSync(config, now).catch(error => console.warn('[hd-attendance-sync] initial', String(error?.message ?? error))); }, 30_000);
  first.unref();
  return () => { clearInterval(timer); clearTimeout(first); };
}

export async function initialHdAttendanceSync(config: HdAttendanceConfig = hdAttendanceConfig(), now = () => new Date()) {
  await ensureHdAttendanceSchema();
  const [done] = await pool.query("SELECT id FROM hdattendance_sync_runs WHERE trigger_type <> 'mapping' AND status IN ('success', 'partial') LIMIT 1");
  if ((done as any[]).length || running) return null;
  const parts = jakarta(now());
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const result = await syncHdAttendance({ startDate: `${today.slice(0, 8)}01`, endDate: today, trigger: 'schedule', config })
    .catch(error => ({ status: 'failed', messages: [String(error?.message ?? error)] }));
  console.log('[hd-attendance-sync] initial', result.status, result.messages.join(' | '));
  return result;
}
