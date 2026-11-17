import { pool } from '../db/index.ts';
import { ACCOUNTS, validateTransaction } from './validation.ts';
import type { Filter, Unit } from './domain.ts';
import type { TransactionRecord } from './transactionPlan.ts';
import type { TransactionRepository } from './transactionApi.ts';

// Finance ledger: what Finance types in (Labor Cost, Utilities, Rent, DA...),
// per unit (Warehouse or one outlet). WarehouseFinanceDataSource reads the
// POSTED rows of finance_transactions joined to finance_accounts as facts.
// Draft → posted → void; posted financial fields never change, every change is
// versioned and audited in the same database transaction.

export const FINANCE_ACCOUNT_COLUMNS = `
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL,
  metric VARCHAR(10) NOT NULL,
  UNIQUE KEY uq_finance_account_code (code)`;

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
  created_by INT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_finance_transaction_idempotency (idempotency_key),
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

const ACCOUNT_ROWS = Object.entries(ACCOUNTS).map(([code, [name, metric]]) => [code, name, metric]);

// The chart of accounts is code-defined; new codes are added, existing rows kept.
export async function seedFinanceAccounts(executor: { query: (sql: string, values: unknown[]) => Promise<unknown> }) {
  await executor.query(`INSERT IGNORE INTO finance_accounts (code, name, metric) VALUES ${ACCOUNT_ROWS.map(() => '(?, ?, ?)').join(', ')}`, ACCOUNT_ROWS.flat());
}

let schemaReady: Promise<void> | null = null;
// Creates the tables only when missing; existing tables and rows are untouched.
export function ensureFinanceTransactionSchema() {
  if (!schemaReady) schemaReady = (async () => {
    const exists = async (table: string) => {
      try { await pool.query(`SELECT 1 FROM \`${table}\` LIMIT 1`); return true; } catch { return false; }
    };
    if (!await exists('finance_accounts')) {
      await pool.query(`CREATE TABLE IF NOT EXISTS finance_accounts (${FINANCE_ACCOUNT_COLUMNS}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    if (!await exists('finance_transactions')) {
      await pool.query(`CREATE TABLE IF NOT EXISTS finance_transactions (${FINANCE_TRANSACTION_COLUMNS},
        CONSTRAINT fk_finance_transaction_account FOREIGN KEY (account_id) REFERENCES finance_accounts (id),
        CONSTRAINT fk_finance_transaction_outlet FOREIGN KEY (outlet_id) REFERENCES outlets (id),
        CONSTRAINT fk_finance_transaction_counterparty FOREIGN KEY (counterparty_outlet_id) REFERENCES outlets (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    if (!await exists('finance_transaction_audits')) {
      await pool.query(`CREATE TABLE IF NOT EXISTS finance_transaction_audits (${FINANCE_TRANSACTION_AUDIT_COLUMNS}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    await seedFinanceAccounts(pool);
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

const SELECT_RECORD = `SELECT t.id, a.code AS accountCode, t.unit_type AS unitType, t.outlet_id AS outletId,
  DATE_FORMAT(t.transaction_date, '%Y-%m-%d') AS date, CAST(t.amount AS CHAR) AS amount, t.notes, t.evidence_reference AS reference,
  t.status, t.nature, t.counterparty_type AS counterpartyType, t.counterparty_outlet_id AS counterpartyOutletId,
  t.idempotency_key AS idempotencyKey, t.legacy_entry_id AS legacyEntryId, t.version
  FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id`;

const unitOf = (type: unknown, outletId: unknown): Unit | null =>
  type === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : type === 'OUTLET' ? { type: 'OUTLET', outletId: Number(outletId) } : null;

function toRecord(row: any): TransactionRecord {
  return {
    ...validateTransaction({
      date: row.date, unit: unitOf(row.unitType, row.outletId), accountCode: row.accountCode, amount: row.amount,
      notes: row.notes, reference: row.reference, status: row.status, nature: row.nature,
      counterparty: unitOf(row.counterpartyType, row.counterpartyOutletId), idempotencyKey: row.idempotencyKey,
      legacyEntryId: row.legacyEntryId ?? null, version: Number(row.version),
    }),
    id: String(row.id),
  };
}

export function createFinanceTransactionRepository(): TransactionRepository {
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

    async change(id, expectedVersion, plan) {
      await ensureFinanceTransactionSchema();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [found] = await connection.query(`${SELECT_RECORD} WHERE t.id = ? FOR UPDATE`, [id]);
        const before = (found as any[]).length ? toRecord((found as any[])[0]) : null;
        if (expectedVersion === null ? before !== null : before?.version !== expectedVersion) throw new Error('Version conflict');
        const { record, audit } = plan(before);
        const [accounts] = await connection.query('SELECT id FROM finance_accounts WHERE code = ? LIMIT 1', [record.accountCode]);
        const accountId = Number((accounts as any[])[0]?.id);
        if (!accountId) throw new Error('Unknown account');
        if (!before) {
          // A new entry must name an active outlet; voiding an old one never re-checks.
          for (const unit of [record.unit, record.counterparty]) {
            if (unit?.type !== 'OUTLET') continue;
            const [outlets] = await connection.query('SELECT id FROM outlets WHERE id = ? AND is_active = 1 LIMIT 1', [unit.outletId]);
            if (!(outlets as any[]).length) throw new Error('Unknown or inactive outlet');
          }
          const [duplicate] = await connection.query('SELECT id FROM finance_transactions WHERE idempotency_key = ? LIMIT 1', [record.idempotencyKey]);
          if ((duplicate as any[]).length) throw new Error('Duplicate idempotency key');
          await connection.query(`INSERT INTO finance_transactions (id, account_id, unit_type, outlet_id, transaction_date, amount, notes, evidence_reference,
            status, nature, counterparty_type, counterparty_outlet_id, idempotency_key, legacy_entry_id, version, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            record.id, accountId, record.unit.type, record.unit.type === 'OUTLET' ? record.unit.outletId : null, record.date, record.amount,
            record.notes, record.reference, record.status, record.nature, record.counterparty?.type ?? null,
            record.counterparty?.type === 'OUTLET' ? record.counterparty.outletId : null, record.idempotencyKey, record.legacyEntryId,
            record.version, audit.actorId,
          ]);
        } else {
          // planTransactionChange already refused edits to posted fields; only
          // status and version move here.
          const [result] = await connection.query('UPDATE finance_transactions SET status = ?, version = ? WHERE id = ? AND version = ?',
            [record.status, record.version, record.id, before.version]);
          if ((result as any).affectedRows !== 1) throw new Error('Version conflict');
        }
        await connection.query(`INSERT INTO finance_transaction_audits (transaction_id, action, actor_id, occurred_at, reason, before_json, after_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [audit.entityId, audit.action, audit.actorId, audit.occurredAt, audit.reason,
          audit.before ? JSON.stringify(audit.before) : null, JSON.stringify(audit.after)]);
        await connection.commit();
        return record;
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
