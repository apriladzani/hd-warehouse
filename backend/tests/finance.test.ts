import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_METRICS, type Coverage, type Fact, type Filter, type Unit } from '../src/finance/domain.ts';
import { FinanceCalculationService } from '../src/finance/FinanceCalculationService.ts';
import { buildDetail, buildReport, type ReportInput } from '../src/finance/FinanceReportService.ts';
import { decimal, money, quantityCost } from '../src/finance/decimal.ts';
import { DEFAULT_ACCOUNTS, accountMetric, parseFilter, validateTransaction } from '../src/finance/validation.ts';
import { mysqlSelectExecutor } from '../src/finance/selectExecutor.ts';
import { transitionLegacy } from '../src/finance/transition.ts';
import { canManageFinance, canReadMultiSourceFinance } from '../src/finance/access.ts';
import { createFinanceRouter } from '../src/finance/router.ts';
import { planTransactionChange } from '../src/finance/transactionPlan.ts';
import { deriveEntries, type ExpenseMapping } from '../src/finance/hdOutletSync.ts';
import { decodeReport, moneyFrom, normalizeHdOutletBase } from '../src/finance/hdOutletClient.ts';
import { loadReportInput } from '../src/finance/reportData.ts';

const filter: Filter = { mode: 'ALL', startDate: '2026-11-01', endDate: '2026-11-30', outletIds: null, timezone: 'Asia/Jakarta' };
const warehouse: Unit = { type: 'WAREHOUSE' }, cisalak: Unit = { type: 'OUTLET', outletId: 1 }, aboh: Unit = { type: 'OUTLET', outletId: 2 };
const outlets = [{ id: 1, code: 'cisalak', name: 'Cisalak', isActive: true }, { id: 2, code: 'aboh', name: 'Aboh', isActive: true }];
const calculator = new FinanceCalculationService();
const available = (amount: string) => ({ amount, status: 'Available' as const, reasons: [] });
let sequence = 0;
function fact(metric: Fact['metric'], amount: string, unit: Unit, source: Fact['source'] = 'Finance manual', accountCode: string = metric, date = '2026-11-17'): Fact {
  return { id: `F${++sequence}`, kind: source === 'Warehouse' ? 'cogs' : 'ledger', metric, accountCode, accountName: accountCode, amount, date, unit, source, reference: '', notes: '', attachment: null };
}
const input = (facts: Fact[], coverage: Coverage[] = [], issues: ReportInput['issues'] = []): ReportInput => ({ outlets, facts, coverage, issues });

test('every Finance formula including DA exclusion from DC', () => {
  const values = Object.fromEntries(BASE_METRICS.map(k => [k, available('1')]));
  Object.assign(values, { SI: available('1000'), OI: available('50'), SH: available('10'), CRW: available('100'), CSM: available('20'), CPM: available('30'), DA01: available('5'), DA02: available('2') });
  const result = calculator.calculate(values);
  for (const [key, expected] of Object.entries({ CM: '1040.000000', COGS: '150.000000', CI: '890.000000', DC: '7.000000', DA: '7.000000', EBITDA: '883.000000', EBIT: '876.000000' })) assert.equal(result[key as 'CM'].amount, expected, key);
});

test('exact arithmetic above JS safe integer and fractional costs', () => {
  assert.equal(money(decimal('9007199254740993.000001') + decimal('0.000009')), '9007199254740993.000010');
  assert.equal(quantityCost('3', '0.100001'), '0.300003');
  assert.throws(() => decimal('0.0000001'));
  assert.throws(() => decimal(0.1 as any));
  assert.throws(() => quantityCost('1', '-1'));
  assert.throws(() => money(decimal('999999999999999999.999999') + 1n));
});

