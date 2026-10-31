import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, combinePeriods, deriveOpening, effectiveTime, forOutlets, replayCosts, rollPeriod, type LedgerEvent, type LedgerPeriod } from '../src/finance/periodLedger.ts';

const sale = (at: number, quantity: number, outletId = 1, unitCost: string | null = null, sellPrice = '30000'): LedgerEvent => ({ at, order: at, kind: 'sale', quantity, outletId, sellPrice, unitCost });
const purchase = (at: number, quantity: number, price: string): LedgerEvent => ({ at, order: at, kind: 'purchase', quantity, price });
const period = (end: number, physical: number | null, locked?: LedgerPeriod['locked']): LedgerPeriod => ({ end, physical: new Map([[1, physical]]), locked });

test('a. period 2 opens with period 1 physical count, not live stock', () => {
  const { closed, open } = buildLedger([1], new Map([[1, { stock: 50, average: '20000.000000' }]]), new Map([[1, [sale(10, 30)]]]), [period(100, 20)]);
  const p1 = closed[0].get(1)!;
  assert.deepEqual([p1.openingStock, p1.inQuantity, p1.soldQuantity, p1.systemStock, p1.physicalStock, p1.difference, p1.closingStock], [50, 0, 30, 20, 20, 0, 20]);
  assert.equal(open.get(1)!.openingStock, 20);
});

test('b. opname mismatch: system 20, physical 18 → difference −2, next period starts at 18', () => {
  const { closed, open } = buildLedger([1], new Map([[1, { stock: 50, average: '1000.000000' }]]), new Map([[1, [sale(10, 30)]]]), [period(100, 18)]);
  const p1 = closed[0].get(1)!;
  assert.deepEqual([p1.systemStock, p1.difference, p1.closingStock, p1.differenceValue], [20, -2, 18, '-2000.000000']);
  assert.equal(open.get(1)!.openingStock, 18);
});

test('c. a locked period is unchanged by later purchases and sales', () => {
  const history = [purchase(5, 10, '25000'), sale(10, 5)];
  const opening = new Map([[1, { stock: 10, average: '20000.000000' }]]);
  const first = buildLedger([1], opening, new Map([[1, history]]), [period(100, 15)]).closed[0];
  const later = [...history, purchase(150, 100, '99000'), sale(160, 50, 1, '50000.000000')];
  const { closed, open } = buildLedger([1], opening, new Map([[1, later]]), [period(100, 15, first)]);
  assert.deepEqual(closed[0].get(1), first.get(1));
  assert.equal(open.get(1)!.openingStock, 15);
  assert.equal(open.get(1)!.openingAverage, first.get(1)!.closingAverage);
});

test('d. Ayam Mentah: 53 @ 28.627 + 10 @ 25.000, sell 45, physical 17', () => {
  const row = rollPeriod({ stock: 53, average: '28627.000000' }, [purchase(1, 10, '25000'), sale(2, 45, 1, null, '35000')], 17);
  assert.equal(row.closingAverage, '28051.285714'); // Rp28.051,29
  assert.equal(row.cogs, '1262307.857130'); // Rp1.262.308
  assert.equal(Math.round(Number(row.cogs)), 1262308);
  assert.deepEqual([row.systemStock, row.physicalStock, row.difference, row.closingStock], [18, 17, -1, 17]);
  assert.equal(row.profit, '312692.142870');
});

test('stored sale cost wins over running average; sales do not move the average', () => {
  const row = rollPeriod({ stock: 10, average: '100.000000' }, [sale(1, 2, 1, '90.000000'), sale(2, 3)], null);
  assert.equal(row.cogs, '480.000000');
  assert.equal(row.closingAverage, '100.000000');
  assert.equal(row.closingStock, 5);
});

test('e. outlet filter splits sales per outlet, stock stays warehouse-wide', () => {
  const row = rollPeriod({ stock: 50, average: '1000.000000' }, [sale(1, 10, 1), sale(2, 20, 2), sale(3, 5, 1)], 15);
  const one = forOutlets(row, [1]), two = forOutlets(row, [2]);
  assert.deepEqual([one.soldQuantity, one.cogs, two.soldQuantity, two.cogs], [15, '15000.000000', 20, '20000.000000']);
  assert.equal(one.closingStock, 15); assert.equal(two.closingStock, 15);
  assert.equal(forOutlets(row).soldQuantity, 35);
});

