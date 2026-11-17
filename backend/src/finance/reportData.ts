import { BASE_METRICS, type BaseMetric, type Coverage, type Fact, type Filter, type FinanceOutlet, type Issue, type Metric } from './domain.ts';
import { decimal, money, quantityCost } from './decimal.ts';
import type { SelectExecutor } from './selectExecutor.ts';
import type { ReportInput } from './FinanceReportService.ts';
import type { ExpenseMapping } from './hdOutletSync.ts';
import { deriveEntries } from './hdOutletSync.ts';

// COGS per outlet = what Warehouse approved for it in the period (request line
// Approved, request not Cancelled), qty_approved × the price stored on the
// request line, by item category.
export const COGS_CATEGORY: Record<string, { metric: BaseMetric; name: string }> = {
  'Raw Material': { metric: 'CRW', name: 'COGS Raw Material' },
  'Support Material': { metric: 'CSM', name: 'COGS Support Material' },
  'Packaging': { metric: 'CPM', name: 'COGS Packaging' },
};

const text = (row: Record<string, unknown>, field: string) => { if (typeof row[field] !== 'string') throw new Error(`Expected text: ${field}`); return row[field] as string; };
const id = (value: unknown) => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid database ID'); return n; };
const rupiah = (amount: string) => `Rp${Number(amount).toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
function days(start: string, end: string) {
  const list: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`); t <= last; t += 86400000) list.push(new Date(t).toISOString().slice(0, 10));
  return list;
}
const shortDates = (list: string[]) => list.length <= 5 ? list.join(', ') : `${list.slice(0, 5).join(', ')} dan ${list.length - 5} lainnya`;

export type HdOutletReportStatus = { enabled: boolean; lastSync: { status: string; finishedAt: string | null; message: string | null } | null };

