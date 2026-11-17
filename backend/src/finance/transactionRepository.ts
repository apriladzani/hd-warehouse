import { pool } from '../db/index.ts';
import { closedPeriodChecker, logAdminActivity } from '../db/repository.ts';
import { FINANCE_ACCOUNT_COLUMNS, migrateFinanceAccounts, seedFinanceAccounts } from './accounts.ts';
import { ACCOUNT_GROUPS, validateTransaction } from './validation.ts';
import type { Filter, Unit } from './domain.ts';
import { TransactionRuleError, type AuditPlan, type TransactionRecord } from './transactionPlan.ts';
import type { TransactionRepository, TransactionChange } from './transactionApi.ts';

export { FINANCE_ACCOUNT_COLUMNS, seedFinanceAccounts };

// Finance ledger, one row per amount booked to a unit (Warehouse or an outlet),
// date and account code. Rows typed in by Finance have source 'manual'; rows
// synced from HD Outlet daily reports have source 'hdoutlet' and a source_ref
// (hdo:<report id>:<component>); salaries from HD Attendance have source
// 'hdattendance' (hda:<outlet>:<date>:LC01). The source_ref makes a re-sync an
// update, never a duplicate.
// Only status 'posted' counts in reports; 'void' is a soft delete.
export const FINANCE_TRANSACTION_COLUMNS = `
  id CHAR(36) NOT NULL PRIMARY KEY,
  account_id INT NOT NULL,
  unit_type ENUM('WAREHOUSE','OUTLET') NOT NULL,
  outlet_id INT NULL,
  transaction_date DATE NOT NULL,
  amount DECIMAL(24,6) NOT NULL,
  notes VARCHAR(500) NOT NULL,
  evidence_reference VARCHAR(255) NOT NULL,
  status ENUM('draft','posted','void') NOT NULL,
  nature ENUM('INTERNAL','EXTERNAL') NOT NULL,
  counterparty_type ENUM('WAREHOUSE','OUTLET') NULL,
  counterparty_outlet_id INT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  legacy_entry_id VARCHAR(20) NULL,
  version INT NOT NULL,
  source ENUM('manual','hdoutlet','hdattendance') NOT NULL DEFAULT 'manual',
  source_ref VARCHAR(120) NULL,
  attachment_path VARCHAR(80) NULL,
  created_by INT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_finance_transaction_idempotency (idempotency_key),
  UNIQUE KEY uq_finance_transaction_source_ref (source_ref),
  INDEX idx_finance_transaction_date (transaction_date),
  INDEX idx_finance_transaction_outlet (outlet_id),
  INDEX idx_finance_transaction_account (account_id)`;

export const FINANCE_TRANSACTION_AUDIT_COLUMNS = `
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  transaction_id CHAR(36) NOT NULL,
  action VARCHAR(10) NOT NULL,
  actor_id INT NOT NULL,
  occurred_at VARCHAR(30) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  before_json LONGTEXT NULL,
  after_json LONGTEXT NOT NULL,
  INDEX idx_finance_audit_transaction (transaction_id)`;

type Query = { query: (sql: string, values?: unknown[]) => Promise<any> };
// Columns added after the first release, for ledgers created before them.
export async function migrateFinanceTransactions(executor: Query) {
  const [columns] = await executor.query('SHOW COLUMNS FROM finance_transactions');
  const present = new Set((columns as any[]).map(c => c.Field));
  if (!present.has('source')) await executor.query("ALTER TABLE finance_transactions ADD COLUMN source ENUM('manual','hdoutlet','hdattendance') NOT NULL DEFAULT 'manual' AFTER version");
  else if (!String((columns as any[]).find(c => c.Field === 'source')?.Type ?? '').includes("'hdattendance'")) {
    // Adding an enum value keeps every existing row as it is.
    await executor.query("ALTER TABLE finance_transactions MODIFY COLUMN source ENUM('manual','hdoutlet','hdattendance') NOT NULL DEFAULT 'manual'");
  }
  if (!present.has('source_ref')) await executor.query('ALTER TABLE finance_transactions ADD COLUMN source_ref VARCHAR(120) NULL AFTER source');
  if (!present.has('attachment_path')) await executor.query('ALTER TABLE finance_transactions ADD COLUMN attachment_path VARCHAR(80) NULL AFTER source_ref');
  const [index] = await executor.query("SHOW INDEX FROM finance_transactions WHERE Key_name = 'uq_finance_transaction_source_ref'");
  if (!(index as any[]).length) await executor.query('ALTER TABLE finance_transactions ADD UNIQUE KEY uq_finance_transaction_source_ref (source_ref)');
}

