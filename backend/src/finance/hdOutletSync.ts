import { createHash, randomUUID } from 'node:crypto';
import { pool } from '../db/index.ts';
import { closedPeriodChecker, logAdminActivity } from '../db/repository.ts';
import { decimal, money } from './decimal.ts';
import { ensureFinanceTransactionSchema } from './transactionRepository.ts';
import { HdOutletClient, HdOutletError, hdOutletConfig, type HdOutletConfig, type HdReport } from './hdOutletClient.ts';
import { ACCOUNT_GROUPS } from './validation.ts';

// HD Outlet daily reports → Finance ledger.
//   Total Pemasukan → SI · Total Kerugian (loss sisa stok) → SH
//   each expense by its key → the account code mapped to it (meal → LC04,
//   bonus → LC03 by default); a key without a mapping waits in the
//   "Belum dipetakan" queue and is not counted until Finance picks a code.
// Stock, tosser and payments are kept in the stored report as reference only.
// Entries carry source 'hdoutlet' and source_ref hdo:<report id>:<component>,
// so syncing the same report again updates instead of duplicating.

export const HDOUTLET_OUTLET_MAPPING_COLUMNS = `
  hd_outlet_id INT NOT NULL PRIMARY KEY,
  hd_outlet_name VARCHAR(255) NOT NULL,
  outlet_id INT NULL,
  matched_by VARCHAR(10) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_hdoutlet_mapping_outlet (outlet_id)`;
export const HDOUTLET_EXPENSE_MAPPING_COLUMNS = `
  expense_key VARCHAR(60) NOT NULL PRIMARY KEY,
  expense_name VARCHAR(255) NOT NULL,
  status ENUM('pending','mapped','ignored') NOT NULL DEFAULT 'pending',
  account_code VARCHAR(10) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`;
export const HDOUTLET_REPORT_COLUMNS = `
  report_id INT NOT NULL PRIMARY KEY,
  report_date DATE NOT NULL,
  hd_outlet_name VARCHAR(255) NOT NULL,
  hd_outlet_id INT NULL,
  total_income DECIMAL(24,6) NOT NULL,
  total_loss DECIMAL(24,6) NOT NULL,
  total_expense DECIMAL(24,6) NOT NULL,
  expenses_json LONGTEXT NOT NULL,
  payload_json LONGTEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  deleted_at TIMESTAMP(3) NULL,
  first_synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_hdoutlet_reports_date (report_date),
  INDEX idx_hdoutlet_reports_outlet (hd_outlet_id)`;
export const HDOUTLET_SYNC_RUN_COLUMNS = `
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  trigger_type VARCHAR(10) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  status VARCHAR(10) NOT NULL,
  reports_fetched INT NOT NULL DEFAULT 0,
  entries_created INT NOT NULL DEFAULT 0,
  entries_updated INT NOT NULL DEFAULT 0,
  entries_voided INT NOT NULL DEFAULT 0,
  skipped_closed INT NOT NULL DEFAULT 0,
  message TEXT NULL,
  triggered_by INT NULL,
  INDEX idx_hdoutlet_sync_started (started_at)`;

// Fixed by the specification; Finance may still change them.
export const DEFAULT_EXPENSE_MAPPINGS: [key: string, name: string, accountCode: string][] = [['meal', 'Meal', 'LC04'], ['bonus', 'Bonus', 'LC03']];

type Query = { query: (sql: string, values?: unknown[]) => Promise<any> };
let schemaReady: Promise<void> | null = null;
export function ensureHdOutletSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await ensureFinanceTransactionSchema();
    const exists = async (table: string) => { try { await pool.query(`SELECT 1 FROM \`${table}\` LIMIT 1`); return true; } catch { return false; } };
    for (const [table, columns] of [['hdoutlet_outlet_mappings', HDOUTLET_OUTLET_MAPPING_COLUMNS], ['hdoutlet_expense_mappings', HDOUTLET_EXPENSE_MAPPING_COLUMNS],
      ['hdoutlet_reports', HDOUTLET_REPORT_COLUMNS], ['hdoutlet_sync_runs', HDOUTLET_SYNC_RUN_COLUMNS]] as const) {
      if (!await exists(table)) await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (${columns}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    const [matched] = await pool.query("SHOW COLUMNS FROM hdoutlet_outlet_mappings LIKE 'matched_by'");
    if (!(matched as any[]).length) await pool.query('ALTER TABLE hdoutlet_outlet_mappings ADD COLUMN matched_by VARCHAR(10) NULL AFTER outlet_id');
    await allowSharedOutlet('hdoutlet_outlet_mappings', 'uq_hdoutlet_mapping_outlet', 'idx_hdoutlet_mapping_outlet');
    await seedExpenseMappings(pool);
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}
// Several outlets of HD Outlet or HD Attendance may be booked to one Warehouse
// outlet (CSK 1 Cisalak and CSK 2 Cisalak into Cisalak). Tables made when each
// Warehouse outlet took one at most lose that unique key here.
export async function allowSharedOutlet(table: string, uniqueKey: string, plainKey: string) {
  const [unique] = await pool.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [uniqueKey]);
  if ((unique as any[]).length) await pool.query(`ALTER TABLE \`${table}\` DROP INDEX \`${uniqueKey}\`, ADD INDEX \`${plainKey}\` (outlet_id)`);
}
export async function seedExpenseMappings(executor: Query) {
  for (const [key, name, code] of DEFAULT_EXPENSE_MAPPINGS) {
    await executor.query("INSERT IGNORE INTO hdoutlet_expense_mappings (expense_key, expense_name, status, account_code) VALUES (?, ?, 'mapped', ?)", [key, name, code]);
  }
}

