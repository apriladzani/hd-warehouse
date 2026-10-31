import { sumMoney } from '../../../backend/src/finance/decimal.ts';
import type { WarehouseItemProfitability } from '../types.ts';
// Period values from the backend ledger: HPP is each sale's cost at the moment of
// sale, never quantity × today's Inventory average. null means unknown, not zero.
export function warehouseEstimate(row: WarehouseItemProfitability) {
  return { sales: row.totalSellingAmountExact ?? null, cost: row.totalCogsAmountExact ?? null, profit: row.totalProfitExact ?? null };
}
export function warehouseEstimateTotals(rows: WarehouseItemProfitability[]) {
  const estimates = rows.map(warehouseEstimate);
  return {
    cost: estimates.some(e => e.cost === null) ? null : sumMoney(estimates.map(e => e.cost!)),
    sales: estimates.some(e => e.sales === null) ? null : sumMoney(estimates.map(e => e.sales!)),
    profit: estimates.some(e => e.profit === null) ? null : sumMoney(estimates.map(e => e.profit!)),
  };
}