test('status flows to every result that uses it; amounts stay the known sum', () => {
  const values = Object.fromEntries(BASE_METRICS.map(k => [k, available('0')]));
  values.SI = { amount: '891500', status: 'Partial', reasons: ['Cisalak: laporan 18 Nov belum masuk'] };
  const result = calculator.calculate(values);
  for (const key of ['CM', 'CI', 'EBITDA', 'EBIT'] as const) { assert.equal(result[key].status, 'Partial', key); assert.deepEqual(result[key].reasons, ['Cisalak: laporan 18 Nov belum masuk']); }
  assert.equal(result.CI.amount, '891500.000000');
  assert.equal(result.COGS.status, 'Available');
  assert.equal(result.DC.status, 'Available');
  const adjusted = calculator.calculate(values, { DC: { status: 'Partial', reasons: ['pengeluaran belum dipetakan'] } });
  assert.equal(adjusted.DC.status, 'Partial'); assert.equal(adjusted.EBITDA.status, 'Partial'); assert.equal(adjusted.LC.status, 'Available');
  assert.equal(calculator.calculate({}).SI.status, 'Missing');
});

test('strict date, mode, outlet and timezone validation', () => {
  assert.deepEqual(parseFilter({ mode: 'OUTLET', startDate: '2026-10-01', endDate: '2026-10-23', outletIds: '2,1,2' }).outletIds, [2, 1]);
  for (const override of [{ startDate: '2026-02-30' }, { endDate: '2026-09-01' }, { mode: 'OTHER' }, { mode: ['WAREHOUSE'] }, { outletIds: '' }, { outletIds: '0' }, { outletIds: '1 OR 1=1' }, { timezone: 'UTC' }]) assert.throws(() => parseFilter({ ...filter, outletIds: undefined, ...override }));
});