export type ExpenseMapping = { key: string; name: string; status: 'pending' | 'mapped' | 'ignored'; accountCode: string | null };
export type DerivedEntry = { sourceRef: string; accountCode: string; amount: string; notes: string };
// Pure: the ledger entries one report should have, and its expenses still unmapped.
export function deriveEntries(report: Pick<HdReport, 'id' | 'totalIncome' | 'totalLoss' | 'expenses'>, mappings: Map<string, ExpenseMapping>) {
  const entries: DerivedEntry[] = [], pending: { key: string; amount: string }[] = [];
  const positive = (amount: string) => decimal(money(decimal(amount))) > 0n;
  if (positive(report.totalIncome)) entries.push({ sourceRef: `hdo:${report.id}:SI`, accountCode: 'SI', amount: money(decimal(report.totalIncome)), notes: `Total pemasukan laporan harian HD Outlet #${report.id}` });
  if (positive(report.totalLoss)) entries.push({ sourceRef: `hdo:${report.id}:SH`, accountCode: 'SH', amount: money(decimal(report.totalLoss)), notes: `Total kerugian (loss sisa stok) laporan #${report.id}` });
  for (const [key, amount] of Object.entries(report.expenses).sort(([a], [b]) => a.localeCompare(b))) {
    if (!positive(amount)) continue;
    const mapping = mappings.get(key);
    if (mapping?.status === 'mapped' && mapping.accountCode) entries.push({ sourceRef: `hdo:${report.id}:exp:${key}`, accountCode: mapping.accountCode, amount: money(decimal(amount)), notes: `Pengeluaran ${mapping.name} · laporan #${report.id}` });
    else if (mapping?.status !== 'ignored') pending.push({ key, amount: money(decimal(amount)) });
  }
  return { entries, pending };
}

const toDecimal = (value: unknown) => money(decimal(String(value)));
async function expenseMappings(executor: Query) {
  const [rows] = await executor.query('SELECT expense_key AS `key`, expense_name AS name, status, account_code AS accountCode FROM hdoutlet_expense_mappings');
  return new Map<string, ExpenseMapping>((rows as any[]).map(r => [r.key, { key: r.key, name: r.name, status: r.status, accountCode: r.accountCode }]));
}

