import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import { mysqlSelectExecutor, type SelectExecutor } from './WarehouseFinanceDataSource.ts';
import { loadFinanceEnvironment, FINANCE_ENV_KEYS } from './environment.ts';

export type FinanceFailureCategory = 'configuration' | 'environment_file' | 'sql_guard' | 'connection' | 'grants_metadata' | 'grants_policy' | 'query' | 'authentication';
export class FinanceReadUnavailable extends Error {
  constructor(public readonly category: FinanceFailureCategory = 'connection', public readonly missingVariables: string[] = [], public readonly mysqlCode?: string) {
    super('Finance read-only database unavailable or not safely configured');
  }
}
export function financeFailure(error: unknown, category: FinanceFailureCategory): FinanceReadUnavailable {
  if (error instanceof FinanceReadUnavailable) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const safeCode = typeof code === 'string' && (/^ER_[A-Z0-9_]{1,80}$/.test(code) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes(code)) ? code : undefined;
  return new FinanceReadUnavailable(category, [], safeCode);
}
export function logFinanceFailure(error: FinanceReadUnavailable) {
  console.error('[finance-readonly]', JSON.stringify({
    category: error.category,
    missingVariables: error.missingVariables.filter(key => FINANCE_ENV_KEYS.includes(key as typeof FINANCE_ENV_KEYS[number])),
    ...(error.mysqlCode ? { mysqlCode: financeFailure({ code: error.mysqlCode }, error.category).mysqlCode } : {}),
  }));
}

// Dedicated credentials only: never fall back to the operational/root account.
export function financePoolOptions(env: NodeJS.ProcessEnv) {
  const required = ['FINANCE_DB_HOST', 'FINANCE_DB_NAME', 'FINANCE_DB_USER', 'FINANCE_DB_PASSWORD'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new FinanceReadUnavailable('configuration', missing);
  const port = env.FINANCE_DB_PORT === undefined ? 3306 : Number(env.FINANCE_DB_PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new FinanceReadUnavailable('configuration');
  return {
    host: env.FINANCE_DB_HOST!, database: env.FINANCE_DB_NAME!, user: env.FINANCE_DB_USER!, password: env.FINANCE_DB_PASSWORD!, port,
    connectionLimit: 4, waitForConnections: true, queueLimit: 20, connectTimeout: 5000,
    multipleStatements: false, decimalNumbers: false, supportBigNumbers: true, bigNumberStrings: true,
    dateStrings: true, timezone: 'Z',
  };
}

export function assertSelectOnlyGrants(rows: unknown) {
  if (!Array.isArray(rows) || rows.length === 0) throw new FinanceReadUnavailable('grants_policy');
  let hasSelect = false;
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new FinanceReadUnavailable('grants_policy');
    const grants = Object.values(row);
    if (grants.length !== 1 || typeof grants[0] !== 'string') throw new FinanceReadUnavailable('grants_policy');
    const grant = grants[0];
    // Roles, PROXY, ALL, write/DDL/EXECUTE/FILE/admin privileges and grant option
    // are deliberately rejected, including privileges on other databases.
    if (!/^GRANT (?:USAGE|SELECT) ON (?:\*|`(?:[^`]|``)+`)\.(?:\*|`(?:[^`]|``)+`) TO /i.test(grant) || /\bWITH GRANT OPTION\b/i.test(grant)) throw new FinanceReadUnavailable('grants_policy');
    if (/^GRANT SELECT ON /i.test(grant)) hasSelect = true;
  }
  if (!hasSelect) throw new FinanceReadUnavailable('grants_policy');
}

type ReadConnection = Pick<PoolConnection, 'query' | 'execute' | 'release'>;
export function guardedFinanceExecutor(acquire: () => Promise<ReadConnection>): SelectExecutor {
  return {
    async select(sql, parameters) {
      // Validate before even acquiring a connection or reading metadata.
      let connection: ReadConnection | undefined;
      let stage: FinanceFailureCategory = 'sql_guard';
      const executor = mysqlSelectExecutor({ execute: async (statement, values) => {
        stage = 'connection';
        connection = await acquire();
        stage = 'grants_metadata';
        const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
        stage = 'grants_policy';
        assertSelectOnlyGrants(grants);
        stage = 'query';
        return connection.execute({ sql: statement, timeout: 5000 }, values);
      } });
      try { return await executor.select(sql, parameters); }
      catch (error) { throw financeFailure(error, stage); }
      finally { connection?.release(); }
    },
  };
}

// Lazy pool: importing/mounting this module does not connect or execute SQL.
export function createFinanceReadDatabase(env?: NodeJS.ProcessEnv) {
  let pool: Pool | undefined;
  const executor = guardedFinanceExecutor(async () => {
    if (!pool) {
      let config: NodeJS.ProcessEnv;
      try { config = env ?? loadFinanceEnvironment(); }
      catch (error) { throw financeFailure(error, 'environment_file'); }
      pool = mysql.createPool(financePoolOptions(config));
    }
    return pool.getConnection();
  });
  return { executor, close: async () => { if (pool) { await pool.end(); pool = undefined; } } };
}
