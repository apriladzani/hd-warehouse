// Value of stock on the current-stock page: current stock × moving average.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stockValuation } from '../src/finance/stockValue.ts';
import { inventoryReceiptAverage } from '../src/finance/warehouseSimpleFinance.ts';

test('the example from the spec: 89 pcs at Rp11.000 is worth Rp979.000', () => {
  assert.deepEqual(stockValuation(89, '11000.000000', true), { avgCost: 11000, stockValue: 979000 });
});

test('two purchases: the average moves, and the value follows it', () => {
  const first = inventoryReceiptAverage(0, '0', 100, '20000');
  assert.equal(first, '20000.000000', 'from zero stock the average is the purchase price');
  const second = inventoryReceiptAverage(100, first, 50, '30000');
  assert.equal(second, '23333.333333', '(100 × 20.000 + 50 × 30.000) ÷ 150');
  assert.deepEqual(stockValuation(150, second, true), { avgCost: 23333.333333, stockValue: 3500000 });
});

test('a sale changes the stock, not the average', () => {
  const average = '23333.333333';
  assert.equal(stockValuation(147, average, true).avgCost, 23333.333333);
  // 147 × 23.333,333333 = 3.429.999,99995 → rounded half-up to whole rupiah.
  assert.equal(stockValuation(147, average, true).stockValue, 3430000);
});

test('stock 0 (Habis) is worth Rp0 and still shows its average', () => {
  assert.deepEqual(stockValuation(0, '11000.000000', true), { avgCost: 11000, stockValue: 0 });
  assert.deepEqual(stockValuation(-2, '11000.000000', true), { avgCost: 11000, stockValue: 0 }, 'never negative');
  assert.equal(inventoryReceiptAverage(0, '11000.000000', 10, '15000'), '15000.000000', 'buying into zero stock resets the average to the new price');
});

test('an item never bought has no price: null, not Rp0', () => {
  assert.deepEqual(stockValuation(25, '0', false), { avgCost: null, stockValue: null });
  // Even if the stored column holds a number, no purchase means no cost basis.
  assert.deepEqual(stockValuation(25, '12000.000000', false), { avgCost: null, stockValue: null });
  assert.deepEqual(stockValuation(25, null, true), { avgCost: null, stockValue: null });
});

test('goods bought at zero cost do have a price, and it is Rp0', () => {
  assert.deepEqual(stockValuation(5, '0.000000', true), { avgCost: 0, stockValue: 0 });
});

test('the driver may hand the average back as a number', () => {
  assert.deepEqual(stockValuation(3, 20000, true), { avgCost: 20000, stockValue: 60000 });
});
