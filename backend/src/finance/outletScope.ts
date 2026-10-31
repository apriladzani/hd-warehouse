import type { Request, Response } from 'express';
// Who may see which outlets in the period report. Enforced on the server: the
// client's outlet filter is only a request, never a grant.
export type FinanceViewer = { id: number; role: string; outletId: number | null; warehouseGateVerified: boolean };
export type OutletScope = { outletIds: number[] | undefined; lockedOutletId: number | null; showCost: boolean };
export type ScopeDenied = { status: 400 | 401 | 403; code?: string; error: string };

// "1,4,7" → [1, 4, 7]; empty → undefined (all outlets); anything else → null (invalid).
export function parseOutletIds(value: unknown): number[] | undefined | null {
  if (value == null || value === '') return undefined;
  const ids = String(value).split(',').map(part => part.trim()).filter(Boolean).map(Number);
  if (!ids.length) return undefined;
  if (ids.some(id => !Number.isSafeInteger(id) || id < 0)) return null;
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function resolveOutletScope(viewer: FinanceViewer | null, requested: number[] | undefined | null, outletCanViewCost: boolean): OutletScope | ScopeDenied {
  if (!viewer) return { status: 401, error: 'Sesi login tidak tersedia atau berakhir. Silakan login kembali.' };
  if (requested === null) return { status: 400, error: 'Filter outlet tidak valid.' };
  if (viewer.role === 'WAREHOUSE' && !viewer.warehouseGateVerified) return { status: 403, code: 'FINANCE_ACCESS_REQUIRED', error: 'Verifikasi password Finance untuk melanjutkan.' };
  if (['WAREHOUSE', 'FINANCE', 'ADMIN'].includes(viewer.role)) return { outletIds: requested, lockedOutletId: null, showCost: true };
  if (viewer.role !== 'OUTLET') return { status: 403, error: 'Akses laporan tidak diizinkan untuk role ini.' };
  if (!viewer.outletId) return { status: 403, error: 'Akun Outlet belum memiliki penempatan. Hubungi Admin.' };
  if (requested && requested.some(id => id !== viewer.outletId)) return { status: 403, error: 'Akun Outlet hanya dapat melihat data outlet sendiri.' };
  return { outletIds: [viewer.outletId], lockedOutletId: viewer.outletId, showCost: outletCanViewCost };
}

export const isDenied = (scope: OutletScope | ScopeDenied): scope is ScopeDenied => 'status' in scope;

// Outlet accounts get sales figures only: no purchase prices, averages, warehouse
// stock or manual finance entries; HPP and profit only when the role setting allows.
export function outletView(stats: any, scope: OutletScope) {
  const costFields = ['totalCogsAmountExact', 'totalCogsAmount', 'missingCostQuantity', 'totalProfitExact', 'totalProfit'];
  const itemFields = ['itemId', 'itemName', 'category', 'itemCode', 'quantity', 'catalogPrice', 'averageSellingPrice', 'totalSellingAmountExact', 'totalSellingAmount', ...(scope.showCost ? costFields : [])];
  return {
    financePeriods: stats.financePeriods, financePeriod: stats.financePeriod, periodLock: stats.periodLock, itemList: stats.itemList,
    itemProfitability: (stats.itemProfitability ?? []).map((row: any) => ({
      ...Object.fromEntries(itemFields.filter(key => key in row).map(key => [key, row[key]])),
      outletBreakdown: (row.outletBreakdown ?? []).map((o: any) => scope.showCost ? o : { outletId: o.outletId, soldQuantity: o.soldQuantity, sales: o.sales }),
    })),
    totalSellingAmount: stats.totalSellingAmount, totalQuantity: stats.totalQuantity,
    ...(scope.showCost ? { totalCogsAmount: stats.totalCogsAmount, totalProfit: stats.totalProfit } : {}),
  };
}

// Route guard: answers 401/403/400/503 itself and returns the scope otherwise.
export function createFinanceScope(deps: {
  identity: (req: Request) => Promise<{ id: number; role: string } | null>;
  authenticate: (req: Request) => Promise<{ warehouseGateVerified: boolean } | null>;
  outletOf: (userId: number) => Promise<number | null>;
  outletCanViewCost: () => Promise<boolean>;
}) {
  return async (req: Request, res: Response): Promise<OutletScope | null> => {
    res.setHeader('Cache-Control', 'no-store');
    let scope: OutletScope | ScopeDenied;
    try {
      const user = await deps.identity(req);
      const viewer: FinanceViewer | null = user && {
        id: Number(user.id), role: user.role,
        // Placement as stored now, for access only; transactions keep their own outlet.
        outletId: user.role === 'OUTLET' ? await deps.outletOf(Number(user.id)) : null,
        warehouseGateVerified: Boolean((await deps.authenticate(req))?.warehouseGateVerified),
      };
      scope = resolveOutletScope(viewer, parseOutletIds(req.query?.outletIds ?? req.query?.outlet), viewer?.role === 'OUTLET' && await deps.outletCanViewCost());
    } catch { res.status(503).json({ error: 'Layanan verifikasi sesi tidak tersedia. Coba lagi.' }); return null; }
    if (isDenied(scope)) { res.status(scope.status).json({ error: scope.error, ...(scope.code ? { code: scope.code } : {}) }); return null; }
    return scope;
  };
}
