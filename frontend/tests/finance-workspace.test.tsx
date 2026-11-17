import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildReport } from '../../backend/src/finance/FinanceReportService.ts';
import type { Fact } from '../../backend/src/finance/domain.ts';
import { createFinanceClient, FinanceApiError, validateReport } from '../src/finance/api.ts';
import { DetailView, MetricTable, MissingInputs, UnitTable, Issues } from '../src/finance/components.tsx';
import { EntryManager, draftProblem, toEntryRow, type EntryGateway } from '../src/finance/EntryManager.tsx';
import { AccountSettings } from '../src/finance/FinanceSettings.tsx';
import { COMMERCIAL, DC, PROFIT_LOSS, reportCsv, valueText, type Accounts, type Filter } from '../src/finance/model.ts';

// The Finance pages show what the backend computed (FinanceReportService):
// a real report for Outlet Cisalak, 17 Nov 2026, from the brief.
const filter: Filter = { mode: 'OUTLET', startDate: '2026-11-17', endDate: '2026-11-17', outletIds: [3], timezone: 'Asia/Jakarta' };
const user = { id: 9, name: 'Finance', email: 'finance@fixture.invalid', role: 'FINANCE' as const };
const cisalak = { type: 'OUTLET' as const, outletId: 3 };
const fact = (id: string, metric: Fact['metric'], accountCode: string, amount: string, source: Fact['source']): Fact =>
  ({ id, kind: source === 'Warehouse' ? 'cogs' : 'ledger', metric, accountCode, accountName: accountCode, amount, date: '2026-11-17', unit: cisalak, source, reference: 'ref', notes: 'n', attachment: null });
