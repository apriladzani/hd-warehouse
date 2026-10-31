import { loadFinanceEnvironment } from './environment.ts';
import type { Express } from 'express';
import { createFinanceRouter } from './router.ts';
import { createFinanceReadDatabase } from './readOnlyConnection.ts';
import { createFinanceReadAuthenticator } from './authentication.ts';
import { WarehouseFinanceDataSource } from './WarehouseFinanceDataSource.ts';
import { createConfiguredOutletSource } from './OutletHttpTransport.ts';
import type { SelectExecutor } from './WarehouseFinanceDataSource.ts';

// Same mount path/factory used by server.ts and socket-free application tests.
export function mountFinanceReadOnly(app: Express, db: SelectExecutor = createFinanceReadDatabase().executor, identitySource?: Pick<ReturnType<typeof createFinanceReadAuthenticator>, 'identity' | 'authenticate' | 'status'>) {
  const auth = identitySource ?? createFinanceReadAuthenticator(db);
  app.use('/api/finance/v2', createFinanceRouter({
    sourceContext: loadFinanceEnvironment().FINANCE_DB_NAME === 'hd_warehouse_finance_test' ? 'test-fixture' : 'configured-source',
    warehouse: new WarehouseFinanceDataSource(db),
    outlet: createConfiguredOutletSource(), // No verified provider contract registered: live blocked.
    authenticateReadOnly: auth.authenticate,
  }));
  return auth;
}
