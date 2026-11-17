import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFinanceEnvironment } from './environment.ts';
import type { Express } from 'express';
import { createFinanceRouter } from './router.ts';
import { createFinanceReadDatabase } from './readOnlyConnection.ts';
import { createFinanceReadAuthenticator } from './authentication.ts';
import type { SelectExecutor } from './selectExecutor.ts';
import { createTransactionRouter, type TransactionRepository } from './transactionApi.ts';
import { createFinanceManageRouter } from './manageApi.ts';
import { hdOutletConfig } from './hdOutletClient.ts';

// Public origins of the app (APP_BASE_URL, APP_URL, FRONTEND_URL...), for the
// same-origin check on Finance writes behind the hosting proxy.
export function trustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>();
  for (const key of ['APP_BASE_URL', 'APP_URL', 'FRONTEND_URL', 'CLIENT_URL']) {
    try { if (env[key]) origins.add(new URL(env[key]!).origin); } catch { /* not a URL: ignored */ }
  }
  return [...origins];
}

// backend/uploads/finance, next to the branding uploads but never served statically.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const FINANCE_ATTACHMENT_DIR = path.resolve(moduleDirectory, path.basename(moduleDirectory) === 'dist' ? '../uploads/finance' : '../../uploads/finance');

// Same mount path/factory used by server.ts and socket-free application tests.
export function mountFinanceReadOnly(app: Express, db: SelectExecutor = createFinanceReadDatabase().executor, identitySource?: Pick<ReturnType<typeof createFinanceReadAuthenticator>, 'identity' | 'authenticate' | 'status'>, transactions?: TransactionRepository, attachmentDir = FINANCE_ATTACHMENT_DIR) {
  const auth = identitySource ?? createFinanceReadAuthenticator(db);
  const actor = async (req: Parameters<typeof auth.identity>[0]) => {
    const user = await auth.identity(req) as { id: number; role: string; name?: string } | null;
    return user ? { id: user.id, role: user.role, name: user.name } : null;
  };
  // Before the read-only router, whose catch-all refuses every other path.
  if (transactions) {
    app.use('/api/finance/v2/transactions', createTransactionRouter(transactions, actor, trustedOrigins(), attachmentDir));
    app.use('/api/finance/v2/manage', createFinanceManageRouter(actor, trustedOrigins()));
  }
  app.use('/api/finance/v2', createFinanceRouter({
    db,
    sourceContext: loadFinanceEnvironment().FINANCE_DB_NAME === 'hd_warehouse_finance_test' ? 'test-fixture' : 'configured-source',
    hdOutletEnabled: () => hdOutletConfig().enabled,
    authenticateReadOnly: auth.authenticate,
    persistenceEnabled: Boolean(transactions),
  }));
  return auth;
}
