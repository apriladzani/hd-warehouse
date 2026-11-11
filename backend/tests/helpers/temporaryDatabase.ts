import { mock } from 'node:test';
import { createPool } from '../../src/db/index.ts';
import { MILLISECOND_COLUMN_DEFINITION, MILLISECOND_TIMESTAMP_TABLES } from '../../src/db/timestampPrecision.ts';
import { PASSWORD_RESET_COLUMNS, REQUEST_CANCELLATION_COLUMNS } from '../../src/db/repository.ts';

// Runs a test against the configured MySQL server without touching its data:
// every table is shadowed by a connection-local TEMPORARY copy that disappears
// when the connection closes, and the pool is redirected onto that one
// connection. Pool.execute is redirected too: the session/authentication reader
// goes through it rather than pool.query.
export const pool = createPool();
export const closePool = () => pool.end();

const TABLES = ['users', 'outlets', 'vendors', 'items', 'item_vendors', 'purchase_transactions', 'purchase_items',
  'requests', 'request_items', 'stock_movements', 'stock_opnames', 'manual_finance_entries', 'system_settings', 'activity_logs',
  'inventory_cost_periods', 'inventory_cost_snapshots', 'finance_period_snapshots', 'finance_period_outlet_snapshots',
  'finance_security', 'finance_access_sessions', 'finance_access_attempts'];

export async function withTemporaryDatabase(run: (connection: any) => Promise<void>) {
  const connection: any = await pool.getConnection();
  try {
    for (const table of TABLES) {
      const [definition]: any = await connection.query(`SHOW CREATE TABLE ${table}`);
      const ddl = definition[0]['Create Table'].replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
        .split('\n').filter((line: string) => !line.trimStart().startsWith('CONSTRAINT')).join('\n')
        .replace(/,\n\)/g, '\n)');
      await connection.query(ddl);
    }
    // Created at runtime by their ensure*Schema functions, so there is no real
    // table to copy: build the shadows from the same column definitions.
    await connection.query(`CREATE TEMPORARY TABLE password_reset_tokens (${PASSWORD_RESET_COLUMNS}) ENGINE=InnoDB`);
    await connection.query(`CREATE TEMPORARY TABLE request_cancellations (${REQUEST_CANCELLATION_COLUMNS}) ENGINE=InnoDB`);
    await connection.query('ALTER TABLE items MODIFY avg_purchase_price DECIMAL(18,6) NOT NULL DEFAULT 0');
    await connection.query('ALTER TABLE stock_movements MODIFY movement_type VARCHAR(40) NOT NULL');
    // Independent of whether the server itself has had db:migrate-timestamps run.
    for (const table of MILLISECOND_TIMESTAMP_TABLES) await connection.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`created_at\` ${MILLISECOND_COLUMN_DEFINITION}`);
    mock.method(pool, 'query', connection.query.bind(connection));
    mock.method(pool, 'execute', connection.execute.bind(connection));
    mock.method(pool, 'getConnection', async () => connection);
    mock.method(connection, 'release', () => {});
    await run(connection);
  } finally {
    mock.restoreAll();
    connection.destroy();
  }
}
