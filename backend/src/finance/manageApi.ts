import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index.ts';
import { logAdminActivity } from '../db/repository.ts';
import { AccountError, createAccount, deleteAccount, updateAccount } from './accounts.ts';
import { ensureFinanceTransactionSchema } from './transactionRepository.ts';
import { financeWriteGuard, type Actor } from './transactionApi.ts';
import { hdOutletOverview, MappingError, setExpenseMapping, setOutletMapping, syncHdOutlet } from './hdOutletSync.ts';
import { HdOutletError } from './hdOutletClient.ts';
import { hdAttendanceOverview, setHdaOutletMapping, syncHdAttendance } from './hdAttendanceSync.ts';
import { HdAttendanceError } from './hdAttendanceClient.ts';
import { date } from './validation.ts';

// Finance administration, FINANCE role only (mounted at /api/finance/v2/manage):
// chart of accounts, HD Outlet and HD Attendance mappings, sync logs and
// "Sinkron sekarang".
export function createFinanceManageRouter(authenticate: (req: Request) => Promise<Actor | null>, trustedOrigins: string[] = [], sync: typeof syncHdOutlet = syncHdOutlet, syncAttendance: typeof syncHdAttendance = syncHdAttendance) {
  const router = Router();
  router.use(financeWriteGuard(authenticate, trustedOrigins));
  const actorOf = (res: Response) => res.locals.actor as Actor;
  const fail = (res: Response, error: unknown, fallback: string) => {
    if (error instanceof AccountError || error instanceof MappingError) { res.status(400).json({ error: error.message }); return; }
    if ((error instanceof HdOutletError || error instanceof HdAttendanceError) && error.code === 'BUSY') { res.status(409).json({ error: error.message }); return; }
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

  router.delete('/accounts/:code', async (req, res) => {
    try {
      await ensureFinanceTransactionSchema();
      const account = await deleteAccount(pool, req.params.code);
      const actor = actorOf(res);
      await logAdminActivity({ actorId: actor.id, actorName: actor.name || `user#${actor.id}`, action: 'FINANCE_ACCOUNT_DELETE', targetType: 'finance_account', targetId: account.code, details: { name: account.name, groupCode: account.groupCode } }).catch(() => {});
      res.json({ deleted: account.code });
    } catch (error) { fail(res, error, 'Kode akun gagal dihapus.'); }
  });

  router.get('/hdoutlet', async (_req, res) => {
    try { res.json(await hdOutletOverview()); } catch (error) { fail(res, error, 'Status integrasi HD Outlet tidak dapat dibaca.'); }
  });

  // "Sinkron sekarang" for a period (at most 62 days per run).
  const period = (req: Request, res: Response) => {
    try {
      const startDate = date(req.body?.startDate), endDate = date(req.body?.endDate);
      if (endDate < startDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 62) throw new Error();
      return { startDate, endDate };
    } catch { res.status(400).json({ error: 'Periode sinkron tidak valid (maksimal 62 hari).' }); return null; }
  };
  router.post('/hdoutlet/sync', async (req, res) => {
    const range = period(req, res); if (!range) return;
    const { startDate, endDate } = range;
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

  router.get('/hdattendance', async (_req, res) => {
    try { res.json(await hdAttendanceOverview()); } catch (error) { fail(res, error, 'Status integrasi HD Attendance tidak dapat dibaca.'); }
  });

  router.post('/hdattendance/sync', async (req, res) => {
    const range = period(req, res); if (!range) return;
    try {
      const result = await syncAttendance({ ...range, trigger: 'manual', actor: actorOf(res) });
      res.status(result.status === 'failed' ? 502 : 200).json(result);
    } catch (error) { fail(res, error, 'Sinkron HD Attendance gagal dijalankan.'); }
  });

  router.put('/hdattendance/outlets/:hdaOutletId', async (req, res) => {
    const hdaOutletId = Number(req.params.hdaOutletId), outletId = req.body?.outletId;
    if (!Number.isSafeInteger(hdaOutletId) || hdaOutletId <= 0 || !(outletId === null || (Number.isSafeInteger(outletId) && outletId > 0))) { res.status(400).json({ error: 'Mapping outlet tidak valid.' }); return; }
    try { res.json(await setHdaOutletMapping(hdaOutletId, outletId, actorOf(res))); } catch (error) { fail(res, error, 'Mapping outlet gagal disimpan.'); }
  });

  return router;
}
