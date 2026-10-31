import { BASE_METRICS, unavailable, type FinanceDataSource, type Filter, type SourceResult, type Unit, type BaseMetric } from './domain.ts';
import { quantityCost, decimal } from './decimal.ts';
import { ACCOUNTS, date } from './validation.ts';
// The caller supplies a SELECT-only connection. No pool creation or repository
// imports here. DB credentials should additionally enforce SELECT-only grants.
export interface SelectExecutor { select(sql: string, parameters: readonly unknown[]): Promise<Record<string, unknown>[]> }
export function mysqlSelectExecutor(connection: { execute: (sql: string, parameters: any[]) => Promise<any> }): SelectExecutor {
  return { async select(sql, parameters) {
    if (!/^SELECT\s/i.test(sql) || /;|\b(?:INTO|FOR\s+(?:UPDATE|SHARE)|LOCK|SLEEP|BENCHMARK)\b/i.test(sql)) throw new Error('Only read queries permitted');
    const [rows] = await connection.execute(sql, [...parameters]);
    return rows;
  } };
}
function text(row: Record<string, unknown>, field: string): string {
  if (typeof row[field] !== 'string') throw new Error(`Expected exact string: ${field}`);
  return row[field] as string;
}
function id(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Invalid database ID');
  return result;
}
export class WarehouseFinanceDataSource implements FinanceDataSource {
  constructor(private readonly db: SelectExecutor) {}
  async read(filter: Filter): Promise<SourceResult> {
    try {
      const unit: Unit = { type: 'WAREHOUSE' };
      const result: SourceResult = { source: 'WAREHOUSE', units: [unit], facts: [], distributions: [], issues: [], fetchedAt: new Date().toISOString(), coverage: BASE_METRICS.map(metric => ({ unit, metric, status: 'Missing', reason: metric === 'SI' ? 'No verified external Warehouse sales source' : 'Unit/period completeness has not been certified' })) };
      const masters = await this.db.select('SELECT id, outlet_code AS code, outlet_name AS name, is_active AS isActive FROM outlets ORDER BY outlet_name, id', []);
      result.outlets = masters.map(row => ({ id: id(row.id), code: text(row, 'code'), name: text(row, 'name'), isActive: Number(row.isActive) === 1 }));
      for (const outlet of result.outlets) {
        if (filter.outletIds && !filter.outletIds.includes(outlet.id)) continue;
        const outletUnit: Unit = { type: 'OUTLET', outletId: outlet.id };
        result.units.push(outletUnit);
        result.coverage.push(...BASE_METRICS.filter(m => !['SI', 'CRW', 'CSM', 'CPM'].includes(m)).map(metric => ({ unit: outletUnit, metric, status: 'Missing' as const, reason: 'Finance ledger period completeness has not been certified' })));
      }
      if (filter.outletIds?.some(selected => !result.outlets!.some(outlet => outlet.id === selected))) result.issues.push({ status: 'Unmapped', reason: 'Selected Warehouse outlet ID not found in master' });
      const columns = await this.db.select(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`, ['request_items', 'inventory_cost_snapshots']);
      const hasColumn = (table: string, column: string) => columns.some(row => row.tableName === table && row.columnName === column);
      const snapshotAvailable = ['request_item_id', 'unit_cost'].every(column => hasColumn('inventory_cost_snapshots', column));
      const requestCostAvailable = hasColumn('request_items', 'unit_cost_snapshot');
      const costCandidates = [snapshotAvailable ? 's.unit_cost' : null, requestCostAvailable ? 'ri.unit_cost_snapshot' : null].filter(Boolean);
      const costSql = costCandidates.length === 2 ? `COALESCE(${costCandidates.join(', ')})` : costCandidates[0] ?? 'NULL';
      const params: unknown[] = [filter.startDate, filter.endDate];
      const outletClause = filter.outletIds ? ` AND r.outlet_id IN (${filter.outletIds.map(() => '?').join(',')})` : '';
      if (filter.outletIds) params.push(...filter.outletIds);
      // Approval date is the distribution event date, never external sales.
      const rows = await this.db.select(`SELECT CAST(ri.id AS CHAR) AS id, r.outlet_id AS outletId, r.request_code AS reference,
        CAST(ri.approved_quantity AS CHAR) AS quantity, CAST(ri.price AS CHAR) AS price,
        CAST(${costSql} AS CHAR) AS unitCost
        FROM request_items ri JOIN requests r ON r.id = ri.request_id
        ${snapshotAvailable ? 'LEFT JOIN inventory_cost_snapshots s ON s.request_item_id = ri.id' : ''}
        WHERE ri.status = 'Approved' AND ri.approved_quantity > 0
        AND LEFT(ri.approved_at, 10) >= ? AND LEFT(ri.approved_at, 10) <= ?${outletClause}
        ORDER BY ri.id`, params);
      const seen = new Set<string>();
      for (const row of rows) {
        const lineId = text(row, 'id');
        if (seen.has(lineId)) throw new Error('Duplicate distribution snapshot');
        seen.add(lineId);
        result.distributions.push({ id: lineId, outletId: row.outletId == null ? null : id(row.outletId), reference: text(row, 'reference'), amount: quantityCost(text(row, 'quantity'), text(row, 'price')), cost: row.unitCost == null ? null : quantityCost(text(row, 'quantity'), text(row, 'unitCost')) });
      }
      const tables = await this.db.select('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)', ['finance_transactions', 'finance_accounts']);
      if (tables.length === 2) {
        const unitClause = filter.outletIds ? ` AND (t.unit_type = 'WAREHOUSE' OR t.outlet_id IN (${filter.outletIds.map(() => '?').join(',')}))` : '';
        const transactions = await this.db.select(`SELECT CAST(t.id AS CHAR) AS id, a.code AS accountCode, t.unit_type AS unitType, t.outlet_id AS outletId,
          CAST(t.amount AS CHAR) AS amount, CAST(t.transaction_date AS CHAR) AS date, t.nature, t.evidence_reference AS reference
          FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id
          WHERE t.status = 'posted' AND t.transaction_date >= ? AND t.transaction_date <= ?${unitClause} ORDER BY t.id`, [filter.startDate, filter.endDate, ...(filter.outletIds ?? [])]);
        for (const row of transactions) {
          const code = text(row, 'accountCode');
          if (!Object.hasOwn(ACCOUNTS, code) || !['INTERNAL', 'EXTERNAL'].includes(text(row, 'nature'))) throw new Error('Invalid Finance ledger classification');
          const amount = text(row, 'amount');
          if (decimal(amount) <= 0n) throw new Error('Invalid posted amount');
          const entryUnit: Unit = row.unitType === 'WAREHOUSE' && row.outletId == null ? unit : row.unitType === 'OUTLET' ? { type: 'OUTLET', outletId: id(row.outletId) } : (() => { throw new Error('Invalid ledger unit'); })();
          if (!result.units.some(u => JSON.stringify(u) === JSON.stringify(entryUnit))) {
            result.units.push(entryUnit);
            result.coverage.push(...BASE_METRICS.filter(m => !['SI', 'CRW', 'CSM', 'CPM'].includes(m)).map(metric => ({ unit: entryUnit, metric, status: 'Missing' as const, reason: 'Finance ledger period completeness has not been certified' })));
          }
          result.facts.push({ source: 'WAREHOUSE', id: text(row, 'id'), metric: ACCOUNTS[code as keyof typeof ACCOUNTS][1] as BaseMetric, amount, date: date(row.date), unit: entryUnit, nature: row.nature as 'INTERNAL' | 'EXTERNAL', reference: text(row, 'reference') });
        }
      }
      // Legacy entries have no verified internal/external nature. They are not
      // added to the new ledger. Review-only access preserves the original data.
      return result;
    } catch {
      return unavailable('WAREHOUSE', 'Error', 'Warehouse SELECT audit failed; inspect schema and source data');
    }
  }
}
