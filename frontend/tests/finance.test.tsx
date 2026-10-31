import { WarehouseFinanceTable } from '../src/components/warehouse/WarehouseFinanceTable.tsx';
import { TransactionManager } from '../src/finance/TransactionManager.tsx';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import type { User } from '../src/types.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinanceAggregationService } from '../../backend/src/finance/FinanceAggregationService.ts';
import { createFinanceClient, FinanceApiError, validateReport } from '../src/finance/api.ts';
import { FinanceWorkspace, TransactionPage } from '../src/finance/FinanceWorkspace.tsx';
import { ApiState, Filters, MetricTable, Modal, Reconciliation, SourceDetail } from '../src/finance/components.tsx';
import { PAGES, financePath, financePage, isFinancePath, formatMoney, valueText, reportQuery, reportCsv, COMMERCIAL, initialFilter, type Filter } from '../src/finance/model.ts';
import { FinanceEntry } from '../src/finance/FinanceEntry.tsx';
import { Navbar } from '../src/components/common/Navbar.tsx';
const filter: Filter = { mode: 'WAREHOUSE', startDate: '2026-10-01', endDate: '2026-10-23', outletIds: null, timezone: 'Asia/Jakarta' };
const user = { id: 99, name: 'Test Fixture', email: 'fixture@example.invalid', role: 'FINANCE' as const };
const missingReport = () => new FinanceAggregationService().aggregate(filter, []);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('seven Finance deep links resolve and unknown/cross-role paths are excluded', () => {
  assert.equal(PAGES.length, 7);
  for (const [page] of PAGES) { assert.equal(isFinancePath(financePath(page)), true); assert.equal(financePage(financePath(page)), page); }
  assert.equal(isFinancePath('/warehouse/finance'), true);
  for (const path of ['/admin/finance', '/outlet/finance', '/warehouse/finance/fake', '/warehouse/finance/settings/extra']) assert.equal(isFinancePath(path), false);
});
test('all seven pages server-render without making a data request or showing fixture money', () => {
  for (const [page, label] of PAGES) {
    const html = renderToStaticMarkup(<FinanceWorkspace currentUser={user} pathname={financePath(page)} />);
    assert.ok(html.includes(label.replace(/&/g, '&amp;')));
    assert.ok(html.includes('Filter Finance bersama'));
    assert.ok(!html.includes('Rp0')); assert.ok(!html.includes('fixture@example'));
  }
});
test('Warehouse/Outlet/All controls reflect active mode and outlet/date filters', () => {
  for (const mode of ['WAREHOUSE', 'OUTLET', 'ALL'] as const) {
    const html = renderToStaticMarkup(<Filters filter={{ ...filter, mode, outletIds: [1, 2] }} onChange={() => {}} outlets={[1, 2, 3].map(id => ({ id, name: `Outlet #${id}` }))} />);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.ok(html.includes('2 outlet dipilih')); assert.ok(html.includes('2026-10-23'));
  }
});
test('Rupiah display rounds only presentation and handles large decimals exactly', () => {
  assert.equal(formatMoney('9007199254740993.123456'), 'Rp9.007.199.254.740.993');
  assert.equal(formatMoney('-1000.010000'), '−Rp1.000');
  assert.equal(formatMoney('0.000000'), 'Rp0'); assert.equal(formatMoney(null), '—');
  for (const status of ['Missing', 'Unmapped', 'Error'] as const) assert.equal(valueText({ amount: null, status, reasons: [] }), '—');
});
test('UI displays backend formula results without recomputing money', () => {
  const report = missingReport();
  report.metrics.CI = { amount: '123456789012345678.123456', status: 'Available', reasons: [] };
  const html = renderToStaticMarkup(<MetricTable keys={COMMERCIAL} report={report} onDetail={() => {}} />);
  assert.ok(html.includes('Rp123.456.789.012.345.678')); assert.ok(!html.includes('Rp0'));
});
test('empty/loading/error states have no monetary fallback', () => {
  assert.ok(renderToStaticMarkup(<ApiState loading error={null} reload={() => {}} />).includes('Memuat laporan Finance'));
  const html = renderToStaticMarkup(<ApiState loading={false} error="Endpoint belum tersedia" reload={() => {}} />);
  assert.ok(html.includes('role="alert"')); assert.ok(html.includes('Coba lagi')); assert.ok(!html.includes('Rp'));
});
test('CSV includes canonical filters/status/completeness and blank Missing amount', () => {
  const report = missingReport(); report.metrics.SI = { amount: '9007199254740993.000001', status: 'Available', reasons: [] };
  report.metrics.OI.reasons = ['=HYPERLINK("invalid")'];
  const csv = reportCsv(report);
  assert.ok(csv.includes('9007199254740993.000001')); assert.ok(csv.includes('"2026-10-01","2026-10-23","Semua"'));
  const oi = csv.split('\r\n').find(row => row.includes('"OI"'))!;
  assert.ok(oi.includes('"","Missing","Belum lengkap"')); assert.ok(oi.includes("'=HYPERLINK"));
});
test('query serialization is stable and does not mutate filter/source data', () => {
  const selected = { ...filter, mode: 'OUTLET' as const, outletIds: [3, 1] };
  const before = JSON.stringify(selected); const query = reportQuery(selected);
  assert.equal(new URLSearchParams(query).get('outletIds'), '1,3'); assert.equal(JSON.stringify(selected), before);
  assert.equal(new URLSearchParams(reportQuery(filter)).has('outletIds'), false);
});
test('client uses only GET v2 endpoints, credentials and abort signal', async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const controller = new AbortController();
  const client = createFinanceClient(user, async (path, init) => { calls.push({ path: String(path), init: init! }); return String(path).includes('/report?') ? json(missingReport()) : json({ accounts: [], persistenceEnabled: false }); });
  await client.report(filter, controller.signal); await client.accounts();
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.init.method === 'GET' && c.path.startsWith('/api/finance/v2/')));
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.signal, controller.signal);
  assert.equal((calls[0].init.headers as Record<string, string>)['X-Auth-Password'], undefined);
});
test('404 and SPA HTML fallback are unavailable, never reports', async () => {
  for (const response of [new Response('', { status: 404 }), new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } })]) {
    const client = createFinanceClient(user, async () => response);
    await assert.rejects(() => client.report(filter), (e: FinanceApiError) => e.kind === 'unavailable');
  }
});
test('network, 503 and invalid JSON produce informative errors without dummy numbers', async () => {
  for (const request of [async () => { throw new Error('offline'); }, async () => new Response('', { status: 503 }), async () => new Response('{bad', { headers: { 'content-type': 'application/json' } })]) await assert.rejects(() => createFinanceClient(user, request).report(filter), FinanceApiError);
});
test('401/403 do not become empty success; Warehouse gate expiry is emitted', async () => {
  for (const status of [401, 403]) await assert.rejects(() => createFinanceClient(user, async () => json({}, status)).report(filter), (e: FinanceApiError) => e.kind === 'access');
  const original = globalThis.window;
  const events: string[] = [];
  globalThis.window = { dispatchEvent: (event: Event) => { events.push(event.type); return true; } } as any;
  try { await assert.rejects(() => createFinanceClient({ ...user, role: 'WAREHOUSE' }, async () => json({ code: 'FINANCE_ACCESS_REQUIRED' }, 403)).report(filter)); assert.deepEqual(events, ['finance-access-required']); }
  finally { if (original) globalThis.window = original; else delete (globalThis as any).window; }
});
test('reject malformed report, unsafe numeric money and mismatched/stale filter', () => {
  const base = missingReport(); assert.equal(validateReport(base, filter), base);
  for (const change of [
    { filter: { ...filter, mode: 'OUTLET' } }, { filter: { ...filter, outletIds: '1' } },
    { metrics: { ...base.metrics, SI: { amount: 9007199254740993, status: 'Available', reasons: [] } } },
    { metrics: { ...base.metrics, SI: { amount: '0.000000', status: 'Missing', reasons: [] } } },
    { complete: true }, { reconciliation: { distributions: [{ id: '1', amount: '2' }], internalFacts: [] } },
  ]) assert.throws(() => validateReport({ ...base, ...change }, filter), FinanceApiError);
});
test('valid backend decimal sources and read-only drill-down render faithfully', () => {
  const report = missingReport();
  report.reconciliation.distributions = [{ id: 'RI-1', outletId: 1, reference: 'REQ-1', amount: '130.000000', cost: '100.000000' }];
  report.reconciliation.internalFacts = [{ source: 'WAREHOUSE', id: 'T-1', metric: 'OI', unit: { type: 'WAREHOUSE' }, date: '2026-10-10', amount: '10', nature: 'INTERNAL', reference: 'INT-1' }];
  assert.equal(validateReport(report, filter), report);
  const html = renderToStaticMarkup(<Reconciliation report={report} />);
  assert.ok(html.includes('REQ-1')); assert.ok(html.includes('Lihat sumber')); assert.ok(html.includes('Rp130'));
  assert.ok(!html.includes('href="/warehouse/request/RI-1'));
  const detail = renderToStaticMarkup(<Modal title="Detail SI" onClose={() => {}}><SourceDetail metric="SI" value={report.metrics.SI} mode="WAREHOUSE" /></Modal>);
  assert.ok(detail.includes('role="dialog"')); assert.ok(detail.includes('Warehouse database'));
});
test('transaction management is disabled for DC/DA and does not fabricate rows', () => {
  for (const da of [false, true]) {
    const html = renderToStaticMarkup(<TransactionPage da={da} accounts={null} report={null} onDetail={() => {}} />);
    assert.ok(html.includes('Menunggu aktivasi transaksi Finance')); assert.ok(html.includes('Pratinjau formulir'));
    for (const action of ['Tambah', 'Edit', 'Void', 'Riwayat perubahan']) assert.ok(new RegExp(`<button[^>]*disabled[^>]*>[^<]*${action}`).test(html) || (action === 'Tambah' && html.includes('disabled=""')));
    assert.ok(!html.includes('Rp0')); assert.ok(html.includes('Daftar transaksi belum tersedia'));
  }
});
test('Finance entry withholds Warehouse content until existing gate verifies and denies other roles', () => {
  const renderRole = (role: User['role']) => renderToStaticMarkup(<FinanceEntry currentUser={{ ...user, role }} pathname={financePath('commercial-income')} onBack={() => {}} />);
  const warehouse = renderRole('WAREHOUSE'); assert.ok(warehouse.includes('Memeriksa akses Finance')); assert.ok(!warehouse.includes('Commercial Income'));
  assert.ok(renderRole('FINANCE').includes('Commercial Income')); 
  for (const role of ['ADMIN', 'OUTLET'] as const) { assert.ok(renderRole(role).includes('role="alert"')); assert.ok(!renderRole(role).includes('Commercial Income')); }
});
test('sidebar exposes seven Finance pages only for Finance role', () => {
  const render = (role: User['role'], activeNav: string) => renderToStaticMarkup(<Navbar currentUser={{ ...user, role }} activeNav={activeNav} onNavigate={() => {}} onLogout={() => {}}>Content</Navbar>);
  for (const role of ['FINANCE'] as const) {
    const html = render(role, 'finance-commercial-income');
    for (const [page] of PAGES) assert.ok(html.includes(`id="nav-finance-${page}"`));
    assert.ok(html.includes('aria-current="page"'));
  }
  for (const role of ['ADMIN', 'OUTLET', 'WAREHOUSE'] as const) assert.ok(!render(role, 'dashboard').includes('id="nav-finance-commercial-income"'));
  assert.ok(!render('WAREHOUSE', 'finance-commercial-income').includes('id="nav-finance-commercial-income"'));
});
test('read-only Warehouse master names populate selector and invalid master metadata is rejected', () => {
  const report = missingReport();
  report.outlets = [{ id: 7, code: 'HD-7', name: 'Master Outlet Fixture', isActive: true }];
  assert.equal(validateReport(report, filter), report);
  const html = renderToStaticMarkup(<Filters filter={filter} onChange={() => {}} outlets={report.outlets} />);
  assert.ok(html.includes('Master Outlet Fixture')); assert.ok(html.includes('#7'));
  assert.throws(() => validateReport({ ...report, outlets: [{ ...report.outlets[0], id: '7' }] }, filter), FinanceApiError);
});

