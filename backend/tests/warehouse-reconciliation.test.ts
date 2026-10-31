import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWarehouseStock } from '../src/finance/warehouseReconciliation.ts';
import { approvalHpp } from '../src/finance/approvalHpp.ts';
test('old18 plus receipts50 minus outgoing5 reconciles Inventory63', () => {
  const r = reconcileWarehouseStock(18,50,[{ at: 110,kind:'IN',quantity:50,reference:'P' },{ at:120,kind:'OUT',quantity:5,reference:'R' }],100,200,63);
  assert.equal(r.closing,63); assert.equal(r.matchesInventory,true); assert.deepEqual(r.reasons,[]);
});
test('unknown opening is not reverse-engineered from current Inventory', () => {
  const r = reconcileWarehouseStock(null,50,[{ at:110,kind:'IN',quantity:50,reference:'P' },{ at:120,kind:'OUT',quantity:5,reference:'R' }],100,200,63);
  assert.equal(r.closing,null); assert.ok(r.reasons.length);
});
test('opname adjustment at opening is not counted twice; in-period adjustments are included', () => {
  const r = reconcileWarehouseStock(5,0,[{ at:100,kind:'STOCK_OPNAME_ADJUSTMENT',quantity:-20,reference:'SO-1' },{ at:120,kind:'STOCK_OPNAME_ADJUSTMENT',quantity:2,reference:'SO-2' }],100,200,7,new Set(['SO-1']));
  assert.equal(r.closing,7); assert.equal(r.adjustment,2);
});
test('mismatched incoming ledger or Inventory makes closing unverified; historical balances do not compare current stock', () => {
  const movements = [{ at:110,kind:'IN',quantity:50,reference:'P' }];
  assert.equal(reconcileWarehouseStock(5,40,movements,100,200,45).closing,null);
  assert.equal(reconcileWarehouseStock(5,50,movements,100,200,63).closing,null);
  assert.equal(reconcileWarehouseStock(5,50,movements,100,200,null).closing,55);
});
test('HPP multiplies sold quantity by approval unit cost, never by current average or inventory value', () => {
  assert.deepEqual(approvalHpp(5,'23346.153800',[{ quantity:5,unitCost:'23346.153800',source:'SALE_APPROVAL' }]),{unitCost:'23346.153800',amount:'116730.769000'});
  assert.equal(approvalHpp(5,null,[{quantity:5,unitCost:'23346.153800',source:'RECONSTRUCTED'}]),null);
  assert.equal(approvalHpp(5,'28000',[{quantity:5,unitCost:'23000',source:'SALE_APPROVAL'}]),null);
  assert.equal(approvalHpp(5,null,[{quantity:6,unitCost:'23000',source:'SALE_APPROVAL'}]),null);
});