type Counts = { created: number; updated: number; voided: number; skippedClosed: number; closedDates: Set<string> };
// Brings one stored report's ledger entries in line with the report and the
// current mappings. Changes inside a closed period are skipped and counted.
async function rebuildReport(conn: Query, reportId: number, ctx: { outletOf: Map<number, number>; mappings: Map<string, ExpenseMapping>; accounts: Map<string, number>; closed: (day: string) => string | null; actorId: number | null }, counts: Counts) {
  const [reports] = await conn.query(`SELECT report_id AS id, DATE_FORMAT(report_date, '%Y-%m-%d') AS reportDate, hd_outlet_id AS hdOutletId,
    CAST(total_income AS CHAR) AS totalIncome, CAST(total_loss AS CHAR) AS totalLoss, expenses_json AS expenses, deleted_at AS deletedAt
    FROM hdoutlet_reports WHERE report_id = ? FOR UPDATE`, [reportId]);
  const report = (reports as any[])[0];
  const outletId = report && report.deletedAt == null && report.hdOutletId != null ? ctx.outletOf.get(Number(report.hdOutletId)) ?? null : null;
  const desired = outletId == null ? [] : deriveEntries({ id: reportId, totalIncome: report.totalIncome, totalLoss: report.totalLoss, expenses: JSON.parse(report.expenses) }, ctx.mappings).entries;
  const [rows] = await conn.query(`SELECT t.id, a.code AS accountCode, t.outlet_id AS outletId, DATE_FORMAT(t.transaction_date, '%Y-%m-%d') AS date,
    CAST(t.amount AS CHAR) AS amount, t.notes, t.status, t.version, t.source_ref AS sourceRef, t.idempotency_key AS idempotencyKey
    FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id
    WHERE t.source = 'hdoutlet' AND t.source_ref LIKE ? FOR UPDATE`, [`hdo:${reportId}:%`]);
  const existing = new Map<string, any>((rows as any[]).map(r => [r.sourceRef, r]));
  const audit = async (id: string, action: string, before: unknown, after: unknown) => conn.query(
    'INSERT INTO finance_transaction_audits (transaction_id, action, actor_id, occurred_at, reason, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, action, ctx.actorId ?? 0, new Date().toISOString(), `Sinkron HD Outlet laporan #${reportId}`, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
  const skip = (...days: string[]) => {
    const day = days.find(d => d && ctx.closed(d));
    if (!day) return false;
    counts.skippedClosed++; counts.closedDates.add(day); return true;
  };
  for (const entry of desired) {
    const accountId = ctx.accounts.get(entry.accountCode);
    if (!accountId) throw new Error(`Kode akun ${entry.accountCode} tidak ada di master akun.`);
    const after = { ...entry, date: report.reportDate, unit: { type: 'OUTLET', outletId }, status: 'posted', source: 'hdoutlet' };
    const before = existing.get(entry.sourceRef);
    if (!before) {
      // A report never synced before is added even inside a closed period:
      // closing freezes Warehouse stock and HPP, not outlet sales HD Outlet
      // reports late. What is already in the ledger stays frozen (below).
      const id = randomUUID();
      await conn.query(`INSERT INTO finance_transactions (id, account_id, unit_type, outlet_id, transaction_date, amount, notes, evidence_reference, status, nature,
        idempotency_key, version, source, source_ref, created_by) VALUES (?, ?, 'OUTLET', ?, ?, ?, ?, ?, 'posted', 'EXTERNAL', ?, 1, 'hdoutlet', ?, ?)`,
        [id, accountId, outletId, report.reportDate, entry.amount, entry.notes, `HDO-${reportId}`, entry.sourceRef, entry.sourceRef, ctx.actorId]);
      await audit(id, 'SYNC', null, after); counts.created++;
      continue;
    }
    const same = before.status === 'posted' && before.accountCode === entry.accountCode && Number(before.outletId) === outletId && before.date === report.reportDate && toDecimal(before.amount) === entry.amount && before.notes === entry.notes;
    if (same) continue;
    if (skip(before.date, report.reportDate)) continue;
    await conn.query(`UPDATE finance_transactions SET account_id = ?, unit_type = 'OUTLET', outlet_id = ?, transaction_date = ?, amount = ?, notes = ?, status = 'posted', version = version + 1 WHERE id = ?`,
      [accountId, outletId, report.reportDate, entry.amount, entry.notes, before.id]);
    await audit(before.id, 'SYNC', before, after); counts.updated++;
  }
  const wanted = new Set(desired.map(e => e.sourceRef));
  for (const [ref, before] of existing) {
    if (wanted.has(ref) || before.status !== 'posted') continue;
    if (skip(before.date)) continue;
    await conn.query("UPDATE finance_transactions SET status = 'void', version = version + 1 WHERE id = ?", [before.id]);
    await audit(before.id, 'SYNC', before, { ...before, status: 'void' }); counts.voided++;
  }
}

type RunInput = { trigger: 'manual' | 'schedule' | 'mapping'; startDate?: string | null; endDate?: string | null; actor?: { id: number; name?: string } | null };
async function startRun(input: RunInput) {
  const [result] = await pool.query("INSERT INTO hdoutlet_sync_runs (trigger_type, start_date, end_date, status, triggered_by) VALUES (?, ?, ?, 'running', ?)",
    [input.trigger, input.startDate ?? null, input.endDate ?? null, input.actor?.id ?? null]);
  return Number((result as any).insertId);
}
async function finishRun(id: number, status: string, fields: { fetched?: number; counts?: Counts; messages: string[] }) {
  const c = fields.counts;
  await pool.query(`UPDATE hdoutlet_sync_runs SET status = ?, finished_at = CURRENT_TIMESTAMP(3), reports_fetched = ?, entries_created = ?, entries_updated = ?,
    entries_voided = ?, skipped_closed = ?, message = ? WHERE id = ?`,
    [status, fields.fetched ?? 0, c?.created ?? 0, c?.updated ?? 0, c?.voided ?? 0, c?.skippedClosed ?? 0, fields.messages.join('\n').slice(0, 60000) || null, id]);
}

// Rebuilds the entries of the given stored reports in one database transaction.
async function rebuild(reportIds: number[], actorId: number | null, counts: Counts) {
  if (!reportIds.length) return;
  const closed = await closedPeriodChecker();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [mapRows] = await connection.query('SELECT hd_outlet_id AS hdOutletId, outlet_id AS outletId FROM hdoutlet_outlet_mappings WHERE outlet_id IS NOT NULL');
    const [accountRows] = await connection.query('SELECT id, code FROM finance_accounts');
    const ctx = {
      outletOf: new Map<number, number>((mapRows as any[]).map(r => [Number(r.hdOutletId), Number(r.outletId)])),
      mappings: await expenseMappings(connection), accounts: new Map<string, number>((accountRows as any[]).map(r => [r.code, Number(r.id)])),
      closed, actorId,
    };
    for (const id of [...new Set(reportIds)].sort((a, b) => a - b)) await rebuildReport(connection, id, ctx, counts);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}
const newCounts = (): Counts => ({ created: 0, updated: 0, voided: 0, skippedClosed: 0, closedDates: new Set() });
const closedMessage = (counts: Counts) => counts.skippedClosed
  ? [`${counts.skippedClosed} perubahan tidak diterapkan karena tanggalnya di periode yang sudah ditutup (${[...counts.closedDates].sort().join(', ')}).`] : [];

// Outlet names compared without case, spaces, punctuation or a parenthesised
// code: "RiaBusana" = "Ria Busana", "Central Kitchen (CK)" = "Central Kitchen".
const nameKey = (name: unknown) => String(name ?? '').replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/[^a-z0-9]/g, '');
// HD Outlet names often start with a short outlet code ("CTG Cieunteung",
// "CK Central Kitchen"): the name without it is tried as well.
const withoutCode = (name: string) => { const m = /^\s*[A-Z]{2,4}\s+(.+)$/.exec(name); return m ? m[1] : null; };

