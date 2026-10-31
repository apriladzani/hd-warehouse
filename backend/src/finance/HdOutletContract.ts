import { OutletHttpTransport, type OutletHttpContract, type OutletMapping } from './OutletHttpTransport.ts';
import { resolveOutletMapping } from './OutletFinanceDataSource.ts';
import { unavailable, type Filter, type SourceResult, type FinanceDataSource } from './domain.ts';
import { date } from './validation.ts';

// Source: HD Outlet backend/docs/finance-integration-api.md and
// backend/src/services/financeIntegrationService.ts, reviewed 2026-10-24.
const transportContract: OutletHttpContract = {
  id: 'hd-outlet-finance-2026-10-24', evidence: 'provider docs and source audit; metrics NOT certified',
  reportRequest: () => { throw new Error('Use provider client'); },
  decodeReport: () => { throw new Error('No certified metric translation'); },
};
export type JsonRow = Record<string, unknown>;
export type ProviderReport = JsonRow & { report_id: number; outlet_id: number | null; report_date: string };
const fail = (): never => { throw new Error('Invalid HD Outlet contract response'); };
function object(value: unknown): JsonRow { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as JsonRow; }
function integer(value: unknown, min = 1, max = 4294967295): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return fail(); return value;
}
function success(value: unknown) { const row = object(value); if (row.success !== true) return fail(); return row; }
// Validate DECIMAL text without conversion or rounding. Preserve signed values,
// exact scale and NULL. MySQL DECIMAL permits up to 65 digits and scale 30.
function decimals(row: JsonRow, fields: string[]) {
  for (const field of fields) if (Object.hasOwn(row, field)) {
    const value = row[field];
    if (value === null) continue;
    if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,30})?$/.test(value) || value.replace(/[-.]/g, '').length > 65) fail();
  }
}
export function decodeHealth(value: unknown) {
  const row = success(value); if (row.service !== 'hd-outlet-finance-api' || row.status !== 'ok') fail(); return row;
}
export function decodeOutlets(value: unknown) {
  const data = success(value).data; if (!Array.isArray(data)) return fail();
  let previous = 0;
  return data.map(value => { const row = object(value); const id = integer(row.outlet_id);
    if (id <= previous || typeof row.outlet_name !== 'string' || !row.outlet_name.trim()) fail(); previous = id;
    return row as JsonRow & { outlet_id: number; outlet_name: string };
  });
}
export function decodeReport(value: unknown): ProviderReport {
  const row = object(value); integer(row.report_id); if (row.outlet_id !== null) integer(row.outlet_id);
  if (!Object.hasOwn(row, 'total_income')) fail();
  date(row.report_date); if ((row.report_date as string) < '1000-01-01') fail();
  decimals(row, ['total_income', 'total_expense', 'promo', 'final_total', 'total_loss', 'loss_percentage', 'balance_difference']);
  return row as ProviderReport;
}
export function decodeReports(value: unknown) {
  const envelope = success(value), p = object(envelope.pagination);
  const page = integer(p.page, 1, 1000000), limit = integer(p.limit, 1, 100);
  const total = integer(p.total, 0, Number.MAX_SAFE_INTEGER), total_pages = integer(p.total_pages, 0, Number.MAX_SAFE_INTEGER);
  if (total_pages !== Math.ceil(total / limit) || !Array.isArray(envelope.data)) return fail();
  const data = envelope.data.map(decodeReport);
  if (data.length !== Math.min(limit, Math.max(0, total - (page - 1) * limit))) fail();
  let previous = 0; for (const row of data) { if (row.report_id <= previous) fail(); previous = row.report_id; }
  return { data, pagination: { page, limit, total, total_pages } };
}
const children = {
  sales: { key: 'sale_id', money: ['price', 'subtotal'] },
  expenses: { key: 'expense_id', money: ['gas', 'galon', 'clean_tools', 'kulit', 'meal', 'bonus', 'beras', 'saus', 'minyak', 'lain_lain', 'total_expense'] },
  payments: { key: 'payment_id', money: ['tunai', 'qr', 'tf', 'total_payment'] },
  stocks: { key: 'stock_id', money: [] }, remaining_stocks: { key: 'remaining_stock_id', money: [] },
};
export function decodeDetail(value: unknown, reportId: number) {
  integer(reportId); const data = object(success(value).data), report = decodeReport(data.report);
  if (report.report_id !== reportId) fail();
  for (const [table, spec] of Object.entries(children)) {
    if (!Array.isArray(data[table])) fail(); let previous = 0;
    for (const value of data[table] as unknown[]) {
      const row = object(value), id = integer(row[spec.key]);
      if (id <= previous || integer(row.report_id) !== reportId) fail(); previous = id; decimals(row, spec.money);
      const required = table === 'sales' ? ['price', 'subtotal'] : table === 'expenses' ? ['total_expense'] : table === 'payments' ? ['total_payment'] : [];
      if (required.some(field => !Object.hasOwn(row, field))) fail();
      if (table === 'sales') integer(row.quantity, -2147483648, 2147483647);
    }
  }
  return data;
}
export class HdOutletClient {
  private readonly http: OutletHttpTransport;
  constructor(baseUrl: string, token: string, timeoutMs = 3000, private readonly maxPages = 50) {
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) fail();
    this.http = new OutletHttpTransport(baseUrl, token, timeoutMs, transportContract);
  }
  async health() { return decodeHealth(await this.http.get({ path: 'health', query: {} })); }
  async outlets() { return decodeOutlets(await this.http.get({ path: 'outlets', query: {} })); }
  async detail(reportId: number) { integer(reportId); return decodeDetail(await this.http.get({ path: `reports/${reportId}`, query: {} }), reportId); }
  async reports(filter: Filter): Promise<ProviderReport[]> {
    date(filter.startDate); date(filter.endDate); if (filter.endDate < filter.startDate) fail();
    // Intentionally omit outlet_id: provider filtering can hide legacy NULL IDs
    // or infer identities by name. Apply verified mappings only after reading.
    const rows: ProviderReport[] = []; let total: number | undefined; let pages = 1; let previous = 0;
    for (let page = 1; page <= pages; page++) {
      if (page > this.maxPages) fail();
      const result = decodeReports(await this.http.get({ path: 'reports', query: {
        start_date: filter.startDate, end_date: filter.endDate, page: String(page), limit: '100',
      } }));
      const p = result.pagination;
      if (p.page !== page || p.limit !== 100 || p.total_pages > this.maxPages || (total !== undefined && total !== p.total)) fail();
      total = p.total; pages = p.total_pages;
      for (const row of result.data) {
        if (row.report_id <= previous || row.report_date < filter.startDate || row.report_date > filter.endDate) fail();
        previous = row.report_id; rows.push(row);
      }
    }
    if (rows.length !== total) fail(); return rows;
  }
}
// No normalized financial facts are emitted until accounting semantics and
// completeness have been certified. Reading reports is not SI certification.
export class HdOutletFinanceDataSource implements FinanceDataSource {
  constructor(private readonly client: HdOutletClient, private readonly mappings: OutletMapping[]) {}
  async read(filter: Filter): Promise<SourceResult> {
    if (filter.mode === 'WAREHOUSE') return { source: 'OUTLET', units: [], facts: [], coverage: [], distributions: [], issues: [], fetchedAt: new Date().toISOString() };
    try {
      const reports = await this.client.reports(filter);
      const result = unavailable('OUTLET', 'Missing', 'SI/COGS accounting semantics and completeness not certified; provider has no snapshot');
      const mappings = this.mappings.filter(m => m.evidence?.trim() && m.displayName?.trim());
      for (const report of reports) {
        const external = report.outlet_id === null ? null : String(report.outlet_id);
        const id = external === null ? null : resolveOutletMapping(mappings, external, report.report_date);
        const start = external === null ? null : resolveOutletMapping(mappings, external, filter.startDate);
        const end = external === null ? null : resolveOutletMapping(mappings, external, filter.endDate);
        const changed = mappings.some(m => m.externalOutletId === external && m.status === 'validated' && m.validFrom > filter.startDate && m.validFrom <= filter.endDate);
        if (id === null || id !== start || id !== end || changed) {
          result.issues.push({ status: 'Unmapped', reason: report.outlet_id === null ? 'Legacy report outlet_id NULL; identity unverified' : 'Report outlet mapping unverified/ambiguous for period' }); continue;
        }
        if (filter.outletIds && !filter.outletIds.includes(id)) continue;
        if (!result.units.some(u => u.type === 'OUTLET' && u.outletId === id)) result.units.push({ type: 'OUTLET', outletId: id });
      }
      for (const id of filter.outletIds ?? []) if (!result.units.some(u => u.type === 'OUTLET' && u.outletId === id)) result.issues.push({ status: 'Missing', reason: 'Selected outlet report coverage unavailable' });
      for (const unit of result.units) for (const metric of ['SI', 'CRW', 'CSM', 'CPM'] as const) result.coverage.push({ unit, metric, status: 'Missing', reason: 'Metric accounting coverage not certified' });
      return result;
    } catch { return unavailable('OUTLET', 'Error', 'HD Outlet request, pagination or contract validation failed'); }
  }
}