test('no Missing metric tables before a valid API response on all pages', () => {
  for (const [page] of PAGES) {
    const html = renderToStaticMarkup(<FinanceWorkspace currentUser={user} pathname={financePath(page)} />);
    assert.ok(!html.includes('fn-status--missing'));
    assert.ok(!html.includes('Export CSV'));
  }
});
test('login failures and denied role are distinct from gate expiry', async () => {
  await assert.rejects(() => createFinanceClient(user, async () => json({}, 401)).accounts(), /Sesi login/);
  await assert.rejects(() => createFinanceClient(user, async () => json({}, 403)).accounts(), /Role akun/);
});

test('transaction manager exposes Add with fail-closed persistence and DC/DA accounts', () => {
  const accounts = { persistenceEnabled: false, accounts: [
    { code: 'LC01', name: 'Salary', group: 'LC' }, { code: 'DA01', name: 'Depreciation', group: 'DA01' }, { code: 'OI', name: 'Other', group: 'OI' },
  ] };
  for (const da of [false, true]) {
    const html = renderToStaticMarkup(<TransactionManager da={da} accounts={accounts} outlets={[]} filter={filter} />);
    assert.ok(html.includes('Tambah Transaksi'));
    assert.ok(html.includes('Persistence transaksi belum diaktifkan'));
    assert.ok(html.includes(da ? 'DA01' : 'LC01'));
    assert.ok(!html.includes('<option>OI</option>'));
    assert.ok(!html.includes('Rp0'));
  }
});