const report = () => ({
  ...buildReport(filter, {
    outlets: [{ id: 3, code: 'CSL', name: 'Cisalak', isActive: true }],
    facts: [fact('1', 'SI', 'SI', '891500.000000', 'HD Outlet API'), fact('2', 'LC', 'LC04', '13000.000000', 'HD Outlet API'), fact('3', 'LC', 'LC03', '10000.000000', 'HD Outlet API'),
      fact('4', 'UC', 'UC01', '300000.000000', 'Finance manual'), fact('5', 'CRW', 'CRW', '450000.000000', 'Warehouse'), fact('6', 'CPM', 'CPM', '60000.000000', 'Warehouse')],
    coverage: [], issues: [],
  }),
  hdOutlet: { enabled: true, lastSync: null },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const accounts: Accounts = {
  persistenceEnabled: true,
  groups: [{ code: 'UC', name: 'Utility Cost', classCode: 'DC', className: 'Distribution Cost', manual: true, extensible: true }, { code: 'LC', name: 'Labour Cost', classCode: 'DC', className: 'Distribution Cost', manual: true, extensible: true },
    { code: 'SI', name: 'Sales Income', classCode: 'CI', className: 'Commercial Income', manual: false, extensible: false }],
  accounts: [{ code: 'UC01', name: 'Electrical', metric: 'UC', groupCode: 'UC', groupName: 'Utility Cost', classCode: 'DC', className: 'Distribution Cost', isActive: true, manual: true },
    { code: 'UC02', name: 'Water/PAM', metric: 'UC', groupCode: 'UC', groupName: 'Utility Cost', classCode: 'DC', className: 'Distribution Cost', isActive: false, manual: true },
    { code: 'SI', name: 'Sales Income', metric: 'SI', groupCode: 'SI', groupName: 'Sales Income', classCode: 'CI', className: 'Commercial Income', isActive: true, manual: false }],
};

test('Commercial Income, Distribution Cost and P&L show the backend numbers with their real sources', () => {
  const r = report();
  const ci = renderToStaticMarkup(<MetricTable keys={COMMERCIAL} report={r} onDetail={() => {}} />);
  for (const text of ['Rp891.500', 'Rp510.000', 'Rp381.500', 'HD Outlet API', 'Warehouse', '(SI + OI) − SH']) assert.ok(ci.includes(text), text);
  const dc = renderToStaticMarkup(<MetricTable keys={[...DC, 'DC']} report={r} onDetail={() => {}} />);
  for (const text of ['Rp23.000', 'Rp300.000', 'Rp323.000', 'Finance manual + HD Outlet API']) assert.ok(dc.includes(text), text);
  const pl = renderToStaticMarkup(<MetricTable keys={PROFIT_LOSS} report={r} onDetail={() => {}} />);
  for (const text of ['Rp58.500', 'CI − (DC + DA)']) assert.ok(pl.includes(text), text);
  assert.ok(renderToStaticMarkup(<UnitTable report={r} onDetail={() => {}} />).includes('Cisalak'), 'units by outlet name');
});

test('Partial shows the known sum with its status; Missing shows no number', () => {
  const partial = { amount: '891500.000000', status: 'Partial' as const, reasons: ['Cisalak: data outlet belum lengkap'] };
  assert.equal(valueText(partial), 'Rp891.500');
  assert.equal(valueText({ ...partial, status: 'Missing' }), '—');
  const r = buildReport(filter, { outlets: [{ id: 3, code: 'CSL', name: 'Cisalak', isActive: true }], facts: [], issues: [{ metrics: ['SI'], status: 'Partial', reason: 'Sinkron HD Outlet terakhir gagal; data lama tetap dipakai.' }],
    coverage: [{ unit: cisalak, metrics: ['SI', 'SH', 'LC'], status: 'Missing', reason: 'Cisalak: laporan harian HD Outlet belum masuk.' }] });
  const html = renderToStaticMarkup(<MetricTable keys={['SI']} report={{ ...r, hdOutlet: { enabled: true, lastSync: null } }} onDetail={() => {}} />);
  assert.ok(html.includes('fn-status--missing')); assert.ok(!html.includes('Rp0'));
  assert.ok(renderToStaticMarkup(<Issues report={{ ...r, hdOutlet: { enabled: true, lastSync: null } }} />).includes('Sinkron HD Outlet terakhir gagal'));
});

test('costs nothing was entered for are named per unit', () => {
  const r = buildReport(filter, { outlets: [{ id: 3, code: 'CSL', name: 'Cisalak', isActive: true }], facts: [fact('4', 'UC', 'UC01', '300000.000000', 'Finance manual')], coverage: [], issues: [] });
  const html = renderToStaticMarkup(<MissingInputs report={{ ...r, hdOutlet: undefined }} keys={DC} />);
  assert.ok(html.includes('Cisalak')); assert.ok(html.includes('LC Labour Cost')); assert.ok(!html.includes('UC Utility Cost'), 'Listrik was entered');
});

test('the report is accepted only for the filter asked and the backend contract', () => {
  const r = report();
  assert.equal(validateReport(JSON.parse(JSON.stringify(r)), filter).metrics.EBIT.amount, '58500.000000');
  for (const bad of [{ ...r, filter: { ...filter, endDate: '2026-11-18' } }, { ...r, metrics: { ...r.metrics, SI: { ...r.metrics.SI, amount: 891500 } } }, { ...r, sources: { ...r.sources, SI: ['Excel'] } }, { ...r, complete: true, metrics: { ...r.metrics, SI: { ...r.metrics.SI, status: 'Partial' } } }]) {
    assert.throws(() => validateReport(JSON.parse(JSON.stringify(bad)), filter), FinanceApiError);
  }
});

test('the client reads report, detail and accounts with GET; access errors are explained', async () => {
  const calls: string[] = [];
  const client = createFinanceClient(user, async (url, init) => { calls.push(`${init?.method} ${url}`); return String(url).includes('/detail') ? json({ metric: 'LC', accounts: [], entries: [] }) : json(report()); });
  await client.report(filter); await client.detail(filter, 'LC', cisalak);
  assert.ok(calls.every(c => c.startsWith('GET /api/finance/v2/report')));
  assert.ok(calls[1].includes('metric=LC') && calls[1].includes('unit=OUTLET%3A3'));
  await assert.rejects(() => createFinanceClient(user, async () => json({ error: 'x' }, 401)).report(filter), /Sesi login/);
  await assert.rejects(() => createFinanceClient(user, async () => json({ error: 'down' }, 503)).report(filter), /tidak dapat dibaca/);
  await assert.rejects(() => createFinanceClient(user, async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })).report(filter), FinanceApiError);
});

test('detail lists sub-codes and entries with their source', () => {
  const html = renderToStaticMarkup(<DetailView metric="LC" value={report().metrics.LC} sources={['HD Outlet API']} unit={cisalak} loading={false} error={null} outlets={[{ id: 3, name: 'Cisalak' }]}
    detail={{ metric: 'LC', unit: cisalak, components: ['LC'], accounts: [{ code: 'LC03', name: 'Bonus/Insentif', metric: 'LC', amount: '10000.000000', sources: ['HD Outlet API'], count: 1 }, { code: 'LC04', name: 'Meal', metric: 'LC', amount: '13000.000000', sources: ['HD Outlet API'], count: 1 }],
      entries: [fact('2', 'LC', 'LC04', '13000.000000', 'HD Outlet API')] }} />);
  for (const text of ['LC03', 'Bonus/Insentif', 'Rp10.000', 'LC04', 'Rp13.000', 'Cisalak', 'HD Outlet API']) assert.ok(html.includes(text), text);
});

