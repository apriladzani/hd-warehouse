import { decimal, money } from './decimal.ts';
import { inventoryReceiptAverage } from './warehouseSimpleFinance.ts';

// Period close ("tutup buku"): every stock opname ends one period. Closing stock
// and average of period N are the opening of period N+1. Sales never change the
// moving average; HPP uses the unit cost stored on the sale line when present.
// ref: purchase_items.id for a purchase, request_items.id for a sale.
// input: when it was entered (differs from at for a backdated receipt).
export type LedgerEvent = { at: number; order: number; ref?: number; input?: number } & (
  { kind: 'purchase'; quantity: number; price: string; averageAfter?: string | null } |
  { kind: 'sale'; quantity: number; outletId: number; sellPrice: string; unitCost: string | null } |
  { kind: 'correction'; quantity: number }
);
export type Balance = { stock: number; average: string | null };
export type OutletSales = { outletId: number; soldQuantity: number; cogs: string | null; sales: string; profit: string | null };
export type PeriodItem = {
  openingStock: number; openingAverage: string | null;
  inQuantity: number; inValue: string;
  correctionQuantity: number;
  soldQuantity: number; cogs: string | null; sales: string; missingCostQuantity: number;
  systemStock: number; physicalStock: number | null; difference: number | null; differenceValue: string | null;
  closingStock: number; closingAverage: string | null; closingValue: string | null;
  profit: string | null; outlets: OutletSales[];
};
export type LedgerPeriod = { end: number; physical: Map<number, number | null>; locked?: Map<number, PeriodItem> };

const ZERO = '0.000000';
const times = (quantity: number, value: string | null) => value === null ? null : money(BigInt(quantity) * decimal(value));
const add = (a: string | null, b: string | null) => a === null || b === null ? null : money(decimal(a) + decimal(b));
const minus = (a: string | null, b: string | null) => a === null || b === null ? null : money(decimal(a) - decimal(b));
const byTime = (a: LedgerEvent, b: LedgerEvent) => a.at - b.at || a.order - b.order;

export function rollPeriod(opening: Balance, events: LedgerEvent[], physical: number | null): PeriodItem {
  let stock = opening.stock, average = opening.average;
  let inQuantity = 0, inValue = ZERO, correctionQuantity = 0, soldQuantity = 0, sales = ZERO, cogs = ZERO, missingCostQuantity = 0;
  const outlets = new Map<number, { soldQuantity: number; cogs: string; sales: string; missing: number }>();
  for (const e of [...events].sort(byTime)) {
    if (!Number.isSafeInteger(e.quantity)) throw new Error('Invalid quantity');
    if (e.kind === 'purchase') {
      if (e.quantity <= 0) continue;
      inQuantity += e.quantity; inValue = money(decimal(inValue) + BigInt(e.quantity) * decimal(e.price));
      // A balance at or below zero has no cost left to blend with.
      average = stock <= 0 ? money(decimal(e.price)) : average === null ? null : inventoryReceiptAverage(stock, average, e.quantity, e.price);
      stock += e.quantity;
    } else if (e.kind === 'sale') {
      if (e.quantity <= 0) continue;
      const unit = e.unitCost ?? average;
      const outlet = outlets.get(e.outletId) ?? { soldQuantity: 0, cogs: ZERO, sales: ZERO, missing: 0 };
      const amount = money(BigInt(e.quantity) * decimal(e.sellPrice));
      soldQuantity += e.quantity; sales = add(sales, amount)!;
      outlet.soldQuantity += e.quantity; outlet.sales = add(outlet.sales, amount)!;
      if (unit === null) { missingCostQuantity += e.quantity; outlet.missing += e.quantity; }
      else { const cost = times(e.quantity, unit)!; cogs = add(cogs, cost)!; outlet.cogs = add(outlet.cogs, cost)!; }
      outlets.set(e.outletId, outlet);
      stock -= e.quantity;
    } else {
      correctionQuantity += e.quantity; stock += e.quantity;
    }
  }
  const totalCogs = missingCostQuantity ? null : cogs;
  const difference = physical === null ? null : physical - stock;
  const closingStock = physical ?? stock;
  return {
    openingStock: opening.stock, openingAverage: opening.average,
    inQuantity, inValue, correctionQuantity,
    soldQuantity, cogs: totalCogs, sales, missingCostQuantity,
    systemStock: stock, physicalStock: physical, difference, differenceValue: difference === null ? null : times(difference, average),
    closingStock, closingAverage: average, closingValue: times(closingStock, average),
    profit: minus(sales, totalCogs),
    outlets: [...outlets].sort((a, b) => a[0] - b[0]).map(([outletId, o]) => {
      const outletCogs = o.missing ? null : o.cogs;
      return { outletId, soldQuantity: o.soldQuantity, cogs: outletCogs, sales: o.sales, profit: minus(o.sales, outletCogs) };
    }),
  };
}

