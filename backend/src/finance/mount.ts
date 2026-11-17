import { loadFinanceEnvironment } from './environment.ts';
import type { Express } from 'express';
import { createFinanceRouter } from './router.ts';
import { createFinanceReadDatabase } from './readOnlyConnection.ts';
import { createFinanceReadAuthenticator } from './authentication.ts';
import { WarehouseFinanceDataSource } from './WarehouseFinanceDataSource.ts';
import { createConfiguredOutletSource } from './OutletHttpTransport.ts';
import type { SelectExecutor } from './WarehouseFinanceDataSource.ts';
import { createTransactionRouter, type TransactionRepository } from './transactionApi.ts';

// Public origins of the app (APP_BASE_URL, APP_URL, FRONTEND_URL...), for the
// same-origin check on transaction writes behind the hosting proxy.
export function trustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>();
  for (const key of ['APP_BASE_URL', 'APP_URL', 'FRONTEND_URL', 'CLIENT_URL']) {
    try { if (env[key]) origins.add(new URL(env[key]!).origin); } catch { /* not a URL: ignored */ }
  }
  return [...origins];
}

// Same mount path/factory used by server.ts and socket-free application tests.
export function mountFinanceReadOnly(app: Express, db: SelectExecutor = createFinanceReadDatabase().executor, identitySource?: Pick<ReturnType<typeof createFinanceReadAuthenticator>, 'identity' | 'authenticate' | 'status'>, transactions?: TransactionRepository) {
  const auth = identitySource ?? createFinanceReadAuthenticator(db);
  // Before the read-only router, whose catch-all refuses every other path.
  if (transactions) app.use('/api/finance/v2/transactions', createTransactionRouter(transactions, async (req) => {
    const user = await auth.identity(req);
    return user ? { id: user.id, role: user.role } : null;
  }, trustedOrigins()));
  app.use('/api/finance/v2', createFinanceRouter({
    sourceContext: loadFinanceEnvironment().FINANCE_DB_NAME === 'hd_warehouse_finance_test' ? 'test-fixture' : 'configured-source',
    warehouse: new WarehouseFinanceDataSource(db),
    outlet: createConfiguredOutletSource(), // No verified provider contract registered: live blocked.
    authenticateReadOnly: auth.authenticate,
    persistenceEnabled: Boolean(transactions),
  }));
  return auth;
}
