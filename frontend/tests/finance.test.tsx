import { WarehouseFinanceTable } from '../src/components/warehouse/WarehouseFinanceTable.tsx';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import type { User } from '../src/types.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createFinanceClient, FinanceApiError, validateReport } from '../src/finance/api.ts';
import { FinanceWorkspace } from '../src/finance/FinanceWorkspace.tsx';
import { Filters } from '../src/finance/components.tsx';
import { PAGES, financePath, financePage, isFinancePath, formatMoney, valueText, reportQuery, reportCsv, COMMERCIAL, initialFilter, type Filter } from '../src/finance/model.ts';
import { FinanceEntry } from '../src/finance/FinanceEntry.tsx';
import { Navbar } from '../src/components/common/Navbar.tsx';
const filter: Filter = { mode: 'WAREHOUSE', startDate: '2026-10-01', endDate: '2026-10-23', outletIds: null, timezone: 'Asia/Jakarta' };
const user = { id: 99, name: 'Test Fixture', email: 'fixture@example.invalid', role: 'FINANCE' as const };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('six Finance deep links resolve and unknown/cross-role paths are excluded', () => {
  assert.equal(PAGES.length, 6);
  assert.ok(!PAGES.some(([page]) => (page as string) === 'reports'), 'Laporan Keuangan lives in Profit & Loss');
  assert.equal(isFinancePath('/warehouse/finance/reports'), true); assert.equal(financePage('/warehouse/finance/reports'), 'profit-loss');
  assert.equal(isFinancePath('/warehouse/finance/toString'), false);
  for (const [page] of PAGES) { assert.equal(isFinancePath(financePath(page)), true); assert.equal(financePage(financePath(page)), page); }
  assert.equal(isFinancePath('/warehouse/finance'), true);
  for (const path of ['/admin/finance', '/outlet/finance', '/warehouse/finance/fake', '/warehouse/finance/settings/extra']) assert.equal(isFinancePath(path), false);
});
test('all six pages server-render without making a data request or showing fixture money', () => {
  for (const [page, label] of PAGES) {
    const html = renderToStaticMarkup(<FinanceWorkspace currentUser={user} pathname={financePath(page)} />);
    assert.ok(html.includes(label.replace(/&/g, '&amp;')));
    if (page !== 'settings') assert.ok(html.includes('Filter Finance bersama'), page);
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
test('Finance entry withholds Warehouse content until existing gate verifies and denies other roles', () => {
  const renderRole = (role: User['role']) => renderToStaticMarkup(<FinanceEntry currentUser={{ ...user, role }} pathname={financePath('commercial-income')} onBack={() => {}} />);
  const warehouse = renderRole('WAREHOUSE'); assert.ok(warehouse.includes('Memeriksa akses Finance')); assert.ok(!warehouse.includes('Commercial Income'));
  assert.ok(renderRole('FINANCE').includes('Commercial Income')); 
  for (const role of ['ADMIN', 'OUTLET'] as const) { assert.ok(renderRole(role).includes('role="alert"')); assert.ok(!renderRole(role).includes('Commercial Income')); }
});
test('sidebar exposes six Finance pages only for Finance role', () => {
  const render = (role: User['role'], activeNav: string) => renderToStaticMarkup(<Navbar currentUser={{ ...user, role }} activeNav={activeNav} onNavigate={() => {}} onLogout={() => {}}>Content</Navbar>);
  for (const role of ['FINANCE'] as const) {
    const html = render(role, 'finance-commercial-income');
    for (const [page] of PAGES) assert.ok(html.includes(`id="nav-finance-${page}"`));
    assert.ok(html.includes('aria-current="page"'));
  }
  for (const role of ['ADMIN', 'OUTLET', 'WAREHOUSE'] as const) assert.ok(!render(role, 'dashboard').includes('id="nav-finance-commercial-income"'));
  assert.ok(!render('WAREHOUSE', 'finance-commercial-income').includes('id="nav-finance-commercial-income"'));
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