// Periods are ordered by end (opname cut-off). An event exactly at a cut-off
// belongs to the next period. A locked (snapshotted) period is never recomputed;
// its closing balance is what the next period starts from.
export function buildLedger(itemIds: number[], initial: Map<number, Balance>, events: Map<number, LedgerEvent[]>, periods: LedgerPeriod[]) {
  const closed = periods.map(() => new Map<number, PeriodItem>());
  const open = new Map<number, PeriodItem>();
  for (const itemId of itemIds) {
    const itemEvents = events.get(itemId) ?? [];
    let balance = initial.get(itemId) ?? { stock: 0, average: null };
    let start = -Infinity;
    periods.forEach((period, index) => {
      const row = period.locked?.get(itemId) ?? rollPeriod(balance, itemEvents.filter(e => e.at >= start && e.at < period.end), period.physical.get(itemId) ?? null);
      closed[index].set(itemId, row);
      balance = { stock: row.closingStock, average: row.closingAverage };
      start = period.end;
    });
    open.set(itemId, rollPeriod(balance, itemEvents.filter(e => e.at >= start), null));
  }
  return { closed, open };
}

// Stock before the first recorded movement, from today's stock minus every
// signed movement. The opening average is recovered from the first cost
// evidence: a stored sale cost, or the average recorded after the first receipt.
// Walked in input order: a recorded average is what the system saw when the
// receipt was entered, even if the receipt is dated earlier.
export function deriveOpening(currentStock: number, currentAverage: string | null, netMovements: number, events: LedgerEvent[]): Balance {
  const stock = currentStock - netMovements;
  if (stock <= 0) return { stock, average: ZERO };
  let running = stock;
  for (const e of [...events].sort((a, b) => (a.input ?? a.at) - (b.input ?? b.at) || a.order - b.order)) {
    if (e.kind === 'sale') { if (e.unitCost !== null) return { stock, average: e.unitCost }; running -= e.quantity; }
    else if (e.kind === 'correction') running += e.quantity;
    else if (e.quantity > 0) {
      if (running <= 0 || e.averageAfter == null) return { stock, average: null };
      const n = BigInt(running);
      const value = decimal(e.averageAfter) * BigInt(running + e.quantity) - BigInt(e.quantity) * decimal(e.price);
      return { stock, average: value < 0n ? null : money((value + n / 2n) / n) };
    }
  }
  return { stock, average: currentAverage };
}

