import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseRupiah, unitName } from '../src/finance/ledgerInput.ts';
import { TransactionManager, createTransactionGateway } from '../src/finance/TransactionManager.tsx';
import { MissingInputs } from '../src/finance/FinanceWorkspace.tsx';

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

test('with the ledger enabled the form can be added to, without the not-enabled notice', () => {
  const gateway = { list: async () => [], create: async () => { throw new Error(); }, change: async () => {} };
  const html = renderToStaticMarkup(<TransactionManager da={false} accounts={accounts} outlets={[]} filter={filter} gateway={gateway} />);
  assert.ok(html.includes('Tambah Transaksi'));
  assert.ok(!html.includes('Persistence transaksi belum diaktifkan'));
});

test('the gateway posts to the ledger API and returns the saved transaction', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const saved = { id: 'abc', date: '2026-11-17', unit: { type: 'OUTLET', outletId: 4 }, accountCode: 'LC01', amount: '3500000.000000', notes: 'Gaji', reference: 'SLIP', status: 'draft', nature: 'EXTERNAL', counterparty: null, idempotencyKey: 'k'.repeat(20), legacyEntryId: null, version: 1 };
  const gateway = createTransactionGateway(async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ transaction: saved }), { status: 201, headers: { 'content-type': 'application/json' } }); });
  const created = await gateway.create({});
  assert.deepEqual([created.id, created.amount], ['abc', '3500000.000000']);
  await gateway.change('abc', 'post', 1, 'ok');
  assert.deepEqual(calls.map(c => [c.init?.method, c.url]), [['POST', '/api/finance/v2/transactions'], ['POST', '/api/finance/v2/transactions/abc/post']]);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { version: 1, reason: 'ok' });
});

test('units without input are named with the costs counted as Rp0', () => {
  const report = { notices: [{ unit: { type: 'OUTLET', outletId: 4 }, metrics: ['LC', 'LP', 'DA01'] }, { unit: { type: 'WAREHOUSE' }, metrics: ['DA01'] }] } as any;
  const html = renderToStaticMarkup(<MissingInputs report={report} keys={['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX']} outlets={[{ id: 4, name: 'Cibubur' }]} />);
  assert.ok(html.includes('1 unit belum ada input'));
  assert.ok(html.includes('Cibubur'));
  assert.ok(html.includes('Labor Cost') && html.includes('Rent'));
  assert.ok(!html.includes('Depreciation'), 'DA notices belong to the DA page');
  assert.equal(renderToStaticMarkup(<MissingInputs report={{ notices: [] } as any} keys={['LC']} outlets={[]} />), '');
});
