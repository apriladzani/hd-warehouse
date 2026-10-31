import { and, eq, sql } from 'drizzle-orm';
import { decimal, money } from '../finance/decimal.ts';
import { db, pool } from './index.ts';
import {
  items, purchaseItems, purchaseTransactions, requestItems, requests, stockMovements, stockOpnames,
  inventoryCostPeriods, inventoryCostSnapshots, financePeriodSnapshots, financePeriodOutletSnapshots,
} from './schema.ts';
import { buildLedger, combinePeriods, deriveOpening, effectiveTime, outletTotalsMismatch, replayCosts, type LedgerEvent, type LedgerPeriod, type PeriodItem } from '../finance/periodLedger.ts';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
// Correction of a closed period, recorded in the open period (reference KOR-SO-<opname id>).
export const PERIOD_CORRECTION = 'PERIOD_CORRECTION';

let schemaReady: Promise<void> | null = null;
export function ensurePeriodSnapshotSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_period_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stock_opname_id INT NOT NULL,
      item_id INT NOT NULL,
      period_start_at TIMESTAMP(3) NULL,
      period_end_at TIMESTAMP(3) NOT NULL,
      stok_awal INT NOT NULL,
      avg_awal DECIMAL(24,6) NULL,
      qty_masuk INT NOT NULL,
      nilai_masuk DECIMAL(24,6) NOT NULL,
      qty_koreksi INT NOT NULL DEFAULT 0,
      qty_terjual INT NOT NULL,
      total_hpp DECIMAL(24,6) NULL,
      total_penjualan DECIMAL(24,6) NOT NULL,
      missing_cost_qty INT NOT NULL DEFAULT 0,
      stok_sistem INT NOT NULL,
      stok_fisik INT NULL,
      selisih INT NULL,
      nilai_selisih DECIMAL(24,6) NULL,
      stok_akhir INT NOT NULL,
      avg_akhir DECIMAL(24,6) NULL,
      nilai_akhir DECIMAL(24,6) NULL,
      estimasi_keuntungan DECIMAL(24,6) NULL,
      source VARCHAR(20) NOT NULL,
      closed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      closed_by VARCHAR(255) NOT NULL,
      UNIQUE KEY uq_finance_period_snapshot (stock_opname_id, item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_period_outlet_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stock_opname_id INT NOT NULL,
      item_id INT NOT NULL,
      outlet_id INT NOT NULL,
      qty_terjual INT NOT NULL,
      total_hpp DECIMAL(24,6) NULL,
      total_penjualan DECIMAL(24,6) NOT NULL,
      estimasi_keuntungan DECIMAL(24,6) NULL,
      UNIQUE KEY uq_finance_period_outlet_snapshot (stock_opname_id, item_id, outlet_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

// Instants are read as epoch milliseconds computed by MySQL itself. Drizzle maps
// TIMESTAMP columns as UTC wall time, which is off by the session time zone.
const epoch = (column: unknown) => sql<string | null>`UNIX_TIMESTAMP(${column}) * 1000`;
function timestamp(ms: string | number | null | undefined, businessDate?: string | null): number {
  if (ms != null && Number.isFinite(Number(ms))) return Math.round(Number(ms));
  const day = String(businessDate || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00+07:00`).getTime() : NaN;
}
const dec = (value: unknown) => value == null ? null : typeof value === 'number' ? value.toFixed(6) : String(value);

export type ClosingPeriod = { opnameId: number; end: number; snapshot: { closedAt: string; closedBy: string; source: string } | null };
export type LedgerData = Awaited<ReturnType<typeof loadLedger>>;

// Replays every receipt, sale and correction from history. Snapshotted periods
// are taken as stored unless ignoreSnapshots (rebuild comparison) is set.
export async function loadLedger(executor: Executor = db, options: { ignoreSnapshots?: boolean } = {}) {
  await ensurePeriodSnapshotSchema();
  const itemRows = await executor.select({ id: items.id, stock: items.currentStock, average: items.avgPurchasePrice }).from(items).orderBy(items.id);
  const purchaseRows = await executor.select({
    id: purchaseItems.id, itemId: purchaseItems.itemId, quantity: purchaseItems.quantity, price: purchaseItems.price,
    averageAfter: purchaseItems.avgCostAfter, createdAt: epoch(purchaseTransactions.createdAt), date: purchaseTransactions.transactionDate,
  }).from(purchaseItems).innerJoin(purchaseTransactions, eq(purchaseItems.purchaseId, purchaseTransactions.id)).orderBy(purchaseItems.id);
  const saleRows = await executor.select({
    id: requestItems.id, itemId: requestItems.itemId, quantity: requestItems.approvedQuantity, price: requestItems.price,
    unitCost: requestItems.unitCostSnapshot, costSource: inventoryCostSnapshots.source, approvedAt: requestItems.approvedAt, outletId: requests.outletId,
    reference: requests.requestCode, createdAt: epoch(requests.createdAt), date: requests.requestDate,
  }).from(requestItems).innerJoin(requests, eq(requestItems.requestId, requests.id))
    .leftJoin(inventoryCostSnapshots, eq(inventoryCostSnapshots.requestItemId, requestItems.id))
    .where(and(eq(requestItems.status, 'Approved'), sql`${requestItems.approvedQuantity} > 0`)).orderBy(requestItems.id);
  const movementRows = await executor.select({
    id: stockMovements.id, itemId: stockMovements.itemId, kind: stockMovements.movementType, quantity: stockMovements.quantity,
    reference: stockMovements.referenceId, createdAt: epoch(stockMovements.createdAt),
  }).from(stockMovements).orderBy(stockMovements.id);
  const opnameRows = await executor.select({
    id: stockOpnames.id, createdAt: epoch(stockOpnames.createdAt), date: stockOpnames.examinationDate,
    cutoffAt: sql<string | null>`UNIX_TIMESTAMP(MAX(${inventoryCostPeriods.cutoffAt})) * 1000`,
  }).from(stockOpnames).leftJoin(inventoryCostPeriods, eq(inventoryCostPeriods.stockOpnameId, stockOpnames.id))
    .groupBy(stockOpnames.id, stockOpnames.createdAt, stockOpnames.examinationDate);
  const countRows = await executor.select({ opnameId: inventoryCostPeriods.stockOpnameId, itemId: inventoryCostPeriods.itemId, physical: inventoryCostPeriods.physicalStock }).from(inventoryCostPeriods);
  const snapshotRows = await executor.select({ row: financePeriodSnapshots, closedAt: epoch(financePeriodSnapshots.closedAt) }).from(financePeriodSnapshots);
  const outletRows = await executor.select().from(financePeriodOutletSnapshots);

  const events = new Map<number, LedgerEvent[]>();
  const push = (itemId: number, event: LedgerEvent) => { const list = events.get(itemId) ?? []; list.push(event); events.set(itemId, list); };
  for (const r of purchaseRows) push(r.itemId, { kind: 'purchase', at: effectiveTime(timestamp(r.createdAt, r.date), r.date), input: timestamp(r.createdAt, r.date), order: r.id, ref: r.id, quantity: Number(r.quantity), price: String(r.price), averageAfter: dec(r.averageAfter) });

  // The OUT movement is the authoritative sale time; approved_at is often date-only.
  const outByKey = new Map<string, typeof movementRows>();
  for (const m of movementRows) if (m.kind === 'OUT') { const key = `${m.itemId}|${m.reference}`; outByKey.set(key, [...(outByKey.get(key) ?? []), m]); }
  for (const r of saleRows) {
    const candidates = outByKey.get(`${r.itemId}|${r.reference}`) ?? [];
    const index = Math.max(candidates.findIndex(m => m.quantity === r.quantity), candidates.length ? 0 : -1);
    const movement = index >= 0 ? candidates.splice(index, 1)[0] : null;
    const at = movement ? timestamp(movement.createdAt) : r.approvedAt?.includes('T') ? new Date(r.approvedAt).getTime() : timestamp(r.createdAt, r.date);
    push(r.itemId, { kind: 'sale', at, order: 1_000_000_000 + r.id, ref: r.id, quantity: Number(r.quantity), outletId: Number(r.outletId ?? 0), sellPrice: String(r.price),
      // Only a cost captured at approval is the average of that moment; a later
      // RECONSTRUCTED/MISSING value is replaced by the replayed moving average.
      unitCost: r.costSource === 'SALE_APPROVAL' ? dec(r.unitCost) : null });
  }
  const net = new Map<number, number>();
  for (const m of movementRows) {
    net.set(m.itemId, (net.get(m.itemId) ?? 0) + (m.kind === 'OUT' ? -m.quantity : m.quantity));
    if (m.kind === PERIOD_CORRECTION) push(m.itemId, { kind: 'correction', at: timestamp(m.createdAt), order: 2_000_000_000 + m.id, quantity: m.quantity });
  }
  for (const [itemId, list] of events) if (list.some(e => !Number.isFinite(e.at))) throw new Error(`Waktu transaksi barang ID ${itemId} tidak lengkap; periode tidak dapat dihitung.`);

  const snapshotsByOpname = new Map<number, Map<number, PeriodItem>>();
  const meta = new Map<number, ClosingPeriod['snapshot']>();
  if (!options.ignoreSnapshots) {
    for (const { row: s, closedAt } of snapshotRows) {
      const outlets = outletRows.filter(o => o.stockOpnameId === s.stockOpnameId && o.itemId === s.itemId)
        .map(o => ({ outletId: o.outletId, soldQuantity: o.qtyTerjual, cogs: o.totalHpp, sales: o.totalPenjualan, profit: o.estimasiKeuntungan }));
      const map = snapshotsByOpname.get(s.stockOpnameId) ?? new Map<number, PeriodItem>();
      map.set(s.itemId, {
        openingStock: s.stokAwal, openingAverage: s.avgAwal, inQuantity: s.qtyMasuk, inValue: s.nilaiMasuk, correctionQuantity: s.qtyKoreksi,
        soldQuantity: s.qtyTerjual, cogs: s.totalHpp, sales: s.totalPenjualan, missingCostQuantity: s.missingCostQty,
        systemStock: s.stokSistem, physicalStock: s.stokFisik, difference: s.selisih, differenceValue: s.nilaiSelisih,
        closingStock: s.stokAkhir, closingAverage: s.avgAkhir, closingValue: s.nilaiAkhir, profit: s.estimasiKeuntungan, outlets,
      });
      snapshotsByOpname.set(s.stockOpnameId, map);
      meta.set(s.stockOpnameId, { closedAt: new Date(timestamp(closedAt)).toISOString(), closedBy: s.closedBy, source: s.source });
    }
  }

  const periods: ClosingPeriod[] = opnameRows.map(r => ({ opnameId: r.id, end: timestamp(r.cutoffAt || r.createdAt, r.date), snapshot: meta.get(r.id) ?? null }))
    .filter(p => Number.isFinite(p.end)).sort((a, b) => a.end - b.end || a.opnameId - b.opnameId);
  const ledgerPeriods: LedgerPeriod[] = periods.map(p => ({
    end: p.end,
    physical: new Map(countRows.filter(c => c.opnameId === p.opnameId).map(c => [c.itemId, Number(c.physical)])),
    locked: snapshotsByOpname.get(p.opnameId),
  }));
  const itemIds = itemRows.map(r => r.id);
  const initial = new Map(itemRows.map(r => [r.id, deriveOpening(Number(r.stock), dec(r.average), net.get(r.id) ?? 0, events.get(r.id) ?? [])]));
  const firstTransaction = [...events.values()].flat().filter(e => e.kind !== 'correction').reduce((min, e) => Math.min(min, e.at), Infinity);
  return { itemIds, periods, events, firstTransaction: Number.isFinite(firstTransaction) ? firstTransaction : null, ...buildLedger(itemIds, initial, events, ledgerPeriods) };
}

// Rows for a dashboard period: a closing opname, the open period, or all of them.
export function ledgerRows(data: LedgerData, opnameId: number | null | 'all') {
  if (opnameId === 'all') return new Map(data.itemIds.map(id => [id, combinePeriods([...data.closed.map(p => p.get(id)!), data.open.get(id)!])]));
  if (opnameId === null) return data.open;
  const index = data.periods.findIndex(p => p.opnameId === opnameId);
  if (index < 0) throw new Error('Periode Stock Opname tidak ditemukan.');
  return data.closed[index];
}

// Insert-only. Existing rows of an opname are never overwritten.
export async function saveSnapshot(executor: Executor, data: LedgerData, opnameId: number, source: 'CLOSING' | 'REBUILD', closedBy: string) {
  const index = data.periods.findIndex(p => p.opnameId === opnameId);
  if (index < 0) throw new Error('Periode Stock Opname tidak ditemukan.');
  const [existing] = await executor.select({ id: financePeriodSnapshots.id }).from(financePeriodSnapshots).where(eq(financePeriodSnapshots.stockOpnameId, opnameId)).limit(1);
  if (existing) return false;
  const instant = (ms: number) => sql`FROM_UNIXTIME(${ms / 1000})`;
  const start = index > 0 ? instant(data.periods[index - 1].end) : null;
  const end = instant(data.periods[index].end);
  const rows = [...data.closed[index]];
  if (!rows.length) return false;
  for (const [itemId, row] of rows) {
    const mismatch = outletTotalsMismatch(row);
    if (mismatch) throw new Error(`Tutup periode dibatalkan: rincian per outlet barang ID ${itemId} tidak sama dengan total (${mismatch}).`);
  }
  await executor.insert(financePeriodSnapshots).values(rows.map(([itemId, r]) => ({
    stockOpnameId: opnameId, itemId, periodStartAt: start, periodEndAt: end,
    stokAwal: r.openingStock, avgAwal: r.openingAverage, qtyMasuk: r.inQuantity, nilaiMasuk: r.inValue, qtyKoreksi: r.correctionQuantity,
    qtyTerjual: r.soldQuantity, totalHpp: r.cogs, totalPenjualan: r.sales, missingCostQty: r.missingCostQuantity,
    stokSistem: r.systemStock, stokFisik: r.physicalStock, selisih: r.difference, nilaiSelisih: r.differenceValue,
    stokAkhir: r.closingStock, avgAkhir: r.closingAverage, nilaiAkhir: r.closingValue, estimasiKeuntungan: r.profit,
    source, closedBy: closedBy.slice(0, 255),
  })));
  const outletValues = rows.flatMap(([itemId, r]) => r.outlets.map(o => ({
    stockOpnameId: opnameId, itemId, outletId: o.outletId, qtyTerjual: o.soldQuantity, totalHpp: o.cogs, totalPenjualan: o.sales, estimasiKeuntungan: o.profit,
  })));
  if (outletValues.length) await executor.insert(financePeriodOutletSnapshots).values(outletValues);
  return true;
}

// After a backdated receipt in the open period: rewrite the stored average after
// each later receipt, each sale's HPP and the Inventory average. Only events after
// the last closing are touched, so closed snapshots stay exactly as they were.
export async function repriceOpenPeriod(executor: Executor, itemIds: number[]) {
  const data = await loadLedger(executor);
  const lastEnd = data.periods.length ? data.periods[data.periods.length - 1].end : -Infinity;
  for (const itemId of new Set(itemIds)) {
    const open = data.open.get(itemId);
    if (!open) continue;
    const events = (data.events.get(itemId) ?? []).filter(e => e.at >= lastEnd);
    const replay = replayCosts({ stock: open.openingStock, average: open.openingAverage }, events);
    for (const [ref, averageAfter] of replay.purchases) if (averageAfter !== null) await executor.update(purchaseItems).set({ avgCostAfter: Number(averageAfter) }).where(eq(purchaseItems.id, ref));
    for (const e of events) {
      if (e.kind !== 'sale' || e.ref == null) continue;
      const unitCost = replay.sales.get(e.ref) ?? null;
      if (unitCost === null) continue;
      const cogs = money(BigInt(e.quantity) * decimal(unitCost));
      const sales = money(BigInt(e.quantity) * decimal(e.sellPrice));
      await executor.update(requestItems).set({ unitCostSnapshot: Number(unitCost) }).where(eq(requestItems.id, e.ref));
      const values = { unitCost: Number(unitCost), cogsAmount: Number(cogs), profitAmount: Number(money(decimal(sales) - decimal(cogs))), source: 'SALE_APPROVAL' };
      const [existing] = await executor.select({ id: inventoryCostSnapshots.id }).from(inventoryCostSnapshots).where(eq(inventoryCostSnapshots.requestItemId, e.ref)).limit(1);
      if (existing) await executor.update(inventoryCostSnapshots).set(values).where(eq(inventoryCostSnapshots.id, existing.id));
      else await executor.insert(inventoryCostSnapshots).values({ requestItemId: e.ref, itemId, approvedQuantity: e.quantity, salesAmount: Number(sales), ...values });
    }
    if (replay.average !== null) await executor.update(items).set({ avgPurchasePrice: Number(replay.average) }).where(eq(items.id, itemId));
  }
}