test('Warehouse incoming stock combines old and new without inventing unknown opening', async () => {
  const { incomingStock } = await import('../src/finance/warehouseStockDisplay.ts');
  assert.equal(incomingStock(5, 50).quantity, 55);
  assert.equal(incomingStock(0, 50).quantity, 50);
  assert.equal(incomingStock(null, 50).quantity, null);
  assert.equal(incomingStock(5, 50, true).quantity, 50);
  assert.ok(incomingStock(5, 50).note.includes('Stok lama 5 + masuk baru 50'));
});

const periodRow: any = { itemId: 1, itemName: 'Ayam Mentah (kg)', openingStock: 53, purchaseQuantity: 10, quantity: 45, systemStock: 18, physicalStock: 17, difference: -1, closingStock: 17,
  periodAverage: '28051.285714', catalogPrice: 45000, averageSellingPrice: 35000, totalSellingAmountExact: '1575000.000000', totalCogsAmountExact: '1262307.857130', totalProfitExact: '312692.142870' };
const closed: any = { id: 'period-2', label: 'Periode 2', status: 'Closed', startAt: null, endAt: null, startDate: null, endDate: null, opnameId: 10, locked: true, closedAt: '2026-10-31T05:37:07.000Z', closedBy: 'Warehouse' };

test('Warehouse table shows period stock columns instead of live Inventory stock', () => {
  const html = renderToStaticMarkup(<WarehouseFinanceTable rows={[periodRow]} loading={false} period={closed} />);
  for (const header of ['Stok Awal', 'Masuk', 'Terjual', 'Stok Fisik', 'Selisih', 'Stok Akhir', 'Rata-rata Akhir']) assert.ok(html.includes(`>${header}</th>`), header);
  assert.ok(html.includes('colgroup') && html.includes('>Stok</th>') && html.includes('>Keuangan</th>'));
  assert.ok(!html.includes('Rata-rata Beli'));
  for (const value of ['53', '17', '-1', 'Rp28.051,29', 'Rp1.262.308', 'Rp312.692', 'Rp35.000']) assert.ok(html.includes(value), value);
  assert.ok(html.includes('>Ayam Mentah</span><span class="fin-item-unit">kg</span>'));
  assert.ok(html.includes('class="fin-negative">-1<'));
  assert.ok(html.includes('Data terkunci per')); assert.ok(html.includes('Nilai historis periode ini.'));
  assert.ok(!html.includes('Inventory saat ini'));
  const missing = renderToStaticMarkup(<WarehouseFinanceTable rows={[{ ...periodRow, totalCogsAmountExact: null, totalProfitExact: null }]} loading={false} />);
  assert.ok(missing.includes('Belum terverifikasi')); assert.ok(missing.includes('Estimasi berjalan, dapat berubah sampai periode ditutup.'));
});