test('chart of accounts seed covers every specified code and rolls into the formula components', () => {
  const codes = DEFAULT_ACCOUNTS.map(([code]) => code);
  for (const code of ['LC01', 'LC02', 'LC03', 'LC04', 'LC05', 'LC06', 'UC01', 'UC02', 'UC03', 'UC04', 'MC01', 'MC02', 'MC03', 'TC01', 'TC02', 'TC03', 'TC04', 'AC01', 'AC02', 'AC03', 'AC04', 'LP01', 'TX01', 'DA01', 'DA02', 'SI', 'OI', 'SH', 'CRW', 'CSM', 'CPM']) assert.ok(codes.includes(code), code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(accountMetric('UC01', 'UC'), 'UC'); assert.equal(accountMetric('DA02', 'DA'), 'DA02'); assert.equal(accountMetric('SI', 'SI'), 'SI');
  assert.throws(() => accountMetric('DA03', 'DA')); assert.throws(() => accountMetric('ZZ01', 'ZZ'));
});

test('entry validation: positive Rupiah only, optional proof, known source', () => {
  const entry = { date: '2026-11-17', accountCode: 'UC01', unit: cisalak, amount: '300000', notes: 'Listrik', reference: '', status: 'posted', nature: 'EXTERNAL', idempotencyKey: 'request-1', version: 1 };
  const valid = validateTransaction(entry);
  assert.equal(valid.amount, '300000.000000'); assert.equal(valid.source, 'manual'); assert.equal(valid.attachment, null);
  for (const override of [{ accountCode: '__proto__' }, { accountCode: 'uc01' }, { amount: 1 }, { amount: '0' }, { amount: '-1' }, { amount: '' }, { notes: '' }, { unit: { type: 'WAREHOUSE', outletId: 1 } },
    { status: 'approved' }, { nature: 'INTERNAL' }, { version: 0 }, { source: 'excel' }, { source: 'hdoutlet' }, { attachment: '../../etc/passwd' }]) assert.throws(() => validateTransaction({ ...entry, ...override }), JSON.stringify(override));
  assert.equal(validateTransaction({ ...entry, attachment: '0f0e0d0c-0b0a-4908-8706-050403020100.pdf' }).attachment, '0f0e0d0c-0b0a-4908-8706-050403020100.pdf');
});

test('entry lifecycle: saved posted, manual edits audited, HD Outlet rows read-only, delete is a void', () => {
  const actor = { id: 1, role: 'FINANCE' };
  const entry = { id: 'T1', date: '2026-11-17', accountCode: 'UC01', unit: cisalak, amount: '300000', notes: 'Listrik', reference: '', status: 'posted', nature: 'EXTERNAL', idempotencyKey: 'key-1', version: 1, source: 'manual' };
  const created = planTransactionChange(actor, null, entry, 'Input biaya manual');
  assert.equal(created.audit.action, 'CREATE'); assert.equal(created.record.status, 'posted');
  const edited = planTransactionChange(actor, created.record, { ...created.record, amount: '325000', version: 2 }, 'salah ketik');
  assert.equal(edited.audit.action, 'UPDATE'); assert.equal(edited.audit.before?.amount, '300000.000000'); assert.equal(edited.record.amount, '325000.000000');
  assert.throws(() => planTransactionChange(actor, edited.record, { ...edited.record, amount: '1', version: 2 }, 'stale version'));
  assert.throws(() => planTransactionChange(actor, edited.record, { ...edited.record, amount: '1', status: 'void', version: 3 }, 'delete and change'));
  assert.throws(() => planTransactionChange(actor, edited.record, { ...edited.record, status: 'draft', version: 3 }, 'reopen'));
  const voided = planTransactionChange(actor, edited.record, { ...edited.record, status: 'void', version: 3 }, 'dobel');
  assert.equal(voided.audit.action, 'VOID');
  assert.throws(() => planTransactionChange(actor, voided.record, { ...voided.record, status: 'posted', version: 4 }, 'restore'));
  const synced = { ...created.record, id: 'H1', source: 'hdoutlet' as const, sourceRef: 'hdo:7:SI', accountCode: 'SI' };
  assert.throws(() => planTransactionChange(actor, synced, { ...synced, amount: '1', version: 2 }, 'manual fix'), /HD Outlet/);
  assert.throws(() => planTransactionChange(actor, synced, { ...synced, status: 'void', version: 2 }, 'manual delete'), /HD Outlet/);
  assert.throws(() => planTransactionChange(actor, null, { ...entry, source: 'hdoutlet', sourceRef: 'hdo:1:SI' }, 'forge'), /sinkronisasi/);
  assert.throws(() => planTransactionChange(actor, null, entry, ''));
  for (const role of ['ADMIN', 'WAREHOUSE', 'OUTLET']) assert.throws(() => planTransactionChange({ ...actor, role }, null, entry, 'create'));
});

test('HD Outlet report → SI, SH, Meal LC04, Bonus LC03; unknown expense waits for a code', () => {
  const mappings = new Map<string, ExpenseMapping>([
    ['meal', { key: 'meal', name: 'Meal', status: 'mapped', accountCode: 'LC04' }], ['bonus', { key: 'bonus', name: 'Bonus', status: 'mapped', accountCode: 'LC03' }],
    ['galon', { key: 'galon', name: 'Air Galon', status: 'ignored', accountCode: null }],
  ]);
  const report = { id: 41, totalIncome: '891500.00', totalLoss: '0.00', expenses: { meal: '13000.00', bonus: '10000.00', galon: '8000.00', gas: '25000.00', saus: '0.00' } };
  const { entries, pending } = deriveEntries(report, mappings);
  assert.deepEqual(entries.map(e => [e.sourceRef, e.accountCode, e.amount]), [
    ['hdo:41:SI', 'SI', '891500.000000'], ['hdo:41:exp:bonus', 'LC03', '10000.000000'], ['hdo:41:exp:meal', 'LC04', '13000.000000'],
  ], 'SH 0 and zero expenses make no entry; ignored galon is not counted');
  assert.deepEqual(pending, [{ key: 'gas', amount: '25000.000000' }]);
  assert.equal(deriveEntries({ ...report, totalLoss: '1500' }, mappings).entries.find(e => e.accountCode === 'SH')?.amount, '1500.000000');
});

test('HD Outlet payload validation and base URL normalization', () => {
  const report = decodeReport({ id: 7, report_date: '2026-11-17', outlet_name: ' Cisalak ', total_income: 891500, total_loss: 0, total_expense: 23000, expenses: { meal: 13000, bonus: 10000, lain_lain_keterangan: 'parkir', total_expense: 23000, custom_x: '5000' }, payments: { tunai: 1 } });
  assert.deepEqual(report.expenses, { meal: '13000.00', bonus: '10000.00', custom_x: '5000.00' });
  assert.equal(report.outletName, 'Cisalak'); assert.equal((report.payload.payments as any).tunai, 1);
  for (const bad of [{ id: 0 }, { id: 1.5 }, { report_date: '17/11/2026' }, { outlet_name: '' }, { total_income: -1 }, { total_income: 'NaN' }, { expenses: { meal: -5 } }]) {
    assert.throws(() => decodeReport({ id: 7, report_date: '2026-11-17', outlet_name: 'Cisalak', total_income: 1, ...bad }), JSON.stringify(bad));
  }
  assert.equal(moneyFrom(0.1 + 0.2), '0.30');
  assert.equal(normalizeHdOutletBase('https://hdoutlett.kii.lat/api-docs/').href, 'https://hdoutlett.kii.lat/api/');
  assert.equal(normalizeHdOutletBase('https://hdoutlett.kii.lat').href, 'https://hdoutlett.kii.lat/api/');
  assert.equal(normalizeHdOutletBase('http://localhost:3000/api').href, 'http://localhost:3000/api/');
  for (const bad of ['http://hdoutlett.kii.lat', 'https://user:pass@x.test', 'https://x.test/api?key=1', 'not a url']) assert.throws(() => normalizeHdOutletBase(bad), bad);
});

test('report per unit: three sources, Keseluruhan = all outlets + Warehouse, sources are the real ones', () => {
  const facts = [
    fact('SI', '891500', cisalak, 'HD Outlet API', 'SI'), fact('LC', '13000', cisalak, 'HD Outlet API', 'LC04'), fact('LC', '10000', cisalak, 'HD Outlet API', 'LC03'),
    fact('UC', '300000', cisalak, 'Finance manual', 'UC01'), fact('CRW', '180000', cisalak, 'Warehouse'), fact('CPM', '24000', cisalak, 'Warehouse'),
    fact('LC', '5000000', warehouse, 'Finance manual', 'LC01'), fact('DA01', '100000', warehouse, 'Finance manual', 'DA01'),
    fact('UC', '999', aboh, 'Finance manual', 'UC01', '2026-10-31'), // outside the period
  ];
  const report = buildReport(filter, input(facts));
  const unit = report.byUnit.find(u => u.unit.type === 'OUTLET' && u.unit.outletId === 1)!;
  assert.equal(unit.metrics.UC.amount, '300000.000000'); assert.equal(unit.metrics.LC.amount, '23000.000000');
  assert.equal(unit.metrics.DC.amount, '323000.000000');
  assert.equal(unit.metrics.COGS.amount, '204000.000000');
  assert.equal(unit.metrics.CI.amount, '687500.000000');
  assert.equal(unit.metrics.EBITDA.amount, '364500.000000');
  assert.equal(unit.metrics.EBIT.amount, '364500.000000');
  assert.deepEqual(unit.sources.LC, ['HD Outlet API']); assert.deepEqual(unit.sources.DC, ['Finance manual', 'HD Outlet API']);
  assert.deepEqual(unit.sources.COGS, ['Warehouse']); assert.deepEqual(unit.sources.EBITDA, ['Finance manual', 'HD Outlet API', 'Warehouse']);
  assert.deepEqual(report.byUnit.map(u => u.unit), [cisalak, aboh, warehouse], 'every active outlet and the Warehouse');
  assert.equal(report.metrics.LC.amount, '5023000.000000'); assert.equal(report.metrics.DA.amount, '100000.000000');
  assert.equal(report.metrics.EBIT.amount, (687500 - 323000 - 5000000 - 100000).toFixed(6));
  assert.equal(report.metrics.UC.amount, '300000.000000', 'Aboh October entry is outside the period');
  assert.equal(report.complete, true);
  const outletsOnly = buildReport({ ...filter, mode: 'OUTLET' }, input(facts));
  assert.equal(outletsOnly.metrics.LC.amount, '23000.000000'); assert.ok(outletsOnly.byUnit.every(u => u.unit.type === 'OUTLET'));
  const warehouseOnly = buildReport({ ...filter, mode: 'WAREHOUSE' }, input(facts));
  assert.deepEqual(warehouseOnly.byUnit.map(u => u.unit), [warehouse]); assert.equal(warehouseOnly.metrics.SI.amount, '0.000000');
  const one = buildReport({ ...filter, outletIds: [2] }, input(facts));
  assert.deepEqual(one.byUnit.map(u => u.unit), [aboh, warehouse]); assert.equal(one.metrics.SI.amount, '0.000000');
});

test('Partial and Missing coverage lowers the unit and the totals but keeps the known amount', () => {
  const coverage: Coverage[] = [
    { unit: cisalak, metrics: ['SI', 'SH', 'LC'], status: 'Partial', reason: 'Cisalak: data outlet belum lengkap' },
    { unit: cisalak, metrics: ['DC'], status: 'Partial', reason: 'Cisalak: pengeluaran belum dipetakan' },
    { unit: aboh, metrics: ['SI', 'SH', 'LC'], status: 'Missing', reason: 'Aboh: belum dipetakan' },
  ];
  const report = buildReport({ ...filter, mode: 'OUTLET' }, input([fact('SI', '891500', cisalak, 'HD Outlet API'), fact('UC', '300000', cisalak, 'Finance manual', 'UC01')], coverage, [{ metrics: ['SI'], status: 'Partial', reason: 'Laporan "Outlet X" belum dipetakan' }]));
  const c = report.byUnit.find(u => u.unit.type === 'OUTLET' && u.unit.outletId === 1)!.metrics;
  assert.deepEqual([c.SI.status, c.SI.amount], ['Partial', '891500.000000']);
  assert.equal(c.UC.status, 'Available'); assert.equal(c.DC.status, 'Partial'); assert.ok(c.DC.reasons.includes('Cisalak: pengeluaran belum dipetakan'));
  assert.equal(c.COGS.status, 'Available');
  assert.equal(report.metrics.SI.status, 'Missing', 'Aboh has nothing'); assert.equal(report.metrics.SI.amount, '891500.000000');
  assert.ok(report.metrics.SI.reasons.includes('Laporan "Outlet X" belum dipetakan'));
  assert.equal(report.metrics.DC.status, 'Missing'); assert.equal(report.metrics.UC.status, 'Available');
  assert.equal(report.complete, false);
});

test('nothing entered is Rp0, and the report names each unit and cost still without input', () => {
  const report = buildReport({ ...filter, mode: 'OUTLET' }, input([fact('LC', '100', cisalak, 'Finance manual', 'LC01')]));
  assert.deepEqual(report.notices.find(n => n.unit.type === 'OUTLET' && n.unit.outletId === 2)?.metrics, ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX', 'DA01', 'DA02']);
  assert.ok(!report.notices.find(n => n.unit.type === 'OUTLET' && n.unit.outletId === 1)?.metrics.includes('LC'));
});

test('detail lists the sub-codes and entries behind a component or a computed metric', () => {
  const facts = [fact('LC', '13000', cisalak, 'HD Outlet API', 'LC04'), fact('LC', '10000', cisalak, 'HD Outlet API', 'LC03'), fact('LC', '2000', cisalak, 'Finance manual', 'LC04'), fact('UC', '300000', cisalak, 'Finance manual', 'UC01'), fact('LC', '7', warehouse, 'Finance manual', 'LC01')];
  const lc = buildDetail(filter, input(facts), 'LC', cisalak);
  assert.deepEqual(lc.accounts.map(a => [a.code, a.amount, a.sources, a.count]), [['LC03', '10000.000000', ['HD Outlet API'], 1], ['LC04', '15000.000000', ['Finance manual', 'HD Outlet API'], 2]]);
  assert.equal(lc.entries.length, 3);
  const dc = buildDetail(filter, input(facts), 'DC', null);
  assert.deepEqual(dc.components, ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX']); assert.deepEqual(dc.accounts.map(a => a.code), ['LC01', 'LC03', 'LC04', 'UC01']);
  assert.deepEqual(buildDetail(filter, input(facts), 'CI', null).components, ['SI', 'OI', 'SH', 'CRW', 'CSM', 'CPM']);
});

test('report loader: COGS by category from approved lines, HD Outlet completeness per outlet and date', async () => {
  const queries: string[] = [];
  const db = { select: async (sql: string, params: readonly unknown[]) => {
    queries.push(sql); assert.ok(/^SELECT\s/.test(sql));
    if (sql.includes('FROM outlets')) return [{ id: 1, code: 'cisalak', name: 'Cisalak', isActive: 1 }, { id: 2, code: 'aboh', name: 'Aboh', isActive: 1 }];
    if (sql.includes('information_schema.TABLES')) return ['finance_transactions', 'finance_accounts', 'hdoutlet_reports', 'hdoutlet_outlet_mappings', 'hdoutlet_expense_mappings', 'hdoutlet_sync_runs'].map(name => ({ name }));
    if (sql.includes('information_schema.COLUMNS')) return [{ name: 'source' }, { name: 'attachment_path' }];
    if (sql.includes('FROM finance_transactions')) { assert.ok(sql.includes("t.status = 'posted'")); return [{ id: 'a', accountCode: 'LC04', accountName: 'Meal', metric: 'LC', unitType: 'OUTLET', outletId: 1, amount: '13000.000000', date: '2026-11-17', notes: 'Meal', reference: 'HDO-7', source: 'hdoutlet', attachment: null }]; }
    if (sql.includes('FROM request_items')) {
      assert.ok(sql.includes("ri.status = 'Approved'") && sql.includes("r.status <> 'Cancelled'"), 'cancelled requests never become COGS');
      assert.deepEqual(params, ['2026-11-17', '2026-11-18']);
      return [{ id: '1', outletId: 1, reference: 'REQ-1', quantity: '4', price: '45000', date: '2026-11-17', category: 'Raw Material', itemName: 'Ayam' },
        { id: '2', outletId: 1, reference: 'REQ-1', quantity: '1', price: '24000', date: '2026-11-17', category: 'Packaging', itemName: 'Box' },
        { id: '3', outletId: null, reference: 'REQ-2', quantity: '1', price: '1', date: '2026-11-17', category: 'Packaging', itemName: 'Box' }];
    }
    if (sql.includes('FROM hdoutlet_outlet_mappings')) return [{ hdOutletId: 10, hdOutletName: 'Cisalak', outletId: 1 }, { hdOutletId: 11, hdOutletName: 'Kawalu', outletId: null }];
    if (sql.includes('FROM hdoutlet_expense_mappings')) return [{ key: 'meal', name: 'Meal', status: 'mapped', accountCode: 'LC04', metric: 'LC' }, { key: 'gas', name: 'Gas', status: 'pending', accountCode: null, metric: null }];
    if (sql.includes('FROM hdoutlet_reports')) return [{ id: 7, date: '2026-11-17', hdOutletId: 10, hdOutletName: 'Cisalak', totalIncome: '891500', totalLoss: '0', expenses: '{"meal":"13000.00","gas":"25000.00"}' }, { id: 8, date: '2026-11-17', hdOutletId: 11, hdOutletName: 'Kawalu', totalIncome: '5', totalLoss: '0', expenses: '{}' }];
    if (sql.includes('FROM hdoutlet_sync_runs')) return [{ status: 'failed', finishedMs: '1763380800000', message: 'HD Outlet tidak dapat dihubungi.' }];
    return [];
  } };
  const data = await loadReportInput(db, { ...filter, startDate: '2026-11-17', endDate: '2026-11-18' }, { hdOutletEnabled: true, today: '2026-11-18' });
  assert.deepEqual(data.facts.filter(f => f.kind === 'cogs').map(f => [f.metric, f.amount]), [['CRW', '180000.000000'], ['CPM', '24000.000000']]);
  const cisalakCoverage = data.coverage.filter(c => c.unit.type === 'OUTLET' && c.unit.outletId === 1);
  assert.deepEqual(cisalakCoverage.map(c => [c.status, c.metrics]), [['Partial', ['SI', 'SH', 'LC']], ['Partial', ['DC']]]);
  assert.match(cisalakCoverage[0].reason, /belum lengkap.*2026-11-18/); assert.match(cisalakCoverage[1].reason, /Gas/);
  assert.match(data.coverage.find(c => c.unit.type === 'OUTLET' && c.unit.outletId === 2)!.reason, /belum dipetakan/);
  assert.ok(data.issues.some(i => /Kawalu/.test(i.reason)), 'unmapped HD Outlet report is reported, not dropped silently');
  assert.ok(data.issues.some(i => /tidak punya outlet tujuan/.test(i.reason)));
  assert.ok(data.issues.some(i => /terakhir gagal/.test(i.reason)));
  assert.equal(data.hdOutlet.lastSync?.status, 'failed');
});

test('SELECT-only guard rejects mutation, multi statement and locking reads', async () => {
  const calls: string[] = [];
  const db = mysqlSelectExecutor({ execute: async sql => { calls.push(sql); return [[], []]; } });
  for (const sql of ['ALTER TABLE items ADD x INT', 'SELECT * FROM items; DROP TABLE items', 'SELECT * FROM items FOR UPDATE', "SELECT * INTO OUTFILE 'x' FROM items"]) await assert.rejects(() => db.select(sql, []));
  await db.select('SELECT id FROM items WHERE id = ?', [1]); assert.equal(calls.length, 1);
});

test('legacy transition never doubles or resurrects a void replacement', () => {
  const legacy = [{ id: '1', accountCode: 'LC', amount: '100', isVoided: false }];
  assert.equal(transitionLegacy(legacy, [{ id: 'N1', legacyEntryId: '1', status: 'draft' }]).length, 1);
  for (const status of ['posted', 'void'] as const) assert.equal(transitionLegacy(legacy, [{ id: 'N1', legacyEntryId: '1', status }]).length, 0);
  assert.throws(() => transitionLegacy(legacy, [{ id: 'N1', legacyEntryId: '1', status: 'posted' }, { id: 'N2', legacyEntryId: '1', status: 'posted' }]));
});

test('role matrix preserves existing gate and denies ADMIN/OUTLET', () => {
  assert.equal(canReadMultiSourceFinance('FINANCE', false), true);
  assert.equal(canReadMultiSourceFinance('WAREHOUSE', true), true);
  for (const role of ['ADMIN', 'OUTLET', undefined]) { assert.equal(canReadMultiSourceFinance(role, true), false); assert.equal(canManageFinance(role), false); }
  assert.equal(canReadMultiSourceFinance('WAREHOUSE', false), false);
  assert.equal(canManageFinance('WAREHOUSE'), false); assert.equal(canManageFinance('FINANCE'), true);
});

async function requestRoute(role: string | null, gate: boolean, url: string, query: Record<string, unknown> = {}) {
  let reads = 0;
  const db = { select: async (sql: string) => { reads++; if (sql.includes('FROM outlets')) return []; return []; } };
  const router = createFinanceRouter({ db, hdOutletEnabled: () => false, authenticateReadOnly: async () => role === null ? null : { role, warehouseGateVerified: gate } });
  const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(body: any) { resolve({ status, body }); return this; } };
    router({ method: 'GET', url, headers: {}, query } as any, res as any, reject);
  });
  return { ...response, reads };
}
test('prepared router checks access and filters before source reads, without sockets/DB', async () => {
  for (const [role, gate, status] of [[null, false, 401], ['ADMIN', true, 403], ['OUTLET', true, 403], ['WAREHOUSE', false, 403]] as const) {
    const response = await requestRoute(role, gate, '/report', {}); assert.equal(response.status, status); assert.equal(response.reads, 0);
  }
  const invalid = await requestRoute('FINANCE', false, '/report', {}); assert.equal(invalid.status, 400); assert.equal(invalid.reads, 0);
  const report = await requestRoute('WAREHOUSE', true, '/report', { ...filter, mode: 'WAREHOUSE', outletIds: undefined });
  assert.equal(report.status, 200); assert.ok(report.reads > 0); assert.equal(report.body.metrics.EBIT.amount, '0.000000');
  const badMetric = await requestRoute('FINANCE', false, '/report/detail', { ...filter, outletIds: undefined, metric: 'XX' }); assert.equal(badMetric.status, 400);
  const badUnit = await requestRoute('FINANCE', false, '/report/detail', { ...filter, outletIds: undefined, metric: 'LC', unit: 'OUTLET:x' }); assert.equal(badUnit.status, 400);
  const manifest = await requestRoute('FINANCE', false, '/accounts'); assert.equal(manifest.body.persistenceEnabled, false);
  assert.ok(manifest.body.groups.some((g: any) => g.code === 'UC' && g.name === 'Utility Cost' && g.classCode === 'DC'));
});

