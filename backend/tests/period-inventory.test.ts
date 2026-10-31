import test from 'node:test';
import assert from 'node:assert/strict';
import { periodInventory, type InventoryEvent } from '../src/finance/periodInventory.ts';
const cutoff: InventoryEvent = { at: 100, order: 0, kind: 'cutoff', quantity: 5, average: '10000.000000' };
test('5 physical units carry unchanged cost into new period; receipts blend with opening value', () => {
  const result = periodInventory([cutoff, { at: 120, order: 1, kind: 'purchase', quantity: 5, price: '20000' }], 100, 150);
  assert.deepEqual(result.opening, { quantity: 5, average: '10000.000000' });
  assert.deepEqual(result.closing, { quantity: 10, average: '15000.000000' });
});
test('zero physical stock resets opening average, receipt begins a new valuation', () => {
  const zero: InventoryEvent = { ...cutoff, quantity: 0, average: '10000' };
  assert.deepEqual(periodInventory([zero], 100, 150).opening, { quantity: 0, average: '0.000000' });
  assert.deepEqual(periodInventory([zero, { at: 110, order: 1, kind: 'purchase', quantity: 2, price: '17000' }], 100, 150).closing, { quantity: 2, average: '17000.000000' });
});
test('sales reduce weighting stock and do not change cost; end cut-off belongs to next period', () => {
  const events: InventoryEvent[] = [cutoff, { at: 110, order: 1, kind: 'sale', quantity: 3 }, { at: 120, order: 2, kind: 'purchase', quantity: 2, price: '20000' }, { ...cutoff, at: 150, quantity: 0 }];
  assert.deepEqual(periodInventory(events, 100, 150).closing, { quantity: 4, average: '15000.000000' });
  assert.deepEqual(periodInventory(events, 150, 200).opening, { quantity: 0, average: '0.000000' });
});
test('unknown opening is not zero, missing positive-stock cost stays unknown; no mutation', () => {
  const events: InventoryEvent[] = [{ ...cutoff, average: null }]; const before = JSON.stringify(events);
  assert.equal(periodInventory([], 100, 150).opening.quantity, null);
  assert.equal(periodInventory(events, 100, 150).opening.average, null);
  assert.equal(JSON.stringify(events), before);
});

test('historical period ignores later receipts and later zero-stock reset', () => {
  const events: InventoryEvent[] = [cutoff, { at: 120, order: 1, kind: 'purchase', quantity: 5, price: '20000' }, { ...cutoff, at: 200, quantity: 0 }, { at: 210, order: 2, kind: 'purchase', quantity: 1, price: '99000' }];
  assert.equal(periodInventory(events, 100, 150).closing.average, '15000.000000');
  assert.equal(periodInventory(events, 200, 250).closing.average, '99000.000000');
  assert.equal(periodInventory(events, 200, 250).opening.average, '0.000000');
});
test('missing snapshot, missing cutoff price, invalid event time and overselling explain unknown values', () => {
  assert.match(periodInventory([], 100, 150).openingReasons[0], /cut-off/);
  assert.match(periodInventory([{ ...cutoff, average: null }], 100, 150).closingReasons[0], /Harga rata-rata snapshot/);
  const invalid = periodInventory([cutoff, { at: NaN, order: 1, kind: 'sale', quantity: 1 }], 100, 150);
  assert.equal(invalid.closing.average, null); assert.match(invalid.closingReasons[0], /timestamp/);
  const excess = periodInventory([cutoff, { at: 110, order: 1, kind: 'sale', quantity: 6 }], 100, 150);
  assert.equal(excess.closing.average, null); assert.match(excess.closingReasons[0], /melebihi/);
});
test('receipt-only weighted mean uses exact decimals and no master fallback', async () => {
  const { weightedReceiptAverage } = await import('../src/finance/periodInventory.ts');
  assert.equal(weightedReceiptAverage('1500000', 50), '30000.000000');
  assert.equal(weightedReceiptAverage('0', 0), null);
  assert.equal(weightedReceiptAverage('0', 5), '0.000000');
  assert.equal(weightedReceiptAverage('1', 3), '0.333333');
  assert.equal(weightedReceiptAverage('9007199254740993', 1), '9007199254740993.000000');
});