// "Semua Periode": first opening, sums of flows, last closing.
export function combinePeriods(rows: PeriodItem[]): PeriodItem {
  const first = rows[0], last = rows[rows.length - 1];
  const sum = (pick: (r: PeriodItem) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const total = (pick: (r: PeriodItem) => string | null) => rows.reduce<string | null>((n, r) => add(n, pick(r)), ZERO);
  const counted = rows.filter(r => r.difference !== null);
  const outlets = new Map<number, OutletSales>();
  for (const o of rows.flatMap(r => r.outlets)) {
    const prev = outlets.get(o.outletId);
    outlets.set(o.outletId, prev ? { outletId: o.outletId, soldQuantity: prev.soldQuantity + o.soldQuantity, cogs: add(prev.cogs, o.cogs), sales: add(prev.sales, o.sales)!, profit: add(prev.profit, o.profit) } : { ...o });
  }
  return {
    openingStock: first.openingStock, openingAverage: first.openingAverage,
    inQuantity: sum(r => r.inQuantity), inValue: total(r => r.inValue)!, correctionQuantity: sum(r => r.correctionQuantity),
    soldQuantity: sum(r => r.soldQuantity), cogs: total(r => r.cogs), sales: total(r => r.sales)!, missingCostQuantity: sum(r => r.missingCostQuantity),
    systemStock: last.systemStock, physicalStock: null,
    difference: counted.length ? counted.reduce((n, r) => n + r.difference!, 0) : null,
    differenceValue: counted.length ? counted.reduce<string | null>((n, r) => add(n, r.differenceValue), ZERO) : null,
    closingStock: last.closingStock, closingAverage: last.closingAverage, closingValue: last.closingValue,
    profit: total(r => r.profit), outlets: [...outlets.values()].sort((a, b) => a.outletId - b.outletId),
  };
}

// Outlet filter: stock columns stay warehouse-wide; sales columns are the selected outlets only.
export function forOutlets(row: PeriodItem, outletIds?: number[]): PeriodItem {
  if (!outletIds?.length) return row;
  const picked = row.outlets.filter(o => outletIds.includes(o.outletId));
  const cogs = picked.reduce<string | null>((n, o) => add(n, o.cogs), ZERO);
  const sales = picked.reduce((n, o) => add(n, o.sales)!, ZERO);
  return { ...row, soldQuantity: picked.reduce((n, o) => n + o.soldQuantity, 0), cogs, sales, profit: minus(sales, cogs), missingCostQuantity: cogs === null ? row.missingCostQuantity : 0, outlets: picked };
}

// Closing check: the outlet breakdown must add up to the period total, otherwise
// a filtered report of a closed period would disagree with its unfiltered total.
export function outletTotalsMismatch(row: PeriodItem): string | null {
  const sold = row.outlets.reduce((n, o) => n + o.soldQuantity, 0);
  const sales = row.outlets.reduce((n, o) => add(n, o.sales)!, ZERO);
  const cogs = row.outlets.reduce<string | null>((n, o) => add(n, o.cogs), ZERO);
  const profit = row.outlets.reduce<string | null>((n, o) => add(n, o.profit), ZERO);
  if (sold !== row.soldQuantity) return `qty terjual ${sold} ≠ ${row.soldQuantity}`;
  if (decimal(sales) !== decimal(row.sales)) return `penjualan ${sales} ≠ ${row.sales}`;
  if ((cogs === null) !== (row.cogs === null) || (cogs !== null && decimal(cogs) !== decimal(row.cogs!))) return `HPP ${cogs} ≠ ${row.cogs}`;
  if ((profit === null) !== (row.profit === null) || (profit !== null && decimal(profit) !== decimal(row.profit!))) return `keuntungan ${profit} ≠ ${row.profit}`;
  return null;
}

// Moving-average order is transaction date, then input time. A transaction
// entered on its own date keeps its input time; a backdated one is placed at the
// end of its date (after everything entered on that day), a postdated one at the
// start. Ties keep input order through LedgerEvent.order.
const DAY = 86_400_000;
export function effectiveTime(inputMs: number, businessDate: string | null | undefined): number {
  const day = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return inputMs;
  const start = Date.parse(`${day}T00:00:00+07:00`);
  if (!Number.isFinite(inputMs)) return start + DAY - 1;
  return Math.min(Math.max(inputMs, start), start + DAY - 1);
}

// Open-period repricing after a backdated receipt: the average after every
// receipt and the cost of every sale, replayed in order from the opening balance.
// Stored sale costs are ignored on purpose; they are what is being corrected.
export function replayCosts(opening: Balance, events: LedgerEvent[]) {
  let stock = opening.stock, average = opening.average;
  const purchases = new Map<number, string | null>(), sales = new Map<number, string | null>();
  for (const e of [...events].sort(byTime)) {
    if (e.kind === 'purchase') {
      if (e.quantity <= 0) continue;
      average = stock <= 0 ? money(decimal(e.price)) : average === null ? null : inventoryReceiptAverage(stock, average, e.quantity, e.price);
      stock += e.quantity;
      if (e.ref != null) purchases.set(e.ref, average);
    } else if (e.kind === 'sale') {
      if (e.ref != null) sales.set(e.ref, average);
      stock -= e.quantity;
    } else stock += e.quantity;
  }
  return { purchases, sales, average };
}