// Two names for the same outlet, either possibly with its code in front.
export function sameOutletName(a: string, b: string): boolean {
  const keys = (name: string) => [name, withoutCode(name)].filter(Boolean).map(nameKey).filter(Boolean);
  const other = keys(b);
  return keys(a).some(key => other.includes(key));
}

// The Warehouse outlet an HD Outlet outlet name stands for, or null when no
// Warehouse outlet, or more than one, fits (e.g. "TMS TamanSari" against both
// "Taman Sari" and "Tamansari"): an ambiguous name is never guessed.
export function matchOutletName(hdName: string, outlets: { id: number; name: string }[]): number | null {
  for (const candidate of [hdName, withoutCode(hdName)]) {
    if (!candidate || !nameKey(candidate)) continue;
    const hits = outlets.filter(o => nameKey(o.name) === nameKey(candidate));
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) return null;
  }
  return null;
}

// A new HD Outlet outlet is paired with the one Warehouse outlet its name
// stands for (matchOutletName), when that outlet is not paired yet and no other
// HD Outlet outlet claims it. matched_by 'auto' marks it for Finance to check
// in Pengaturan Finance; a pairing Finance set or cleared ('finance') is never
// touched again.
export async function autoMatchOutlets(executor: Query = pool) {
  const [rows] = await executor.query('SELECT hd_outlet_id AS hdOutletId, hd_outlet_name AS name FROM hdoutlet_outlet_mappings WHERE outlet_id IS NULL AND matched_by IS NULL');
  if (!(rows as any[]).length) return 0;
  const [outletRows] = await executor.query('SELECT id, outlet_name AS name FROM outlets WHERE is_active = 1');
  const outlets = (outletRows as any[]).map(o => ({ id: Number(o.id), name: String(o.name) }));
  const [taken] = await executor.query('SELECT outlet_id AS outletId FROM hdoutlet_outlet_mappings WHERE outlet_id IS NOT NULL');
  const used = new Set((taken as any[]).map(r => Number(r.outletId)));
  const proposals = (rows as any[]).map(r => ({ hdOutletId: Number(r.hdOutletId), outletId: matchOutletName(String(r.name), outlets) }));
  const claims = new Map<number, number>();
  for (const p of proposals) if (p.outletId !== null) claims.set(p.outletId, (claims.get(p.outletId) ?? 0) + 1);
  let paired = 0;
  for (const p of proposals) {
    if (p.outletId === null || claims.get(p.outletId) !== 1 || used.has(p.outletId)) continue;
    await executor.query("UPDATE hdoutlet_outlet_mappings SET outlet_id = ?, matched_by = 'auto' WHERE hd_outlet_id = ? AND outlet_id IS NULL", [p.outletId, p.hdOutletId]);
    used.add(p.outletId); paired++;
  }
  return paired;
}

