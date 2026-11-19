import { ACCOUNT_CLASSES, ACCOUNT_CODE, ACCOUNT_GROUPS, DEFAULT_ACCOUNTS, accountMetric, manualAccount, type AccountClass } from './validation.ts';
import type { SelectExecutor } from './selectExecutor.ts';

// Chart of accounts (master kode biaya). Each code belongs to a group (LC, UC …)
// in a class (DC, DA, CI); `metric` is the formula component it rolls into.
export const FINANCE_ACCOUNT_COLUMNS = `
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL,
  metric VARCHAR(10) NOT NULL,
  group_code VARCHAR(10) NOT NULL DEFAULT '',
  group_name VARCHAR(100) NOT NULL DEFAULT '',
  class_code VARCHAR(4) NOT NULL DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_finance_account_code (code)`;

export type Account = { code: string; name: string; metric: string; groupCode: string; groupName: string; classCode: AccountClass; className: string; isActive: boolean; manual: boolean; builtIn: boolean };
type Query = { query: (sql: string, values?: unknown[]) => Promise<any> };

// Columns added after the first release, for tables created before them.
const ADDED_COLUMNS: [string, string][] = [
  ['group_code', "VARCHAR(10) NOT NULL DEFAULT ''"], ['group_name', "VARCHAR(100) NOT NULL DEFAULT ''"],
  ['class_code', "VARCHAR(4) NOT NULL DEFAULT ''"], ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
];
export async function migrateFinanceAccounts(executor: Query) {
  const [columns] = await executor.query('SHOW COLUMNS FROM finance_accounts');
  const present = new Set((columns as any[]).map(c => c.Field));
  for (const [name, definition] of ADDED_COLUMNS) if (!present.has(name)) await executor.query(`ALTER TABLE finance_accounts ADD COLUMN ${name} ${definition}`);
}

// Inserts missing seed codes and fills the group of rows that predate groups.
// Names and activity Finance changed are kept.
export async function seedFinanceAccounts(executor: Query) {
  const rows = DEFAULT_ACCOUNTS.map(([code, name, group]) => [code, name, accountMetric(code, group), group, ACCOUNT_GROUPS[group].name, ACCOUNT_GROUPS[group].class]);
  await executor.query(`INSERT IGNORE INTO finance_accounts (code, name, metric, group_code, group_name, class_code) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`, rows.flat());
  for (const [code, , group] of DEFAULT_ACCOUNTS) {
    await executor.query("UPDATE finance_accounts SET group_code = ?, group_name = ?, class_code = ? WHERE code = ? AND group_code = ''", [group, ACCOUNT_GROUPS[group].name, ACCOUNT_GROUPS[group].class, code]);
  }
  await executor.query("UPDATE finance_accounts SET name = 'Bonus/Insentif' WHERE code = 'LC03' AND name = 'Bonus/Incentive'");
}

// Seed codes are part of the formulas and syncs: renamed or switched off, never deleted.
const BUILT_IN = new Set(DEFAULT_ACCOUNTS.map(([code]) => code));
function toAccount(row: any): Account {
  const group = ACCOUNT_GROUPS[row.groupCode];
  const classCode = (row.classCode || group?.class) as AccountClass;
  return { code: row.code, name: row.name, metric: row.metric, groupCode: row.groupCode, groupName: row.groupName || group?.name || row.groupCode,
    classCode, className: ACCOUNT_CLASSES[classCode] ?? classCode, isActive: Number(row.isActive) === 1, manual: manualAccount(row.code, row.groupCode), builtIn: BUILT_IN.has(row.code) };
}
const SELECT_ACCOUNTS = `SELECT code, name, metric, group_code AS groupCode, group_name AS groupName, class_code AS classCode, is_active AS isActive
  FROM finance_accounts ORDER BY FIELD(class_code, 'CI', 'DC', 'DA'), group_code, code`;

export async function listAccounts(db: SelectExecutor): Promise<Account[]> {
  return (await db.select(SELECT_ACCOUNTS, [])).map(toAccount);
}

