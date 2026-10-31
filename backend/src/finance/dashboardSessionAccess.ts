import type { Request, RequestHandler } from 'express';
import type { FinancePrincipal } from './router.ts';
// Dashboard identities come from the same server session as application login.
export function dashboardSessionAccess(authenticate: (req: Request) => Promise<FinancePrincipal | null>, finance = false): RequestHandler {
  return async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const principal = await authenticate(req);
      if (!principal) { res.status(401).json({ error: 'Sesi login tidak tersedia atau berakhir. Silakan login kembali.' }); return; }
      if (finance ? !['WAREHOUSE', 'FINANCE'].includes(principal.role) : principal.role !== 'WAREHOUSE') {
        res.status(403).json({ error: finance ? 'Akses Finance tidak diizinkan untuk role ini.' : 'Akses dashboard operasional hanya untuk role Warehouse' }); return;
      }
      if (finance && principal.role === 'WAREHOUSE' && !principal.warehouseGateVerified) {
        res.status(403).json({ code: 'FINANCE_ACCESS_REQUIRED', error: 'Verifikasi password Finance untuk melanjutkan.' }); return;
      }
      next();
    } catch { res.status(503).json({ error: 'Layanan verifikasi sesi tidak tersedia. Coba lagi.' }); }
  };
}