test('Open period hides physical count columns; totals never add quantities of different units', () => {
  const html = renderToStaticMarkup(<WarehouseFinanceTable rows={[periodRow, { ...periodRow, itemId: 2, itemName: 'Box Nasi (pack/10)' }]} loading={false} period={{ ...closed, status: 'Open', locked: false }} />);
  assert.ok(!html.includes('>Stok Fisik</th>')); assert.ok(!html.includes('>Selisih</th>'));
  const total = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));
  assert.ok(!total.includes('106')); assert.ok(!total.includes('90<')); // 53+53, 45+45
  assert.ok(total.includes('Rp2.524.616')); assert.ok(total.includes('Rp3.150.000'));
});

test('Inactive rows are hidden by default, zero average shows a dash, negative profit is red', () => {
  const idle: any = { itemId: 3, itemName: 'Sedotan (pcs)', openingStock: 0, purchaseQuantity: 0, quantity: 0, closingStock: 0, physicalStock: null, difference: null, periodAverage: '0.000000', catalogPrice: 0, averageSellingPrice: 0, totalSellingAmountExact: '0.000000', totalCogsAmountExact: '0.000000', totalProfitExact: '0.000000' };
  const html = renderToStaticMarkup(<WarehouseFinanceTable rows={[periodRow, idle, { ...periodRow, itemId: 4, totalProfitExact: '-5000.000000' }]} loading={false} period={closed} />);
  assert.ok(!html.includes('Sedotan')); assert.ok(html.includes('Sembunyikan barang tanpa aktivitas'));
  assert.ok(html.includes('class="fin-negative">−Rp5.000<'));
  const shown = renderToStaticMarkup(<WarehouseFinanceTable rows={[{ ...idle, quantity: 1 }]} loading={false} period={closed} />);
  assert.ok(shown.includes('Sedotan') && !shown.includes('Rp0,00'));
});