let schemaReady: Promise<void> | null = null;
// Creates missing tables and columns; existing rows are untouched.
export function ensureFinanceTransactionSchema() {
  if (!schemaReady) schemaReady = (async () => {
    const exists = async (table: string) => {
      try { await pool.query(`SELECT 1 FROM \`${table}\` LIMIT 1`); return true; } catch { return false; }
    };
    if (!await exists('finance_accounts')) {
      await pool.query(`CREATE TABLE IF NOT EXISTS finance_accounts (${FINANCE_ACCOUNT_COLUMNS}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    await migrateFinanceAccounts(pool);
    if (!await exists('finance_transactions')) {
      await pool.query(`CREATE TABLE IF NOT EXISTS finance_transactions (${FINANCE_TRANSACTION_COLUMNS},
        CONSTRAINT fk_finance_transaction_account FOREIGN KEY (account_id) REFERENCES finance_accounts (id),
        CONSTRAINT fk_finance_transaction_outlet FOREIGN KEY (outlet_id) REFERENCES outlets (id),
        CONSTRAINT fk_finance_transaction_counterparty FOREIGN KEY (counterparty_outlet_id) REFERENCES outlets (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    await migrateFinanceTransactions(pool);
    if (!await exists('finance_transaction_audits')) {
      await pool.query(`CREATE TABLE IF NOT EXISTS finance_transaction_audits (${FINANCE_TRANSACTION_AUDIT_COLUMNS}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    await seedFinanceAccounts(pool);
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

export const SELECT_RECORD = `SELECT t.id, a.code AS accountCode, t.unit_type AS unitType, t.outlet_id AS outletId,
  DATE_FORMAT(t.transaction_date, '%Y-%m-%d') AS date, CAST(t.amount AS CHAR) AS amount, t.notes, t.evidence_reference AS reference,
  t.status, t.nature, t.counterparty_type AS counterpartyType, t.counterparty_outlet_id AS counterpartyOutletId,
  t.idempotency_key AS idempotencyKey, t.legacy_entry_id AS legacyEntryId, t.version,
  t.source, t.source_ref AS sourceRef, t.attachment_path AS attachment
  FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id`;

const unitOf = (type: unknown, outletId: unknown): Unit | null =>
  type === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : type === 'OUTLET' ? { type: 'OUTLET', outletId: Number(outletId) } : null;

export function toRecord(row: any): TransactionRecord {
  return {
    ...validateTransaction({
      date: row.date, unit: unitOf(row.unitType, row.outletId), accountCode: row.accountCode, amount: row.amount,
      notes: row.notes, reference: row.reference, status: row.status, nature: row.nature,
      counterparty: unitOf(row.counterpartyType, row.counterpartyOutletId), idempotencyKey: row.idempotencyKey,
      legacyEntryId: row.legacyEntryId ?? null, version: Number(row.version),
      source: row.source ?? 'manual', sourceRef: row.sourceRef ?? null, attachment: row.attachment ?? null,
    }),
    id: String(row.id),
  };
}

// 409 for a closed period, 400 for anything else the rules refuse.
export class LedgerConflictError extends TransactionRuleError { status = 409 as const; }

export function createFinanceTransactionRepository(options: { periodCheck?: () => Promise<(day: string) => string | null> } = {}): TransactionRepository {
  const periodCheck = options.periodCheck ?? (() => closedPeriodChecker());
  return {
    async list(filter: Filter) {
      await ensureFinanceTransactionSchema();
      const conditions = ['t.transaction_date >= ?', 't.transaction_date <= ?'];
      const params: unknown[] = [filter.startDate, filter.endDate];
      if (filter.mode === 'WAREHOUSE') conditions.push("t.unit_type = 'WAREHOUSE'");
      if (filter.mode === 'OUTLET') conditions.push("t.unit_type = 'OUTLET'");
      if (filter.outletIds?.length) {
        conditions.push(`(t.unit_type = 'WAREHOUSE' OR t.outlet_id IN (${filter.outletIds.map(() => '?').join(',')}))`);
        params.push(...filter.outletIds);
      }
      const [rows] = await pool.query(`${SELECT_RECORD} WHERE ${conditions.join(' AND ')} ORDER BY t.transaction_date DESC, t.created_at DESC`, params);
      return (rows as any[]).map(toRecord);
    },

    async change(id, expectedVersion, plan, actor) {
      return (await this.changeMany([{ id, expectedVersion, plan }], actor))[0];
    },

    // All or nothing: a batch of new entries is saved only if every row is valid.
    async changeMany(changes: TransactionChange[], actor) {
      await ensureFinanceTransactionSchema();
      const closedLabel = await periodCheck();
      const connection = await pool.getConnection();
      const audits: AuditPlan[] = [];
      const records: TransactionRecord[] = [];
      try {
        await connection.beginTransaction();
        for (const [index, change] of changes.entries()) {
          const row = changes.length > 1 ? `Baris ${index + 1}: ` : '';
          const [found] = await connection.query(`${SELECT_RECORD} WHERE t.id = ? FOR UPDATE`, [change.id]);
          const before = (found as any[]).length ? toRecord((found as any[])[0]) : null;
          if (change.expectedVersion === null ? before !== null : before?.version !== change.expectedVersion) throw new LedgerConflictError(`${row}Data sudah diubah orang lain. Muat ulang lalu coba lagi.`);
          const { record, audit } = change.plan(before);
          for (const day of new Set([record.date, before?.date].filter(Boolean) as string[])) {
            const closed = closedLabel(day);
            if (closed) throw new LedgerConflictError(`${row}${closed} sudah ditutup. Entri tanggal ${day} tidak dapat ditambah, diubah, atau dihapus.`);
          }
          const [accounts] = await connection.query('SELECT id, group_code AS groupCode, is_active AS isActive FROM finance_accounts WHERE code = ? LIMIT 1', [record.accountCode]);
          const account = (accounts as any[])[0];
          if (!account) throw new TransactionRuleError(`${row}Kode akun ${record.accountCode} tidak dikenal.`);
          const accountChanged = !before || before.accountCode !== record.accountCode;
          if (accountChanged && (Number(account.isActive) !== 1 || !ACCOUNT_GROUPS[account.groupCode]?.manual)) throw new TransactionRuleError(`${row}Kode akun ${record.accountCode} tidak aktif atau tidak untuk input manual.`);
          if (!before || JSON.stringify(before.unit) !== JSON.stringify(record.unit)) {
            for (const unit of [record.unit, record.counterparty]) {
              if (unit?.type !== 'OUTLET') continue;
              const [outlets] = await connection.query('SELECT id FROM outlets WHERE id = ? AND is_active = 1 LIMIT 1', [unit.outletId]);
              if (!(outlets as any[]).length) throw new TransactionRuleError(`${row}Outlet tidak ditemukan atau nonaktif.`);
            }
          }
          if (!before) {
            const [duplicate] = await connection.query('SELECT id FROM finance_transactions WHERE idempotency_key = ? LIMIT 1', [record.idempotencyKey]);
            if ((duplicate as any[]).length) throw new LedgerConflictError(`${row}Entri ini sudah tersimpan.`);
            await connection.query(`INSERT INTO finance_transactions (id, account_id, unit_type, outlet_id, transaction_date, amount, notes, evidence_reference,
              status, nature, counterparty_type, counterparty_outlet_id, idempotency_key, legacy_entry_id, version, source, source_ref, attachment_path, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
              record.id, Number(account.id), record.unit.type, record.unit.type === 'OUTLET' ? record.unit.outletId : null, record.date, record.amount,
              record.notes, record.reference, record.status, record.nature, record.counterparty?.type ?? null,
              record.counterparty?.type === 'OUTLET' ? record.counterparty.outletId : null, record.idempotencyKey, record.legacyEntryId,
              record.version, record.source, record.sourceRef, record.attachment, audit.actorId,
            ]);
          } else {
            const [result] = await connection.query(`UPDATE finance_transactions SET account_id = ?, unit_type = ?, outlet_id = ?, transaction_date = ?, amount = ?,
              notes = ?, evidence_reference = ?, attachment_path = ?, status = ?, version = ? WHERE id = ? AND version = ?`, [
              Number(account.id), record.unit.type, record.unit.type === 'OUTLET' ? record.unit.outletId : null, record.date, record.amount,
              record.notes, record.reference, record.attachment, record.status, record.version, record.id, before.version,
            ]);
            if ((result as any).affectedRows !== 1) throw new LedgerConflictError(`${row}Data sudah diubah orang lain. Muat ulang lalu coba lagi.`);
          }
          await connection.query(`INSERT INTO finance_transaction_audits (transaction_id, action, actor_id, occurred_at, reason, before_json, after_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, [audit.entityId, audit.action, audit.actorId, audit.occurredAt, audit.reason,
            audit.before ? JSON.stringify(audit.before) : null, JSON.stringify(audit.after)]);
          audits.push(audit); records.push(record);
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
      // The ledger audit is authoritative; the activity log is the shared trail.
      for (const audit of audits) {
        await logAdminActivity({
          actorId: audit.actorId, actorName: actor?.name || `user#${audit.actorId}`, action: `FINANCE_ENTRY_${audit.action}`,
          targetType: 'finance_transaction', targetId: audit.entityId,
          details: { reason: audit.reason, accountCode: audit.after.accountCode, amount: audit.after.amount, date: audit.after.date, unit: audit.after.unit, before: audit.before && { accountCode: audit.before.accountCode, amount: audit.before.amount, date: audit.before.date, unit: audit.before.unit } },
        }).catch(() => {});
      }
      return records;
    },
  };
}