test('HD Outlet outlet names pair with Warehouse outlets despite codes, spaces and case; ambiguous names are not guessed', async () => {
  const { matchOutletName } = await import('../src/finance/hdOutletSync.ts');
  // Production names, 17 Nov 2026.
  const warehouse = [[29, 'Aboh'], [395, 'Bantar Malam'], [41, 'Bebedahan'], [185, 'Bebedahan malam'], [46, 'Central Kitchen (CK)'], [32, 'Ciburuyan'], [30, 'Cieunteung'], [31, 'Cigeureung'],
    [372, 'Cisalak'], [28, 'Cisalak Malam'], [27, 'Cisalak Pagi'], [39, 'City Garden'], [393, 'Indihiang'], [36, 'Kawalu'], [33, 'Panglayungan'], [38, 'Ria Busana'], [394, 'Taman Sari'], [35, 'Tamansari']]
    .map(([id, name]) => ({ id: id as number, name: name as string }));
  const expected: [string, number | null][] = [['Cisalak', 372], ['CTG Cieunteung', 30], ['CGR Cigeureung', 31], ['CBR Ciburuyan', 32], ['ABH Aboh', 29], ['BRP Panglayungan', 33], ['IND Indihiang', 393],
    ['TMS TamanSari', null], ['KWL Kawalu', 36], ['CK Central Kitchen', 46], ['City garden', 39], ['RiaBusana', 38], ['CSK 2 Cisalak', null], ['BBD Bebedahan', 41]];
  for (const [hd, id] of expected) assert.equal(matchOutletName(hd, warehouse), id, hd);
});

test('a report of "Cigeureung" belongs to HD Outlet outlet "CGR Cigeureung"', async () => {
  const { sameOutletName } = await import('../src/finance/hdOutletSync.ts');
  assert.equal(sameOutletName('CGR Cigeureung', 'Cigeureung'), true);
  assert.equal(sameOutletName('Cisalak', 'CSK 2 Cisalak'), false);
  assert.equal(sameOutletName('City garden', 'City Garden'), true);
  assert.equal(sameOutletName('TMS TamanSari', 'Taman Sari'), true);
});
