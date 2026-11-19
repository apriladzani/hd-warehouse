import { Router, type Request } from 'express';
import { ALL_METRICS, parseUnitKey, type Metric } from './domain.ts';
import { ACCOUNT_CLASSES, ACCOUNT_GROUPS, DEFAULT_ACCOUNTS, accountMetric, manualAccount, parseFilter } from './validation.ts';
import { canReadMultiSourceFinance } from './access.ts';
import { buildDetail, buildReport } from './FinanceReportService.ts';
import { loadReportInput } from './reportData.ts';
import { listAccounts } from './accounts.ts';
import type { SelectExecutor } from './selectExecutor.ts';
import { FinanceReadUnavailable, logFinanceFailure } from './readOnlyConnection.ts';

export type FinancePrincipal = { role: string; warehouseGateVerified: boolean };
export type FinanceRouterDependencies = {
  db: SelectExecutor;
  hdOutletEnabled: () => boolean;
  today?: () => string;
  sourceContext?: 'test-fixture' | 'configured-source';
  persistenceEnabled?: boolean;
  authenticateReadOnly: (request: Request) => Promise<FinancePrincipal | null>;
};
export const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// Read-only Finance API (mounted through mountFinanceReadOnly). Everything here
// goes through the SELECT-only executor; writes live in transactionApi/manageApi.
export function createFinanceRouter(deps: FinanceRouterDependencies) {
  const router = Router();
  const today = deps.today ?? todayJakarta;
  router.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const principal = await deps.authenticateReadOnly(req);
      if (!principal) { res.status(401).json({ error: 'Authentication required' }); return; }
      if (!canReadMultiSourceFinance(principal.role, principal.warehouseGateVerified)) { res.status(403).json({ error: 'Finance access denied', ...(principal.role === 'WAREHOUSE' ? { code: 'FINANCE_ACCESS_REQUIRED' } : {}) }); return; }
      next();
    } catch (error) { if (error instanceof FinanceReadUnavailable) logFinanceFailure(error); res.status(error instanceof FinanceReadUnavailable ? 503 : 403).json({ error: error instanceof FinanceReadUnavailable ? 'Finance read-only authentication unavailable' : 'Finance access denied' }); }
  });

  router.get('/accounts', async (_req, res) => {
    let accounts;
    // Before the first write the table may not exist yet: show the seed.
    try { accounts = await listAccounts(deps.db); }
    catch { accounts = DEFAULT_ACCOUNTS.map(([code, name, group]) => ({ code, name, metric: accountMetric(code, group), groupCode: group, groupName: ACCOUNT_GROUPS[group].name, classCode: ACCOUNT_GROUPS[group].class, className: ACCOUNT_CLASSES[ACCOUNT_GROUPS[group].class], isActive: true, manual: manualAccount(code, group) })); }
    res.json({
      accounts, persistenceEnabled: deps.persistenceEnabled ?? false,
      groups: Object.entries(ACCOUNT_GROUPS).map(([code, g]) => ({ code, name: g.name, classCode: g.class, className: ACCOUNT_CLASSES[g.class], manual: g.manual, extensible: g.extensible })),
    });
  });

  router.get('/report', async (req, res) => {
    let filter;
    try { filter = parseFilter(req.query); } catch { res.status(400).json({ error: 'Invalid Finance filters' }); return; }
    try {
      const input = await loadReportInput(deps.db, filter, { hdOutletEnabled: deps.hdOutletEnabled(), today: today() });
      res.json({ ...buildReport(filter, input), hdOutlet: input.hdOutlet, sourceContext: deps.sourceContext ?? 'configured-source' });
    } catch (error) {
      if (error instanceof FinanceReadUnavailable) logFinanceFailure(error);
      res.status(503).json({ error: 'Finance source unavailable' });
    }
  });

  // ?metric=LC[&unit=OUTLET:3] → account codes (LC01, LC02 …) and their entries.
  router.get('/report/detail', async (req, res) => {
    let filter, metric: Metric, unit = null;
    try {
      filter = parseFilter(req.query);
      if (typeof req.query.metric !== 'string' || !ALL_METRICS.includes(req.query.metric as Metric)) throw new Error('metric');
      metric = req.query.metric as Metric;
      if (req.query.unit !== undefined) { unit = parseUnitKey(req.query.unit); if (!unit) throw new Error('unit'); }
    } catch { res.status(400).json({ error: 'Invalid Finance filters' }); return; }
    try {
      const input = await loadReportInput(deps.db, filter, { hdOutletEnabled: deps.hdOutletEnabled(), today: today() });
      res.json(buildDetail(filter, input, metric, unit));
    } catch (error) {
      if (error instanceof FinanceReadUnavailable) logFinanceFailure(error);
      res.status(503).json({ error: 'Finance source unavailable' });
    }
  });

  router.use((req, res) => { res.status(req.method === 'GET' ? 404 : 405).json({ error: 'Finance v2 read API: accounts, report and report/detail only' }); });
  return router;
}