test('missing cost leaves HPP and profit unknown instead of zero', () => {
  const row = rollPeriod({ stock: 5, average: null }, [sale(1, 2)], null);
  assert.equal(row.cogs, null); assert.equal(row.profit, null); assert.equal(row.missingCostQuantity, 2);
  assert.equal(rollPeriod({ stock: 0, average: null }, [purchase(1, 4, '500'), sale(2, 1)], null).cogs, '500.000000');
});

test('corrections in the open period change system stock and are kept separate', () => {
  const row = rollPeriod({ stock: 18, average: '1000.000000' }, [{ at: 1, order: 1, kind: 'correction', quantity: -2 }], null);
  assert.deepEqual([row.correctionQuantity, row.systemStock, row.closingStock], [-2, 16, 16]);
});

test('opening balance is derived from current stock and the first cost evidence', () => {
  assert.deepEqual(deriveOpening(20, '1.000000', -30, []), { stock: 50, average: '1.000000' });
  assert.deepEqual(deriveOpening(63, null, 10, [{ ...purchase(1, 10, '25000'), averageAfter: '28051.285714' }]), { stock: 53, average: '28627.000000' });
  assert.deepEqual(deriveOpening(5, null, -5, [sale(1, 5, 1, '700.000000')]), { stock: 10, average: '700.000000' });
  assert.equal(deriveOpening(0, '5.000000', 0, []).stock, 0);
});

test('all periods: first opening, summed flows, last closing', () => {
  const { closed, open } = buildLedger([1], new Map([[1, { stock: 50, average: '1000.000000' }]]), new Map([[1, [sale(10, 30), purchase(150, 5, '1000'), sale(160, 3)]]]), [period(100, 18)]);
  const all = combinePeriods([closed[0].get(1)!, open.get(1)!]);
  assert.deepEqual([all.openingStock, all.inQuantity, all.soldQuantity, all.difference, all.closingStock], [50, 5, 33, -2, 20]);
});

test('order is transaction date, then input time', () => {
  const day = (d: string, hm = '00:00') => Date.parse(`${d}T${hm}:00+07:00`);
  const entered = day('2026-10-31', '10:00');
  assert.equal(effectiveTime(entered, '2026-10-31'), entered); // same day: input time
  assert.equal(effectiveTime(entered, '2026-10-29'), day('2026-10-30') - 1); // backdated: end of its date
  assert.equal(effectiveTime(entered, '2026-11-02'), day('2026-11-02')); // postdated: start of its date
  // A same-day sale entered on the 29th stays before a receipt backdated to the 29th.
  assert.ok(effectiveTime(day('2026-10-29', '15:00'), '2026-10-29') < effectiveTime(entered, '2026-10-29'));
  assert.equal(effectiveTime(entered, null), entered);
});

test('ii. a backdated receipt before a sale reprices that sale', () => {
  const opening = { stock: 10, average: '10000.000000' };
  const sale: LedgerEvent = { at: 300, order: 3, ref: 77, kind: 'sale', quantity: 4, outletId: 1, sellPrice: '15000', unitCost: '10000.000000' };
  const backdated: LedgerEvent = { at: 200, order: 4, ref: 9, kind: 'purchase', quantity: 10, price: '20000' };
  assert.equal(replayCosts(opening, [sale]).sales.get(77), '10000.000000');
  const replay = replayCosts(opening, [sale, backdated]);
  assert.equal(replay.purchases.get(9), '15000.000000');
  assert.equal(replay.sales.get(77), '15000.000000'); // stored 10.000 is replaced
  assert.equal(replay.average, '15000.000000');
  // A receipt dated after the sale does not touch it.
  assert.equal(replayCosts(opening, [sale, { ...backdated, at: 400 }]).sales.get(77), '10000.000000');
});