test('input form: classification first, then code, unit, date, amount, notes; incomplete rows are not sent', () => {
  const draft = { key: 'k', group: 'UC', accountCode: 'UC01', unit: '3', date: '2026-11-17', amountText: 'Rp 300.000', notes: 'Listrik', attachment: null, attachmentName: '' };
  assert.equal(draftProblem(draft), null);
  assert.deepEqual(toEntryRow(draft), { date: '2026-11-17', unit: cisalak, accountCode: 'UC01', amount: '300000', notes: 'Listrik', attachment: null });
  assert.equal(draftProblem({ ...draft, group: '' }), 'Pilih klasifikasi.');
  assert.equal(draftProblem({ ...draft, accountCode: '' }), 'Pilih kode biaya.');
  for (const amountText of ['', '0', '-300.000', 'abc']) assert.match(draftProblem({ ...draft, amountText })!, /Nominal/);
  assert.equal(draftProblem({ ...draft, notes: ' ' }), 'Isi keterangan.');
});

test('entry list: Finance can add, others read only; inactive codes and non-manual groups are not offered', () => {
  const gateway: EntryGateway = { list: async () => [], saveBatch: async () => {}, update: async () => {}, remove: async () => {}, upload: async () => 'x' };
  const finance = renderToStaticMarkup(<EntryManager classes={['DC']} accounts={accounts} outlets={[{ id: 3, name: 'Cisalak' }]} filter={filter} canEdit gateway={gateway} />);
  assert.ok(finance.includes('Input biaya')); assert.ok(finance.includes('UC – Utility Cost')); assert.ok(!finance.includes('SI – Sales Income'));
  const viewer = renderToStaticMarkup(<EntryManager classes={['DC']} accounts={accounts} outlets={[]} filter={filter} canEdit={false} gateway={gateway} />);
  assert.ok(!viewer.includes('Input biaya')); assert.ok(viewer.includes('hanya untuk role Finance'));
});

test('chart of accounts: add a code to a classification, synced codes cannot be switched off', () => {
  const html = renderToStaticMarkup(<AccountSettings accounts={accounts} canEdit onChanged={() => {}} />);
  assert.ok(html.includes('Tambah kode')); assert.ok(html.includes('UC01')); assert.ok(html.includes('Nonaktif · aktifkan'), 'UC02 inactive, can be re-activated');
  assert.ok(html.includes('HD Outlet API'), 'SI is fed by HD Outlet');
});

test('CSV carries the period, unit, status and the real sources', () => {
  const csv = reportCsv(report());
  assert.ok(csv.includes('"Cisalak"')); assert.ok(csv.includes('"Finance manual + HD Outlet API"')); assert.ok(csv.includes('"58500.000000"'));
});

test('Keseluruhan names the internal Warehouse → Outlet sale removed from SI and COGS', async () => {
  const { EliminationNote } = await import('../src/finance/components.tsx');
  const all = { ...filter, mode: 'ALL' as const };
  const warehouseSale = { ...fact('7', 'SI', 'SI', '510000.000000', 'Warehouse'), kind: 'sale' as const, unit: { type: 'WAREHOUSE' as const } };
  const r = buildReport(all, { outlets: [{ id: 3, code: 'CSL', name: 'Cisalak', isActive: true }], coverage: [], issues: [],
    facts: [fact('1', 'SI', 'SI', '891500.000000', 'HD Outlet API'), fact('5', 'CRW', 'CRW', '450000.000000', 'Warehouse'), fact('6', 'CPM', 'CPM', '60000.000000', 'Warehouse'), warehouseSale] });
  assert.equal(r.metrics.SI.amount, '891500.000000');
  const html = renderToStaticMarkup(<EliminationNote report={{ ...r, hdOutlet: undefined }} />);
  assert.ok(html.includes('Rp510.000')); assert.ok(html.includes('CI, EBITDA, dan EBIT tidak berubah'));
  assert.equal(renderToStaticMarkup(<EliminationNote report={{ ...buildReport(filter, { outlets: [], facts: [], coverage: [], issues: [] }), hdOutlet: undefined }} />), '', 'not shown outside Keseluruhan');
});