let running: Promise<unknown> | null = null;
export type SyncResult = { runId: number; status: 'success' | 'partial' | 'failed'; reportsFetched: number; created: number; updated: number; voided: number; skippedClosed: number; messages: string[] };

// Fetches the reports of the period, stores them and rebuilds their entries.
// If HD Outlet cannot be reached the stored data stays as it was.
export async function syncHdOutlet(input: { startDate: string; endDate: string; trigger: 'manual' | 'schedule'; actor?: { id: number; name?: string } | null; client?: HdOutletClient; config?: HdOutletConfig }): Promise<SyncResult> {
  if (running) throw new HdOutletError('BUSY', 'Sinkron HD Outlet sedang berjalan. Tunggu sampai selesai.');
  const task = (async () => {
    await ensureHdOutletSchema();
    // One sync at a time across every backend host (PM2 runs two).
    const lock = await pool.getConnection();
    const [[got]] = await lock.query("SELECT GET_LOCK('hdoutlet_sync', 0) AS got") as any;
    if (Number(got?.got) !== 1) { lock.release(); throw new HdOutletError('BUSY', 'Sinkron HD Outlet sedang berjalan di server lain. Tunggu sampai selesai.'); }
    try { return await runSync(input); }
    finally { await lock.query("SELECT RELEASE_LOCK('hdoutlet_sync')").catch(() => {}); lock.release(); }
  })();
  running = task;
  try { return await task; } finally { running = null; }
}

