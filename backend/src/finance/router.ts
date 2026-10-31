import { Router, type Request } from 'express';
import type { FinanceDataSource } from './domain.ts';
import { parseFilter, ACCOUNTS } from './validation.ts';
import { canReadMultiSourceFinance } from './access.ts';
import { FinanceAggregationService } from './FinanceAggregationService.ts';
import { FinanceReadUnavailable, logFinanceFailure } from './readOnlyConnection.ts';
export type FinancePrincipal = { role: string; warehouseGateVerified: boolean };
export type FinanceRouterDependencies = {
  warehouse: FinanceDataSource; outlet: FinanceDataSource;
  sourceContext?: 'test-fixture' | 'configured-source';
  authenticateReadOnly: (request: Request) => Promise<FinancePrincipal | null>;
};
// Mounted through mountFinanceReadOnly. Authentication never uses the legacy
// repository helpers; no persistence/mutation endpoints are exposed here.
export function createFinanceRouter(deps: FinanceRouterDependencies) {
  const router = Router();
  router.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const principal = await deps.authenticateReadOnly(req);
      if (!principal) { res.status(401).json({ error: 'Authentication required' }); return; }
      if (!canReadMultiSourceFinance(principal.role, principal.warehouseGateVerified)) { res.status(403).json({ error: 'Finance access denied', ...(principal.role === 'WAREHOUSE' ? { code: 'FINANCE_ACCESS_REQUIRED' } : {}) }); return; }
      next();
    } catch (error) { if (error instanceof FinanceReadUnavailable) logFinanceFailure(error); res.status(error instanceof FinanceReadUnavailable ? 503 : 403).json({ error: error instanceof FinanceReadUnavailable ? 'Finance read-only authentication unavailable' : 'Finance access denied' }); }
  });
  router.get('/accounts', (_req, res) => res.json({ accounts: Object.entries(ACCOUNTS).map(([code, [name, group]]) => ({ code, name, group })), persistenceEnabled: false }));
  router.get('/report', async (req, res) => {
    let filter;
    try { filter = parseFilter(req.query); } catch { res.status(400).json({ error: 'Invalid Finance filters' }); return; }
    try {
      const sources = await Promise.all([deps.warehouse.read(filter), ...(filter.mode === 'WAREHOUSE' ? [] : [deps.outlet.read(filter)])]);
      res.json({ ...new FinanceAggregationService().aggregate(filter, sources), sourceContext: deps.sourceContext ?? 'configured-source' });
    } catch { res.status(503).json({ error: 'Finance source unavailable' }); }
  });
  router.use((req, res) => { res.status(req.method === 'GET' ? 404 : 405).json({ error: 'Finance v2 exposes read-only accounts/report only' }); });
  return router;
}
