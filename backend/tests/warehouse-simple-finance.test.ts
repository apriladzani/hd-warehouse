import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryReceiptAverage, opnameAverage, simpleWarehouseFinance } from '../src/finance/warehouseSimpleFinance.ts';
test('opname carries cycle cost with residual stock and resets only physical zero', () => {
  assert.equal(opnameAverage(5,'10000'),'10000.000000');
  assert.equal(opnameAverage(0,'10000'),'0.000000');
  assert.equal(inventoryReceiptAverage(0,'0',5,'20000'),'20000.000000');
  assert.equal(inventoryReceiptAverage(5,'10000',5,'20000'),'15000.000000');
  assert.equal(opnameAverage(5,opnameAverage(5,'10000')),'10000.000000');
});
test('catalog revenue and historical COGS produce immutable-cost profit, never current-cost backfill', () => {
  const r = simpleWarehouseFinance(5,'45000','116730.769000','28626.984000');
  assert.equal(r.sales,'225000.000000'); assert.equal(r.average,'23346.153800');
  assert.equal(r.profit,'108269.231000');
  assert.equal(simpleWarehouseFinance(5,'45000',null,'28626.984000').profit,null);
  assert.equal(simpleWarehouseFinance(0,'45000',null,'0.000000').profit,'0.000000');
});

test('current Inventory average is visible even when historical sale cost is missing', async () => {
  const { displayedWarehouseAverage } = await import('../src/finance/warehouseSimpleFinance.ts');
  const missing = simpleWarehouseFinance(5, '45000', null, '28626.984000');
  assert.equal(missing.profit, null);
  assert.equal(displayedWarehouseAverage(false, '28626.984000', missing.average, null), '28626.984000');
  assert.equal(displayedWarehouseAverage(false, '0.000000', null, null), '0.000000');
  assert.equal(displayedWarehouseAverage(true, '28626.984000', '23346.153800', null), '23346.153800');
  assert.equal(displayedWarehouseAverage(true, '28626.984000', null, null), null);
});