async function runSync(input: Parameters<typeof syncHdOutlet>[0]): Promise<SyncResult> {
  {
    const runId = await startRun(input);
    const counts = newCounts(), messages: string[] = [];
    let fetched = 0;
    try {
      const config = input.config ?? hdOutletConfig();
      if (!input.client && !config.enabled) throw new HdOutletError('DISABLED', 'Integrasi HD Outlet nonaktif (OUTLET_FINANCE_API_ENABLED bukan true).');
      const client = input.client ?? new HdOutletClient(config.baseUrl, config.apiKey, config.timeoutMs);
      const [outlets, categories, result] = await Promise.all([client.outlets(), client.expenseCategories().catch(() => null), client.reports(input.startDate, input.endDate)]);
      fetched = result.reports.length;
      messages.push(...result.errors);
      if (!categories) messages.push('Nama kategori pengeluaran HD Outlet tidak terbaca; kunci pengeluaran dipakai sebagai nama.');
      const names = new Map<string, string>((categories ?? []).map(c => [c.key, c.name]));
      for (const outlet of outlets) {
        await pool.query('INSERT INTO hdoutlet_outlet_mappings (hd_outlet_id, hd_outlet_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE hd_outlet_name = VALUES(hd_outlet_name)', [outlet.id, outlet.name]);
      }
      await autoMatchOutlets();
      for (const [key, name] of names) {
        await pool.query('INSERT INTO hdoutlet_expense_mappings (expense_key, expense_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE expense_name = VALUES(expense_name)', [key, name.slice(0, 255)]);
      }
      // HD Outlet reports name their outlet; its id comes from HD Outlet's own
      // outlet list (same name, with or without its code: a report of
      // "Cigeureung" belongs to "CGR Cigeureung"). The Warehouse outlet only
      // ever comes from the mapping table.
      for (const report of result.reports) {
        const hits = outlets.filter(o => sameOutletName(o.name, report.outletName));
        const hdOutletId = hits.length === 1 ? hits[0].id : hits.length ? -1 : undefined;
        if (hdOutletId === undefined || hdOutletId < 0) messages.push(`Laporan #${report.id}: outlet "${report.outletName}" tidak ada (atau ganda) di daftar outlet HD Outlet.`);
        for (const key of Object.keys(report.expenses)) {
          await pool.query('INSERT IGNORE INTO hdoutlet_expense_mappings (expense_key, expense_name) VALUES (?, ?)', [key, (names.get(key) ?? key).slice(0, 255)]);
        }
        const payload = JSON.stringify(report.payload);
        await pool.query(`INSERT INTO hdoutlet_reports (report_id, report_date, hd_outlet_name, hd_outlet_id, total_income, total_loss, total_expense, expenses_json, payload_json, payload_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE report_date = VALUES(report_date), hd_outlet_name = VALUES(hd_outlet_name), hd_outlet_id = VALUES(hd_outlet_id),
          total_income = VALUES(total_income), total_loss = VALUES(total_loss), total_expense = VALUES(total_expense), expenses_json = VALUES(expenses_json),
          payload_json = VALUES(payload_json), payload_hash = VALUES(payload_hash), deleted_at = NULL, last_synced_at = CURRENT_TIMESTAMP(3)`,
          [report.id, report.reportDate, report.outletName, hdOutletId !== undefined && hdOutletId > 0 ? hdOutletId : null, report.totalIncome, report.totalLoss, report.totalExpense,
            JSON.stringify(report.expenses), payload, createHash('sha256').update(payload).digest('hex')]);
      }
      // A report removed in HD Outlet is removed here too, but only when every
      // report of the period was read: an unreadable one might be the "missing" one.
      const touched = result.reports.map(r => r.id);
      if (!result.errors.length) {
        const [gone] = await pool.query(`SELECT report_id AS id FROM hdoutlet_reports WHERE report_date BETWEEN ? AND ? AND deleted_at IS NULL${touched.length ? ` AND report_id NOT IN (${touched.map(() => '?').join(',')})` : ''}`,
          [input.startDate, input.endDate, ...touched]);
        const ids = (gone as any[]).map(r => Number(r.id));
        if (ids.length) {
          await pool.query(`UPDATE hdoutlet_reports SET deleted_at = CURRENT_TIMESTAMP(3) WHERE report_id IN (${ids.map(() => '?').join(',')})`, ids);
          touched.push(...ids);
          messages.push(`${ids.length} laporan tidak lagi ada di HD Outlet; entrinya dihapus.`);
        }
      }
      await rebuild(touched, input.actor?.id ?? null, counts);
      messages.push(...closedMessage(counts));
      const status = result.errors.length || counts.skippedClosed ? 'partial' : 'success';
      await finishRun(runId, status, { fetched, counts, messages });
      return { runId, status, reportsFetched: fetched, created: counts.created, updated: counts.updated, voided: counts.voided, skippedClosed: counts.skippedClosed, messages } as SyncResult;
    } catch (error) {
      const message = error instanceof HdOutletError ? error.message : `Sinkron gagal: ${error instanceof Error ? error.message : 'kesalahan tidak dikenal'}`;
      await finishRun(runId, 'failed', { fetched, messages: [message, ...messages] }).catch(() => {});
      return { runId, status: 'failed', reportsFetched: fetched, created: 0, updated: 0, voided: 0, skippedClosed: 0, messages: [message, ...messages] } as SyncResult;
    }
  }
}

// After a mapping change: rebuild the stored reports it concerns, without
// calling HD Outlet. Logged as a sync run with trigger 'mapping'.
async function rebuildStored(where: string, params: unknown[], actor: { id: number; name?: string }) {
  const runId = await startRun({ trigger: 'mapping', actor });
  const counts = newCounts();
  try {
    const [rows] = await pool.query(`SELECT report_id AS id FROM hdoutlet_reports WHERE ${where}`, params);
    await rebuild((rows as any[]).map(r => Number(r.id)), actor.id, counts);
    const messages = closedMessage(counts);
    await finishRun(runId, counts.skippedClosed ? 'partial' : 'success', { fetched: (rows as any[]).length, counts, messages });
    return { created: counts.created, updated: counts.updated, voided: counts.voided, skippedClosed: counts.skippedClosed, messages };
  } catch (error) {
    await finishRun(runId, 'failed', { messages: [error instanceof Error ? error.message : 'Gagal menerapkan mapping'] }).catch(() => {});
    throw error;
  }
}