test('Outlet filter note explains warehouse-wide stock columns', () => {
  const html = renderToStaticMarkup(<WarehouseFinanceTable rows={[periodRow]} loading={false} period={closed} outletFiltered />);
  assert.ok(html.includes('Stok adalah stok gudang pusat, tidak dipecah per outlet.'));
});

test('Rupiah display rounds half units without mutating the original precision', async () => {
  const { formatRupiah } = await import('../src/lib/format.ts');
  const original = '20000.0982373';
  assert.equal(formatMoney(original), 'Rp20.000');
  assert.equal(original, '20000.0982373');
  assert.equal(formatMoney('999.500000'), 'Rp1.000');
  assert.equal(formatMoney('-999.500000'), '−Rp1.000');
  assert.equal(formatMoney('-0.100000'), 'Rp0');
  assert.equal(formatRupiah(28626.984), 'Rp28.627');
});

test('Warehouse estimate uses period HPP from the ledger, never the Inventory average', async () => {
  const { warehouseEstimate, warehouseEstimateTotals } = await import('../src/finance/warehouseEstimate.ts');
  assert.deepEqual(warehouseEstimate(periodRow), { sales: '1575000.000000', cost: '1262307.857130', profit: '312692.142870' });
  assert.equal(warehouseEstimate({ ...periodRow, totalCogsAmountExact: null, totalProfitExact: null }).profit, null);
  assert.equal(warehouseEstimateTotals([periodRow, periodRow]).profit, '625384.285740');
  assert.equal(warehouseEstimateTotals([periodRow, { ...periodRow, totalProfitExact: null }]).profit, null);
});

test('Warehouse Total HPP appears before revenue', () => {
  const html = renderToStaticMarkup(<WarehouseFinanceTable rows={[periodRow]} loading={false} />);
  assert.ok(html.indexOf('>Total HPP</th>') < html.indexOf('>Total Penjualan</th>'));
});

const OUTLETS = [{ id: 1, name: 'Cisalak' }, { id: 4, name: 'Ciburuyan' }, { id: 7, name: 'Indihiang' }, { id: 10, name: 'Bantar Malam' }];
const split: any = { ...periodRow, quantity: 8, totalSellingAmountExact: '280000.000000', totalCogsAmountExact: '224410.285712', totalProfitExact: '55589.714288',
  outletBreakdown: [{ outletId: 10, soldQuantity: 5, sales: '175000.000000', cogs: '140256.428570', profit: '34743.571430' }, { outletId: 1, soldQuantity: 3, sales: '105000.000000', cogs: '84153.857142', profit: '20846.142858' }] };

