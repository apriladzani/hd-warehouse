// Base components every Finance number is built from (see FinanceCalculationService).
export const BASE_METRICS = ['SI', 'OI', 'SH', 'CRW', 'CSM', 'CPM', 'LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX', 'DA01', 'DA02'] as const;
export type BaseMetric = typeof BASE_METRICS[number];
export const DC_GROUPS = ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX'] as const satisfies readonly BaseMetric[];
export const DA_METRICS = ['DA01', 'DA02'] as const satisfies readonly BaseMetric[];
export const COGS_METRICS = ['CRW', 'CSM', 'CPM'] as const satisfies readonly BaseMetric[];
// Costs Finance types in (Distribution Cost and DA); "nothing entered" is listed as a notice.
export const LEDGER_INPUT: readonly BaseMetric[] = [...DC_GROUPS, ...DA_METRICS];
export type Metric = BaseMetric | 'CM' | 'COGS' | 'CI' | 'DC' | 'DA' | 'EBITDA' | 'EBIT';
export const DERIVED_METRICS = ['CM', 'COGS', 'CI', 'DC', 'DA', 'EBITDA', 'EBIT'] as const satisfies readonly Metric[];
export const ALL_METRICS: readonly Metric[] = [...BASE_METRICS, ...DERIVED_METRICS];

// Available: complete. Partial: some outlet/date has not reported yet, or an
// item still waits for a mapping. Missing: no data for the component at all.
// Amounts are always the sum of what is known; the status says how far to trust it.
export type DataStatus = 'Available' | 'Partial' | 'Missing';
export const STATUS_RANK: Record<DataStatus, number> = { Available: 0, Partial: 1, Missing: 2 };
export const worstStatus = (statuses: DataStatus[]): DataStatus =>
  statuses.reduce<DataStatus>((worst, s) => STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst, 'Available');

export type Unit = { type: 'WAREHOUSE' } | { type: 'OUTLET'; outletId: number };
export type Filter = { mode: 'WAREHOUSE' | 'OUTLET' | 'ALL'; startDate: string; endDate: string; outletIds: number[] | null; timezone: 'Asia/Jakarta' };
export type Value = { amount: string; status: DataStatus; reasons: string[] };

export const SOURCES = ['Finance manual', 'HD Outlet API', 'Warehouse'] as const;
export type SourceLabel = typeof SOURCES[number];

// One amount booked to one unit, date and account. Ledger rows (manual or synced
// from HD Outlet) and approved Warehouse request lines (COGS) all become facts.
export type Fact = {
  id: string; kind: 'ledger' | 'cogs' | 'sale'; metric: BaseMetric; accountCode: string; accountName: string;
  amount: string; date: string; unit: Unit; source: SourceLabel; reference: string; notes: string;
  attachment: string | null;
};
// How complete a unit's components are for the period.
export type Coverage = { unit: Unit; metrics: Metric[]; status: Exclude<DataStatus, 'Available'>; reason: string };
// A gap that belongs to no selected unit (an unmapped HD Outlet outlet, a request
// line without outlet): it lowers the totals' status, not a unit's.
export type Issue = { metrics: Metric[]; status: Exclude<DataStatus, 'Available'>; reason: string };
export type FinanceOutlet = { id: number; code: string; name: string; isActive: boolean };

export const unitKey = (unit: Unit) => unit.type === 'WAREHOUSE' ? 'WAREHOUSE' : `OUTLET:${unit.outletId}`;
export function parseUnitKey(value: unknown): Unit | null {
  if (value === 'WAREHOUSE') return { type: 'WAREHOUSE' };
  const match = typeof value === 'string' ? /^OUTLET:([1-9]\d{0,9})$/.exec(value) : null;
  return match ? { type: 'OUTLET', outletId: Number(match[1]) } : null;
}
