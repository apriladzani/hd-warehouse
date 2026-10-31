import { readFileSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
export const FINANCE_ENV_KEYS = ['FINANCE_DB_HOST', 'FINANCE_DB_PORT', 'FINANCE_DB_NAME', 'FINANCE_DB_USER', 'FINANCE_DB_PASSWORD', 'OUTLET_FINANCE_API_BASE_URL', 'OUTLET_FINANCE_API_TOKEN', 'OUTLET_FINANCE_API_TIMEOUT_MS', 'OUTLET_FINANCE_API_ENABLED'] as const;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
// Source: backend/src/finance; esbuild output: backend/dist/server.js.
export const FINANCE_ENV_FILE = basename(moduleDirectory) === 'dist'
  ? resolve(moduleDirectory, '../.env') : resolve(moduleDirectory, '../../.env');
export function loadFinanceEnvironment(inherited: NodeJS.ProcessEnv = process.env, file = FINANCE_ENV_FILE): NodeJS.ProcessEnv {
  let parsed: Record<string, string> = {};
  try { parsed = parse(readFileSync(file)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const result = { ...inherited };
  for (const key of FINANCE_ENV_KEYS) if (result[key] === undefined && parsed[key] !== undefined) result[key] = parsed[key];
  return result;
}