export async function loadReportInput(db: SelectExecutor, filter: Filter, options: { hdOutletEnabled: boolean; today: string }): Promise<ReportInput & { hdOutlet: HdOutletReportStatus }> {
  const outlets: FinanceOutlet[] = (await db.select('SELECT id, outlet_code AS code, outlet_name AS name, is_active AS isActive FROM outlets ORDER BY outlet_name, id', []))
    .map(row => ({ id: id(row.id), code: text(row, 'code'), name: text(row, 'name'), isActive: Number(row.isActive) === 1 }));
  const outletName = (outletId: number) => outlets.find(o => o.id === outletId)?.name ?? `Outlet #${outletId}`;
  // Tables appear with the first Finance write or HD Outlet sync; until then a
  // component simply has no rows. Probed with an empty SELECT (works for every
  // table, also connection-local ones in tests, unlike information_schema).
  const probe = async (sql: string) => { try { await db.select(sql, []); return true; } catch { return false; } };
  const tables = new Set<string>();
  for (const table of ['finance_transactions', 'finance_accounts', 'hdoutlet_reports', 'hdoutlet_outlet_mappings', 'hdoutlet_expense_mappings', 'hdoutlet_sync_runs']) {
    if (await probe(`SELECT 1 FROM \`${table}\` LIMIT 0`)) tables.add(table);
  }
  const facts: Fact[] = [], coverage: Coverage[] = [], issues: Issue[] = [];
  const outletScope = filter.mode !== 'WAREHOUSE';
  const scopeOutlets = outletScope ? (filter.outletIds ?? outlets.filter(o => o.isActive).map(o => o.id)) : [];

  // Ledger: Finance manual entries and entries synced from HD Outlet, posted only.
  if (tables.has('finance_transactions') && tables.has('finance_accounts')) {
    const columns = new Set<string>();
    for (const column of ['source', 'attachment_path']) if (await probe(`SELECT ${column} FROM finance_transactions LIMIT 0`)) columns.add(column);
    const conditions = ["t.status = 'posted'", 't.transaction_date >= ?', 't.transaction_date <= ?'];
    const params: unknown[] = [filter.startDate, filter.endDate];
    if (filter.mode === 'WAREHOUSE') conditions.push("t.unit_type = 'WAREHOUSE'");
    else if (filter.mode === 'OUTLET') conditions.push("t.unit_type = 'OUTLET'");
    if (outletScope && filter.outletIds) { conditions.push(`(t.unit_type = 'WAREHOUSE' OR t.outlet_id IN (${filter.outletIds.map(() => '?').join(',')}))`); params.push(...filter.outletIds); }
    const rows = await db.select(`SELECT CAST(t.id AS CHAR) AS id, a.code AS accountCode, a.name AS accountName, a.metric, t.unit_type AS unitType, t.outlet_id AS outletId,
      CAST(t.amount AS CHAR) AS amount, DATE_FORMAT(t.transaction_date, '%Y-%m-%d') AS date, t.notes, t.evidence_reference AS reference,
      ${columns.has('source') ? 't.source' : "'manual'"} AS source, ${columns.has('attachment_path') ? 't.attachment_path' : 'NULL'} AS attachment
      FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id WHERE ${conditions.join(' AND ')} ORDER BY t.transaction_date, t.id`, params);
    for (const row of rows) {
      const metric = text(row, 'metric') as BaseMetric;
      if (!BASE_METRICS.includes(metric)) throw new Error('Invalid ledger account metric');
      const amount = money(decimal(text(row, 'amount')));
      if (decimal(amount) <= 0n) throw new Error('Invalid posted amount');
      facts.push({
        id: `L:${text(row, 'id')}`, kind: 'ledger', metric, accountCode: text(row, 'accountCode'), accountName: text(row, 'accountName'), amount, date: text(row, 'date'),
        unit: row.unitType === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: id(row.outletId) },
        source: row.source === 'hdoutlet' ? 'HD Outlet API' : 'Finance manual', reference: String(row.reference ?? ''), notes: String(row.notes ?? ''),
        attachment: row.attachment == null ? null : String(row.attachment),
      });
    }
  }

  // Warehouse approvals (request line Approved, request not Cancelled), qty × the
  // price on the request line:
  //  · for the outlet it is COGS (CRW/CSM/CPM by item category);
  //  · for Warehouse it is Sales Income (penjualan ke outlet), and its COGS is
  //    the HPP of the moment of approval (cost snapshot) by item category.
  const warehouseScope = filter.mode !== 'OUTLET';
  if (outletScope || warehouseScope) {
    const params: unknown[] = [filter.startDate, filter.endDate];
    const outletClause = filter.outletIds ? ` AND r.outlet_id IN (${filter.outletIds.map(() => '?').join(',')})` : '';
    if (filter.outletIds) params.push(...filter.outletIds);
    const snapshots = warehouseScope && await probe('SELECT request_item_id, unit_cost FROM inventory_cost_snapshots LIMIT 0');
    const snapshotCost = warehouseScope && await probe('SELECT unit_cost_snapshot FROM request_items LIMIT 0');
    const costSql = [snapshots ? 's.unit_cost' : null, snapshotCost ? 'ri.unit_cost_snapshot' : null].filter(Boolean);
    const rows = await db.select(`SELECT CAST(ri.id AS CHAR) AS id, r.outlet_id AS outletId, r.request_code AS reference, CAST(ri.approved_quantity AS CHAR) AS quantity,
      CAST(ri.price AS CHAR) AS price, CAST(${costSql.length === 2 ? `COALESCE(${costSql.join(', ')})` : costSql[0] ?? 'NULL'} AS CHAR) AS unitCost,
      LEFT(ri.approved_at, 10) AS date, i.category, i.item_name AS itemName
      FROM request_items ri JOIN requests r ON r.id = ri.request_id JOIN items i ON i.id = ri.item_id
      ${snapshots ? 'LEFT JOIN inventory_cost_snapshots s ON s.request_item_id = ri.id' : ''}
      WHERE ri.status = 'Approved' AND ri.approved_quantity > 0 AND r.status <> 'Cancelled'
      AND LEFT(ri.approved_at, 10) >= ? AND LEFT(ri.approved_at, 10) <= ?${outletClause} ORDER BY ri.id`, params);
    let withoutOutlet = 0, uncategorized = 0, unknownCost = 0;
    for (const row of rows) {
      const category = COGS_CATEGORY[String(row.category)];
      const sale = quantityCost(text(row, 'quantity'), text(row, 'price'));
      const destination = row.outletId == null ? 'outlet tidak diketahui' : outletName(id(row.outletId));
      const line = `${String(row.itemName)} · ${row.quantity} × ${rupiah(text(row, 'price'))}`;
      if (warehouseScope) {
        facts.push({ id: `S:${text(row, 'id')}`, kind: 'sale', metric: 'SI', accountCode: 'SI', accountName: 'Penjualan Warehouse ke outlet', amount: sale, date: text(row, 'date'),
          unit: { type: 'WAREHOUSE' }, source: 'Warehouse', reference: text(row, 'reference'), notes: `${line} → ${destination}`, attachment: null });
        if (!category) uncategorized++;
        else if (row.unitCost == null) unknownCost++;
        else facts.push({ id: `H:${text(row, 'id')}`, kind: 'cogs', metric: category.metric, accountCode: category.metric, accountName: `HPP ${category.name.replace('COGS ', '')}`,
          amount: quantityCost(text(row, 'quantity'), money(decimal(text(row, 'unitCost')))), date: text(row, 'date'), unit: { type: 'WAREHOUSE' }, source: 'Warehouse',
          reference: text(row, 'reference'), notes: `HPP ${String(row.itemName)} · ${row.quantity} × ${rupiah(text(row, 'unitCost'))} → ${destination}`, attachment: null });
      }
      if (!outletScope) continue;
      if (row.outletId == null) { withoutOutlet++; continue; }
      if (!category) { if (!warehouseScope) uncategorized++; continue; }
      facts.push({
        id: `C:${text(row, 'id')}`, kind: 'cogs', metric: category.metric, accountCode: category.metric, accountName: category.name,
        amount: sale, date: text(row, 'date'), unit: { type: 'OUTLET', outletId: id(row.outletId) },
        source: 'Warehouse', reference: text(row, 'reference'), notes: line, attachment: null,
      });
    }
    if (withoutOutlet) issues.push({ metrics: ['CRW', 'CSM', 'CPM'], status: 'Partial', reason: `${withoutOutlet} baris request Warehouse yang disetujui tidak punya outlet tujuan; tidak masuk COGS outlet mana pun.` });
    if (uncategorized) issues.push({ metrics: ['CRW', 'CSM', 'CPM'], status: 'Partial', reason: `${uncategorized} baris request Warehouse memakai kategori barang di luar Raw Material/Support Material/Packaging; tidak masuk COGS.` });
    if (unknownCost) coverage.push({ unit: { type: 'WAREHOUSE' }, metrics: ['CRW', 'CSM', 'CPM'], status: 'Partial', reason: `Warehouse: HPP belum diketahui untuk ${unknownCost} baris penjualan ke outlet (barang belum pernah dibeli/belum ada harga pokok saat approve); HPP-nya belum dihitung.` });
  }

  // HD Outlet completeness: every mapped outlet should have a daily report for
  // every day of the period up to today.
  const status: HdOutletReportStatus = { enabled: options.hdOutletEnabled, lastSync: null };
  if (outletScope) {
    const hdMetrics = new Set<Metric>(['SI', 'SH', 'LC']);
    if (!['hdoutlet_reports', 'hdoutlet_outlet_mappings', 'hdoutlet_expense_mappings'].every(t => tables.has(t))) {
      const reason = options.hdOutletEnabled ? 'Data outlet belum lengkap: sinkron HD Outlet belum pernah berhasil.' : 'Integrasi HD Outlet belum aktif; data laporan harian outlet belum tersedia.';
      for (const outletId of scopeOutlets) coverage.push({ unit: { type: 'OUTLET', outletId }, metrics: [...hdMetrics], status: 'Missing', reason: `${outletName(outletId)}: ${reason}` });
    } else {
      const mappingRows = await db.select('SELECT hd_outlet_id AS hdOutletId, hd_outlet_name AS hdOutletName, outlet_id AS outletId FROM hdoutlet_outlet_mappings', []);
      const hdOf = new Map<number, number>(), mappedHd = new Set<number>();
      for (const r of mappingRows) if (r.outletId != null) { hdOf.set(id(r.outletId), id(r.hdOutletId)); mappedHd.add(id(r.hdOutletId)); }
      const expenseRows = await db.select(`SELECT m.expense_key AS \`key\`, m.expense_name AS name, m.status, m.account_code AS accountCode, a.metric
        FROM hdoutlet_expense_mappings m LEFT JOIN finance_accounts a ON a.code = m.account_code`, []);
      const mappings = new Map<string, ExpenseMapping>(expenseRows.map(r => [String(r.key), { key: String(r.key), name: String(r.name), status: r.status as ExpenseMapping['status'], accountCode: r.accountCode == null ? null : String(r.accountCode) }]));
      for (const r of expenseRows) if (r.status === 'mapped' && typeof r.metric === 'string' && BASE_METRICS.includes(r.metric as BaseMetric)) hdMetrics.add(r.metric as Metric);
      const reports = await db.select(`SELECT report_id AS id, DATE_FORMAT(report_date, '%Y-%m-%d') AS date, hd_outlet_id AS hdOutletId, hd_outlet_name AS hdOutletName,
        CAST(total_income AS CHAR) AS totalIncome, CAST(total_loss AS CHAR) AS totalLoss, expenses_json AS expenses
        FROM hdoutlet_reports WHERE deleted_at IS NULL AND report_date >= ? AND report_date <= ?`, [filter.startDate, filter.endDate]);
      const end = filter.endDate < options.today ? filter.endDate : options.today;
      const expected = filter.startDate <= end ? days(filter.startDate, end) : [];
      for (const outletId of scopeOutlets) {
        const unit = { type: 'OUTLET' as const, outletId }, name = outletName(outletId), hd = hdOf.get(outletId);
        if (hd === undefined) { coverage.push({ unit, metrics: [...hdMetrics], status: 'Missing', reason: `${name}: belum dipetakan ke outlet HD Outlet (Pengaturan Finance → Mapping outlet).` }); continue; }
        const own = reports.filter(r => r.hdOutletId != null && id(r.hdOutletId) === hd);
        const have = new Set(own.map(r => String(r.date)));
        const missingDays = expected.filter(day => !have.has(day));
        if (expected.length && missingDays.length === expected.length) coverage.push({ unit, metrics: [...hdMetrics], status: 'Missing', reason: `${name}: laporan harian HD Outlet belum masuk untuk periode ini.` });
        else if (missingDays.length) coverage.push({ unit, metrics: [...hdMetrics], status: 'Partial', reason: `${name}: data outlet belum lengkap — laporan harian belum masuk untuk ${missingDays.length} tanggal (${shortDates(missingDays)}).` });
        const pending = new Map<string, bigint>();
        for (const r of own) for (const p of deriveEntries({ id: id(r.id), totalIncome: String(r.totalIncome), totalLoss: String(r.totalLoss), expenses: JSON.parse(String(r.expenses)) }, mappings).pending) {
          pending.set(p.key, (pending.get(p.key) ?? 0n) + decimal(p.amount));
        }
        if (pending.size) {
          const total = money([...pending.values()].reduce((a, b) => a + b, 0n));
          const names = [...pending.keys()].map(key => mappings.get(key)?.name ?? key).join(', ');
          coverage.push({ unit, metrics: ['DC'], status: 'Partial', reason: `${name}: pengeluaran HD Outlet belum dipetakan ke kode biaya (${names}; ${rupiah(total)}) — belum dihitung.` });
        }
      }
      if (!filter.outletIds) {
        const unmapped = new Map<string, number>();
        for (const r of reports) if (r.hdOutletId == null || !mappedHd.has(id(r.hdOutletId))) unmapped.set(String(r.hdOutletName), (unmapped.get(String(r.hdOutletName)) ?? 0) + 1);
        for (const [name, count] of unmapped) issues.push({ metrics: [...hdMetrics], status: 'Partial', reason: `Laporan HD Outlet "${name}" (${count} laporan) belum dipetakan ke outlet Warehouse; tidak dihitung.` });
      }
      if (tables.has('hdoutlet_sync_runs')) {
        const [last] = await db.select(`SELECT status, CAST(ROUND(UNIX_TIMESTAMP(finished_at) * 1000) AS CHAR) AS finishedMs, message FROM hdoutlet_sync_runs WHERE trigger_type <> 'mapping' AND status <> 'running' ORDER BY id DESC LIMIT 1`, []);
        if (last) status.lastSync = { status: String(last.status), finishedAt: last.finishedMs == null ? null : new Date(Number(last.finishedMs)).toISOString(), message: last.message == null ? null : String(last.message) };
        if (last?.status === 'failed' && coverage.some(c => c.metrics.includes('SI'))) issues.push({ metrics: [...hdMetrics], status: 'Partial', reason: `Sinkron HD Outlet terakhir gagal; data lama tetap dipakai. ${String(last.message ?? '').split('\n')[0]}` });
      }
    }
  }
  return { outlets, facts, coverage, issues, hdOutlet: status };
}
