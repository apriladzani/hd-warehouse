import test from 'node:test';
import assert from 'node:assert/strict';
import { nextValueSort, sortByStockValue, totalStockValue } from '../src/lib/stockValue.ts';

const items = [
  { itemCode: 'RM-1', category: 'Raw Material', stockValue: 979000 },
  { itemCode: 'RM-2', category: 'Raw Material', stockValue: 0 },        // Habis: worth Rp0
  { itemCode: 'SM-1', category: 'Support Material', stockValue: 250000 },
  { itemCode: 'PK-1', category: 'Packaging', stockValue: null },          // never bought
  { itemCode: 'PK-2', category: 'Packaging', stockValue: 40000 },
];

test('the total adds the priced rows and counts the unpriced ones separately', () => {
  assert.deepEqual(totalStockValue(items), { total: 1269000, unpriced: 1 });
  assert.deepEqual(totalStockValue([]), { total: 0, unpriced: 0 });
});

test('the total follows the Kategori filter', () => {
  const only = (category: string) => totalStockValue(items.filter((item) => item.category === category));
  assert.deepEqual(only('Raw Material'), { total: 979000, unpriced: 0 });
  assert.deepEqual(only('Packaging'), { total: 40000, unpriced: 1 }, 'an unpriced item adds nothing, and is reported');
  assert.deepEqual(only('Support Material'), { total: 250000, unpriced: 0 });
});

test('Nilai Stok sorts highest or lowest first, and an unpriced item always sinks', () => {
  assert.deepEqual(sortByStockValue(items, 'desc').map((item) => item.itemCode), ['RM-1', 'SM-1', 'PK-2', 'RM-2', 'PK-1']);
  assert.deepEqual(sortByStockValue(items, 'asc').map((item) => item.itemCode), ['RM-2', 'PK-2', 'SM-1', 'RM-1', 'PK-1']);
  assert.equal(sortByStockValue(items, 'none'), items, 'no sort keeps the page order');
  assert.deepEqual(['none', 'desc', 'asc'].map((state) => nextValueSort(state as any)), ['desc', 'asc', 'none']);
});
