import { BASE_METRICS, unavailable, type BaseMetric, type Filter, type FinanceDataSource, type Mapping, type SourceResult } from './domain.ts';
import { decimal } from './decimal.ts';
import { date } from './validation.ts';
// This is a normalized port, NOT an assumed HD Outlet wire contract.
// A future verified contract translator supplies it. No HTTP/token/live switch.
export type OutletRow = { id: string; externalOutletId: string; date: string; metric: BaseMetric; amount: string; nature: 'EXTERNAL' | 'INTERNAL'; reference: string };
export type OutletPage = { rows: OutletRow[]; outletIds: string[]; nextCursor: string | null; complete: boolean };
export interface VerifiedOutletTransport {
  contractId: string;
  page(filter: Filter, cursor: string | null): Promise<OutletPage>;
}
export function resolveOutletMapping(mappings: Mapping[], externalId: string, on: string): number | null {
  const matches = mappings.filter(m => m.externalOutletId === externalId && m.status === 'validated' && date(m.validFrom) <= on && (m.validTo === null || date(m.validTo) >= on));
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].outletId) || matches[0].outletId <= 0) return null;
  return matches[0].outletId;
}
export class OutletFinanceDataSource implements FinanceDataSource {
  constructor(private readonly mappings: Mapping[] = [], private readonly transport?: VerifiedOutletTransport, private readonly timeoutMs = 3000, private readonly maxPages = 100) {}
  async read(filter: Filter): Promise<SourceResult> {
    if (!this.transport?.contractId) return unavailable('OUTLET', 'Missing', 'HD Outlet live integration disabled; verified contract required');
    const result: SourceResult = { source: 'OUTLET', units: [], facts: [], coverage: [], distributions: [], issues: [], fetchedAt: new Date().toISOString() };
    try {
      const cursors = new Set<string>();
      const identities = new Map<string, string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        if (++pages > this.maxPages) throw new Error('Pagination limit exceeded');
        let timer: ReturnType<typeof setTimeout>;
        const page = await Promise.race([this.transport.page(filter, cursor), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Outlet timeout')), this.timeoutMs); })]).finally(() => clearTimeout(timer));
        if (!page || !Array.isArray(page.rows) || !Array.isArray(page.outletIds) || typeof page.complete !== 'boolean' || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor))) throw new Error('Invalid page');
        if (!page.complete) result.issues.push({ status: 'Missing', reason: 'Outlet page coverage incomplete' });
        for (const externalId of page.outletIds) {
          if (typeof externalId !== 'string' || !externalId.trim()) throw new Error('Invalid external outlet identity');
          // All dates must resolve to the same master within this request.
          const start = resolveOutletMapping(this.mappings, externalId, filter.startDate);
          const end = resolveOutletMapping(this.mappings, externalId, filter.endDate);
          if (start == null || start !== end || this.mappings.some(m => m.externalOutletId === externalId && m.status === 'validated' && m.validFrom > filter.startDate && m.validFrom <= filter.endDate)) {
            result.issues.push({ status: 'Unmapped', reason: `Outlet mapping not unique/valid for period: ${externalId}` });
          } else if (!filter.outletIds || filter.outletIds.includes(start)) {
            if (!result.units.some(u => u.type === 'OUTLET' && u.outletId === start)) result.units.push({ type: 'OUTLET', outletId: start });
          }
        }
        for (const row of page.rows) {
          if (!row || [row.id, row.externalOutletId, row.reference].some(value => typeof value !== 'string' || !value.trim()) || !BASE_METRICS.includes(row.metric) || !['EXTERNAL', 'INTERNAL'].includes(row.nature) || decimal(row.amount) < 0n || date(row.date) < filter.startDate || row.date > filter.endDate || !page.outletIds.includes(row.externalOutletId)) throw new Error('Invalid normalized Outlet row');
          // Identity is per outlet and metric; conflicting duplicate is an error.
          const identity = `${row.externalOutletId}:${row.id}:${row.metric}`;
          const signature = JSON.stringify(row);
          if (identities.has(identity)) { if (identities.get(identity) !== signature) throw new Error('Conflicting duplicate'); else continue; }
          identities.set(identity, signature);
          const outletId = resolveOutletMapping(this.mappings, row.externalOutletId, row.date);
          if (outletId == null) { result.issues.push({ status: 'Unmapped', reason: `Unmapped Outlet: ${row.externalOutletId}` }); continue; }
          if (filter.outletIds && !filter.outletIds.includes(outletId)) continue;
          // Only verified sales are accepted from this port. Costs need a
          // Warehouse consumption allocation contract; OI/SH/DC/DA use ledger.
          if (row.metric !== 'SI') throw new Error('Unsupported Outlet metric without allocation contract');
          result.facts.push({ source: 'OUTLET', id: identity, metric: row.metric, amount: row.amount, date: row.date, unit: { type: 'OUTLET', outletId }, nature: row.nature, reference: row.reference });
        }
        cursor = page.nextCursor;
        if (cursor !== null) { if (cursors.has(cursor)) throw new Error('Repeated cursor'); cursors.add(cursor); }
      } while (cursor !== null);
      if (filter.outletIds) for (const outletId of filter.outletIds) if (!result.units.some(u => u.type === 'OUTLET' && u.outletId === outletId)) result.issues.push({ status: 'Missing', reason: `Selected outlet absent from source coverage: ${outletId}` });
      // Page completeness means pagination completeness, not certified SI
      // accounting completeness. Each metric remains Missing pending contract.
      for (const unit of result.units) for (const metric of ['SI', 'CRW', 'CSM', 'CPM'] as const) result.coverage.push({ unit, metric, status: 'Missing', reason: metric === 'SI' ? 'Sales accounting coverage not certified' : 'Warehouse consumption allocation unavailable' });
      return result;
    } catch {
      // Discard partial pages on error; never return a misleading final total.
      return unavailable('OUTLET', 'Error', 'Outlet transport, pagination or contract validation failed');
    }
  }
}