export class AccountError extends Error {}
export async function createAccount(executor: Query, input: { code?: unknown; name?: unknown; groupCode?: unknown }): Promise<Account> {
  const code = String(input.code ?? '').trim().toUpperCase(), name = String(input.name ?? '').trim(), groupCode = String(input.groupCode ?? '').trim().toUpperCase();
  const group = ACCOUNT_GROUPS[groupCode];
  if (!group) throw new AccountError('Klasifikasi tidak dikenal.');
  if (!group.extensible) throw new AccountError(`Klasifikasi ${groupCode} tidak dapat ditambah kode baru (dipakai langsung oleh rumus).`);
  if (!ACCOUNT_CODE.test(code) || !code.startsWith(groupCode) || !/^\d+$/.test(code.slice(groupCode.length))) throw new AccountError(`Kode harus diawali ${groupCode} lalu nomor, contoh ${groupCode}07.`);
  if (!name || name.length > 100) throw new AccountError('Nama kode wajib diisi (maksimal 100 karakter).');
  const [existing] = await executor.query('SELECT id FROM finance_accounts WHERE code = ? LIMIT 1', [code]);
  if ((existing as any[]).length) throw new AccountError(`Kode ${code} sudah ada.`);
  await executor.query('INSERT INTO finance_accounts (code, name, metric, group_code, group_name, class_code, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [code, name, accountMetric(code, groupCode), groupCode, group.name, group.class]);
  return toAccount({ code, name, metric: accountMetric(code, groupCode), groupCode, groupName: group.name, classCode: group.class, isActive: 1 });
}

export async function updateAccount(executor: Query, code: string, input: { name?: unknown; isActive?: unknown }): Promise<Account> {
  const [rows] = await executor.query(`SELECT code, name, metric, group_code AS groupCode, group_name AS groupName, class_code AS classCode, is_active AS isActive FROM finance_accounts WHERE code = ? LIMIT 1`, [code]);
  const before = (rows as any[])[0];
  if (!before) throw new AccountError('Kode akun tidak ditemukan.');
  const name = input.name === undefined ? before.name : String(input.name).trim();
  if (!name || name.length > 100) throw new AccountError('Nama kode wajib diisi (maksimal 100 karakter).');
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') throw new AccountError('Status aktif tidak valid.');
  const isActive = input.isActive === undefined ? Number(before.isActive) === 1 : input.isActive;
  if (!isActive && !manualAccount(before.code, before.groupCode)) throw new AccountError(`Kode ${code} dipakai sinkronisasi/rumus dan tidak dapat dinonaktifkan.`);
  await executor.query('UPDATE finance_accounts SET name = ?, is_active = ? WHERE code = ?', [name, isActive ? 1 : 0, code]);
  return toAccount({ ...before, name, isActive: isActive ? 1 : 0 });
}

// Deletes a code Finance added that nothing uses yet. A code with entries (even
// voided ones) or an HD Outlet expense mapping is switched off instead, so the
// history keeps its code.
export async function deleteAccount(executor: Query, code: string): Promise<Account> {
  const [rows] = await executor.query(`SELECT id, code, name, metric, group_code AS groupCode, group_name AS groupName, class_code AS classCode, is_active AS isActive FROM finance_accounts WHERE code = ? LIMIT 1`, [code]);
  const account = (rows as any[])[0];
  if (!account) throw new AccountError('Kode akun tidak ditemukan.');
  if (BUILT_IN.has(account.code)) throw new AccountError(`Kode ${code} bawaan sistem (dipakai rumus/sinkronisasi) dan tidak dapat dihapus. Ubah namanya atau nonaktifkan saja.`);
  const count = async (sql: string, values: unknown[]) => {
    try { const [[row]] = await executor.query(sql, values); return Number(row?.n ?? 0); }
    catch (error: any) { if (error?.code === 'ER_NO_SUCH_TABLE') return 0; throw error; }
  };
  const entries = await count('SELECT COUNT(*) AS n FROM finance_transactions WHERE account_id = ?', [account.id]);
  if (entries) throw new AccountError(`Kode ${code} sudah dipakai ${entries} entri. Nonaktifkan saja agar riwayatnya tetap ada.`);
  const mappings = await count('SELECT COUNT(*) AS n FROM hdoutlet_expense_mappings WHERE account_code = ?', [code]);
  if (mappings) throw new AccountError(`Kode ${code} dipakai mapping pengeluaran HD Outlet. Ganti mapping-nya dulu.`);
  const legacy = await count('SELECT COUNT(*) AS n FROM manual_finance_entries WHERE account_code = ?', [code]);
  if (legacy) throw new AccountError(`Kode ${code} dipakai ${legacy} entri lama. Nonaktifkan saja.`);
  await executor.query('DELETE FROM finance_accounts WHERE id = ?', [account.id]);
  return toAccount(account);
}