export class MappingError extends Error {}
export async function setOutletMapping(hdOutletId: number, outletId: number | null, actor: { id: number; name?: string }) {
  await ensureHdOutletSchema();
  const [found] = await pool.query('SELECT hd_outlet_name AS name, outlet_id AS outletId FROM hdoutlet_outlet_mappings WHERE hd_outlet_id = ?', [hdOutletId]);
  const before = (found as any[])[0];
  if (!before) throw new MappingError('Outlet HD Outlet tidak dikenal. Jalankan sinkron dulu.');
  if (outletId !== null) {
    const [outlets] = await pool.query('SELECT id FROM outlets WHERE id = ? AND is_active = 1', [outletId]);
    if (!(outlets as any[]).length) throw new MappingError('Outlet Warehouse tidak ditemukan atau nonaktif.');
  }
  await pool.query("UPDATE hdoutlet_outlet_mappings SET outlet_id = ?, matched_by = 'finance', updated_by = ? WHERE hd_outlet_id = ?", [outletId, actor.id, hdOutletId]);
  await logAdminActivity({ actorId: actor.id, actorName: actor.name || `user#${actor.id}`, action: 'FINANCE_HDOUTLET_OUTLET_MAPPING', targetType: 'hdoutlet_outlet', targetId: hdOutletId, details: { hdOutletName: before.name, before: before.outletId, after: outletId } }).catch(() => {});
  return rebuildStored('hd_outlet_id = ?', [hdOutletId], actor);
}

export async function setExpenseMapping(key: string, input: { status?: unknown; accountCode?: unknown }, actor: { id: number; name?: string }) {
  await ensureHdOutletSchema();
  const [found] = await pool.query('SELECT expense_name AS name, status, account_code AS accountCode FROM hdoutlet_expense_mappings WHERE expense_key = ?', [key]);
  const before = (found as any[])[0];
  if (!before) throw new MappingError('Jenis pengeluaran tidak dikenal.');
  const status = input.status;
  if (status !== 'mapped' && status !== 'ignored' && status !== 'pending') throw new MappingError('Status mapping tidak valid.');
  let accountCode: string | null = null;
  if (status === 'mapped') {
    accountCode = String(input.accountCode ?? '');
    const [accounts] = await pool.query('SELECT group_code AS groupCode, is_active AS isActive FROM finance_accounts WHERE code = ?', [accountCode]);
    const account = (accounts as any[])[0];
    if (!account || Number(account.isActive) !== 1 || !ACCOUNT_GROUPS[account.groupCode]) throw new MappingError('Pilih kode akun yang aktif.');
  }
  await pool.query('UPDATE hdoutlet_expense_mappings SET status = ?, account_code = ?, updated_by = ? WHERE expense_key = ?', [status, accountCode, actor.id, key]);
  await logAdminActivity({ actorId: actor.id, actorName: actor.name || `user#${actor.id}`, action: 'FINANCE_HDOUTLET_EXPENSE_MAPPING', targetType: 'hdoutlet_expense', targetId: key, details: { name: before.name, before: { status: before.status, accountCode: before.accountCode }, after: { status, accountCode } } }).catch(() => {});
  return rebuildStored('JSON_EXTRACT(expenses_json, ?) IS NOT NULL', [`$."${key}"`], actor);
}

