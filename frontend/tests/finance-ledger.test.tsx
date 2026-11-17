import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRupiah, unitName } from '../src/finance/ledgerInput.ts';

test('Rupiah as Finance types it becomes the ledger decimal', () => {
  for (const [typed, ledger] of [['3.500.000', '3500000'], ['Rp 3.500.000', '3500000'], ['3500000', '3500000'], ['1.250,50', '1250.50'], ['750', '750'], ['0,5', '0.5']] as const) assert.equal(parseRupiah(typed), ledger, typed);
  for (const bad of ['', '0', '0,00', '-5', '3.50.000', '1,2,3', 'abc', '1e3', '1,1234567', '1234567890123456789']) assert.equal(parseRupiah(bad), null, bad);
});

test('units show the outlet name', () => {
  const outlets = [{ id: 4, name: 'Cibubur' }];
  assert.equal(unitName({ type: 'OUTLET', outletId: 4 }, outlets), 'Cibubur');
  assert.equal(unitName({ type: 'OUTLET', outletId: 9 }, outlets), 'Outlet #9');
  assert.equal(unitName({ type: 'WAREHOUSE' }, outlets), 'Warehouse');
});

const filter = { mode: 'OUTLET' as const, startDate: '2026-11-01', endDate: '2026-11-17', outletIds: null, timezone: 'Asia/Jakarta' as const };
const accounts = { persistenceEnabled: true, accounts: [{ code: 'LC01', name: 'Salary', group: 'LC' }, { code: 'DA01', name: 'Depreciation', group: 'DA01' }] };

