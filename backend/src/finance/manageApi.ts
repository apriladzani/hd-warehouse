import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index.ts';
import { logAdminActivity } from '../db/repository.ts';
import { AccountError, createAccount, updateAccount } from './accounts.ts';
import { ensureFinanceTransactionSchema } from './transactionRepository.ts';
import { financeWriteGuard, type Actor } from './transactionApi.ts';
import { hdOutletOverview, MappingError, setExpenseMapping, setOutletMapping, syncHdOutlet } from './hdOutletSync.ts';
import { HdOutletError } from './hdOutletClient.ts';
import { date } from './validation.ts';

// Finance administration, FINANCE role only (mounted at /api/finance/v2/manage):
// chart of accounts, HD Outlet mappings, sync log and "Sinkron sekarang".
export function createFinanceManageRouter(authenticate: (req: Request) => Promise<Actor | null>, trustedOrigins: string[] = [], sync: typeof syncHdOutlet = syncHdOutlet) {
  const router = Router();
  router.use(financeWriteGuard(authenticate, trustedOrigins));
  const actorOf = (res: Response) => res.locals.actor as Actor;
  const fail = (res: Response, error: unknown, fallback: string) => {
    if (error instanceof AccountError || error instanceof MappingError) { res.status(400).json({ error: error.message }); return; }
    if (error instanceof HdOutletError && error.code === 'BUSY') { res.status(409).json({ error: error.message }); return; }
    console.error('[finance-manage]', error instanceof Error ? error.message : error);
    res.status(500).json({ error: fallback });
  };

  router.post('/accounts', async (req, res) => {
    try {
      await ensureFinanceTransactionSchema();
      const account = await createAccount(pool, req.body ?? {});
      const actor = actorOf(res);
      await logAdminActivity({ actorId: actor.id, actorName: actor.name || `user#${actor.id}`, action: 'FINANCE_ACCOUNT_CREATE', targetType: 'finance_account', targetId: account.code, details: account }).catch(() => {});
      res.status(201).json({ account });
    } catch (error) { fail(res, error, 'Kode akun gagal ditambahkan.'); }
  });

  router.patch('/accounts/:code', async (req, res) => {
    try {
      await ensureFinanceTransactionSchema();
      const account = await updateAccount(pool, req.params.code, req.body ?? {});
      const actor = actorOf(res);
      await logAdminActivity({ actorId: actor.id, actorName: actor.name || `user#${actor.id}`, action: 'FINANCE_ACCOUNT_UPDATE', targetType: 'finance_account', targetId: account.code, details: { name: account.name, isActive: account.isActive } }).catch(() => {});
      res.json({ account });
    } catch (error) { fail(res, error, 'Kode akun gagal diubah.'); }
  });

  router.get('/hdoutlet', async (_req, res) => {
    try { res.json(await hdOutletOverview()); } catch (error) { fail(res, error, 'Status integrasi HD Outlet tidak dapat dibaca.'); }
  });

  // "Sinkron sekarang" for a period (at most 62 days per run).
  router.post('/hdoutlet/sync', async (req, res) => {
    let startDate: string, endDate: string;
    try {
      startDate = date(req.body?.startDate); endDate = date(req.body?.endDate);
      if (endDate < startDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 62) throw new Error();
    } catch { res.status(400).json({ error: 'Periode sinkron tidak valid (maksimal 62 hari).' }); return; }
    try {
      const actor = actorOf(res);
      const result = await sync({ startDate, endDate, trigger: 'manual', actor });
      res.status(result.status === 'failed' ? 502 : 200).json(result);
    } catch (error) { fail(res, error, 'Sinkron HD Outlet gagal dijalankan.'); }
  });

  router.put('/hdoutlet/outlets/:hdOutletId', async (req, res) => {
    const hdOutletId = Number(req.params.hdOutletId), outletId = req.body?.outletId;
    if (!Number.isSafeInteger(hdOutletId) || hdOutletId <= 0 || !(outletId === null || (Number.isSafeInteger(outletId) && outletId > 0))) { res.status(400).json({ error: 'Mapping outlet tidak valid.' }); return; }
    try { res.json(await setOutletMapping(hdOutletId, outletId, actorOf(res))); } catch (error) { fail(res, error, 'Mapping outlet gagal disimpan.'); }
  });

  router.put('/hdoutlet/expenses/:key', async (req, res) => {
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(req.params.key)) { res.status(400).json({ error: 'Jenis pengeluaran tidak valid.' }); return; }
    try { res.json(await setExpenseMapping(req.params.key, req.body ?? {}, actorOf(res))); } catch (error) { fail(res, error, 'Mapping pengeluaran gagal disimpan.'); }
  });

  return router;
}