test('g. outlet filter round-trips through the URL query', async () => {
  const { readOutletParam, withOutletParam, outletFilterLabel, effectiveOutletIds } = await import('../src/finance/outletFilter.ts');
  const href = withOutletParam('http://x/warehouse/finance?periodId=period-1', [7, 1, 4]);
  assert.equal(href, '/warehouse/finance?periodId=period-1&outlet=1,4,7');
  assert.deepEqual(readOutletParam(new URL(`http://x${href}`).search), [1, 4, 7]);
  assert.deepEqual(readOutletParam('?outlet=1,4,7'), [1, 4, 7]);
  assert.deepEqual(readOutletParam('?outlet=1,x,1'), [1]);
  assert.equal(withOutletParam('http://x/warehouse/finance?outlet=1', []), '/warehouse/finance');
  assert.equal(outletFilterLabel([], OUTLETS), 'Semua Outlet');
  assert.equal(outletFilterLabel([10], OUTLETS), 'Bantar Malam');
  assert.equal(outletFilterLabel([1, 4, 7], OUTLETS), '3 Outlet');
  assert.equal(outletFilterLabel(OUTLETS.map(o => o.id), OUTLETS), 'Semua Outlet');
  assert.deepEqual(effectiveOutletIds(OUTLETS.map(o => o.id), OUTLETS), []);
});

test('Outlet filter shows chips, and is locked for an Outlet account', async () => {
  const { OutletFilter } = await import('../src/components/warehouse/OutletFilter.tsx');
  const html = renderToStaticMarkup(<OutletFilter outlets={OUTLETS} selected={[1, 10]} onChange={() => {}} />);
  assert.ok(html.includes('2 Outlet')); assert.ok(html.includes('aria-label="Hapus Cisalak"')); assert.ok(html.includes('aria-label="Hapus Bantar Malam"'));
  const locked = renderToStaticMarkup(<OutletFilter outlets={OUTLETS} selected={[]} onChange={() => {}} lockedOutletId={10} />);
  assert.ok(locked.includes('Bantar Malam')); assert.ok(!locked.includes('<button'));
});

test('Filtered by outlet: warehouse stock columns hidden, note shown, sold label renamed, totals from selected outlets', () => {
  const html = renderToStaticMarkup(<WarehouseFinanceTable rows={[split]} loading={false} period={closed} outletFiltered outlets={OUTLETS} />);
  for (const header of ['Stok Awal', 'Masuk', 'Stok Fisik', 'Selisih', 'Stok Akhir']) assert.ok(!html.includes(`>${header}</th>`), header);
  assert.ok(html.includes('>Terjual ke outlet terpilih</th>'));
  assert.ok(html.includes('Stok adalah stok gudang pusat, tidak dipecah per outlet.'));
  const total = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));
  assert.ok(total.includes('Rp280.000') && total.includes('Rp224.410') && total.includes('Rp55.590'));
});

test('Per-outlet grouping: subtotal rows and summary cards ordered by sales', async () => {
  const { outletGroups } = await import('../src/components/warehouse/WarehouseFinanceTable.tsx');
  const other: any = { ...split, itemId: 2, itemName: 'Box Nasi (pack/10)', outletBreakdown: [{ outletId: 1, soldQuantity: 10, sales: '500000.000000', cogs: '1.000000', profit: '499999.000000' }] };
  const groups = outletGroups([split, other]);
  assert.deepEqual(groups.map(g => g.outletId), [1, 10]); // Cisalak 605.000 > Bantar Malam 175.000
  assert.equal(groups[0].totals.sales, '605000.000000');
  assert.equal(groups.reduce((n, g) => n + Number(g.totals.sales), 0), 280000 + 500000);
});

test('Without cost permission the table has no HPP, profit or average columns', () => {
  const html = renderToStaticMarkup(<WarehouseFinanceTable rows={[split]} loading={false} period={closed} outletFiltered showCost={false} />);
  for (const header of ['Total HPP', 'Estimasi Keuntungan', 'Rata-rata Akhir']) assert.ok(!html.includes(`>${header}</th>`), header);
  assert.ok(html.includes('>Total Penjualan</th>')); assert.ok(!html.includes('Rp224.410'));
});