// Lists for the Finance settings page.
export async function hdOutletOverview(config: HdOutletConfig = hdOutletConfig()) {
  await ensureHdOutletSchema();
  let base: string | null = null;
  try { base = config.baseUrl ? new URL(config.baseUrl).origin : null; } catch { base = null; }
  const [outlets] = await pool.query(`SELECT m.hd_outlet_id AS hdOutletId, m.hd_outlet_name AS hdOutletName, m.outlet_id AS outletId, o.outlet_name AS outletName, m.matched_by AS matchedBy,
    (SELECT COUNT(*) FROM hdoutlet_reports r WHERE r.hd_outlet_id = m.hd_outlet_id AND r.deleted_at IS NULL) AS reportCount
    FROM hdoutlet_outlet_mappings m LEFT JOIN outlets o ON o.id = m.outlet_id ORDER BY m.hd_outlet_name`);
  const [expenseRows] = await pool.query('SELECT expense_key AS `key`, expense_name AS name, status, account_code AS accountCode FROM hdoutlet_expense_mappings ORDER BY status = \'pending\' DESC, expense_name');
  const [reports] = await pool.query('SELECT expenses_json AS expenses FROM hdoutlet_reports WHERE deleted_at IS NULL');
  const totals = new Map<string, { count: number; amount: bigint }>();
  for (const r of reports as any[]) for (const [key, amount] of Object.entries(JSON.parse(r.expenses) as Record<string, string>)) {
    if (decimal(money(decimal(amount))) <= 0n) continue;
    const t = totals.get(key) ?? { count: 0, amount: 0n }; t.count++; t.amount += decimal(money(decimal(amount))); totals.set(key, t);
  }
  const [unmappedReports] = await pool.query(`SELECT r.hd_outlet_name AS name, COUNT(*) AS count FROM hdoutlet_reports r
    LEFT JOIN hdoutlet_outlet_mappings m ON m.hd_outlet_id = r.hd_outlet_id WHERE r.deleted_at IS NULL AND (r.hd_outlet_id IS NULL OR m.outlet_id IS NULL) GROUP BY r.hd_outlet_name`);
  const [runs] = await pool.query(`SELECT id, trigger_type AS triggerType, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate,
    CAST(ROUND(UNIX_TIMESTAMP(started_at) * 1000) AS CHAR) AS startedMs, CAST(ROUND(UNIX_TIMESTAMP(finished_at) * 1000) AS CHAR) AS finishedMs, status,
    reports_fetched AS reportsFetched, entries_created AS created, entries_updated AS updated,
    entries_voided AS voided, skipped_closed AS skippedClosed, message FROM hdoutlet_sync_runs ORDER BY id DESC LIMIT 30`);
  return {
    config: { enabled: config.enabled, host: base, keyConfigured: Boolean(config.apiKey), syncHour: config.syncHour, syncDays: config.syncDays },
    outlets: (outlets as any[]).map(r => ({ hdOutletId: Number(r.hdOutletId), hdOutletName: r.hdOutletName, outletId: r.outletId == null ? null : Number(r.outletId), outletName: r.outletName ?? null, matchedBy: r.matchedBy ?? null, reportCount: Number(r.reportCount) })),
    expenses: (expenseRows as any[]).map(r => ({ key: r.key, name: r.name, status: r.status, accountCode: r.accountCode, reportCount: totals.get(r.key)?.count ?? 0, amount: money(totals.get(r.key)?.amount ?? 0n) })),
    unmappedReports: (unmappedReports as any[]).map(r => ({ name: r.name, count: Number(r.count) })),
    runs: (runs as any[]).map(({ startedMs, finishedMs, ...r }) => ({ ...r, id: Number(r.id), reportsFetched: Number(r.reportsFetched), created: Number(r.created), updated: Number(r.updated), voided: Number(r.voided), skippedClosed: Number(r.skippedClosed),
      startedAt: new Date(Number(startedMs)).toISOString(), finishedAt: finishedMs == null ? null : new Date(Number(finishedMs)).toISOString() })),
  };
}

// Nightly sync of the last `syncDays` days at `syncHour` (Asia/Jakarta).
// Re-running is harmless (upsert), so a restart inside the hour only repeats it.
export function startHdOutletScheduler(config: HdOutletConfig = hdOutletConfig(), now = () => new Date()) {
  if (!config.enabled) return null;
  let lastDay = '';
  const tick = async () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now()).map(p => [p.type, p.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) !== config.syncHour || lastDay === today || running) return;
    lastDay = today;
    const start = new Date(Date.parse(`${today}T00:00:00Z`) - config.syncDays * 86400000).toISOString().slice(0, 10);
    const result = await syncHdOutlet({ startDate: start, endDate: today, trigger: 'schedule', config }).catch(error => ({ status: 'failed', messages: [String(error?.message ?? error)] }));
    if (result.status !== 'success') console.warn('[hd-outlet-sync]', result.status, result.messages.join(' | '));
  };
  const timer = setInterval(() => { void tick(); }, 5 * 60 * 1000);
  timer.unref();
  // First start with the integration on: nothing has ever been synced, so pull
  // the current month at once instead of waiting for the night.
  const first = setTimeout(() => { void initialSync(config, now).catch(error => console.warn('[hd-outlet-sync] initial', String(error?.message ?? error))); }, 20_000);
  first.unref();
  return () => { clearInterval(timer); clearTimeout(first); };
}

// Syncs from the 1st of the current month (Asia/Jakarta) to today, only when no
// sync has ever succeeded. Both PM2 hosts may try; the sync lock lets one run.
export async function initialSync(config: HdOutletConfig = hdOutletConfig(), now = () => new Date()) {
  await ensureHdOutletSchema();
  const [done] = await pool.query("SELECT id FROM hdoutlet_sync_runs WHERE trigger_type <> 'mapping' AND status IN ('success', 'partial') LIMIT 1");
  if ((done as any[]).length || running) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
  const result = await syncHdOutlet({ startDate: `${today.slice(0, 8)}01`, endDate: today, trigger: 'schedule', config })
    .catch(error => ({ status: 'failed', messages: [String(error?.message ?? error)] }));
  console.log('[hd-outlet-sync] initial', result.status, result.messages.join(' | '));
  return result;
}
