export const BASE_METRICS = ['SI', 'OI', 'SH', 'CRW', 'CSM', 'CPM', 'LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX', 'DA01', 'DA02'] as const;
export type BaseMetric = typeof BASE_METRICS[number];
export type Metric = BaseMetric | 'CM' | 'COGS' | 'CI' | 'DC' | 'DA' | 'EBITDA' | 'EBIT';
export type DataStatus = 'Available' | 'Missing' | 'Unmapped' | 'Error';
export type Source = 'WAREHOUSE' | 'OUTLET';
export type Unit = { type: 'WAREHOUSE' } | { type: 'OUTLET'; outletId: number };
export type Filter = { mode: Source | 'ALL'; startDate: string; endDate: string; outletIds: number[] | null; timezone: 'Asia/Jakarta' };
export type Value = { amount: string | null; status: DataStatus; reasons: string[] };
export type Mapping = { externalOutletId: string; outletId: number; status: 'validated' | 'pending' | 'rejected'; validFrom: string; validTo: string | null };
export type Fact = {
  source: Source; id: string; metric: BaseMetric; amount: string; date: string;
  unit: Unit; nature: 'EXTERNAL' | 'INTERNAL'; reference: string;
};
export type Coverage = { unit: Unit; metric: BaseMetric; status: DataStatus; reason: string };
export type Distribution = { id: string; outletId: number | null; amount: string; cost: string | null; reference: string };
export type FinanceOutlet = { id: number; code: string; name: string; isActive: boolean };
export type SourceResult = {
  source: Source; units: Unit[]; facts: Fact[]; coverage: Coverage[];
  issues: { status: Exclude<DataStatus, 'Available'>; reason: string }[];
  distributions: Distribution[]; fetchedAt: string;
  outlets?: FinanceOutlet[];
};
export interface FinanceDataSource { read(filter: Filter): Promise<SourceResult> }
export const unitKey = (unit: Unit) => unit.type === 'WAREHOUSE' ? 'WAREHOUSE' : `OUTLET:${unit.outletId}`;
export const missing = (reason: string, status: DataStatus = 'Missing'): Value => ({ amount: null, status, reasons: [reason] });
export function unavailable(source: Source, status: 'Missing' | 'Error', reason: string): SourceResult {
  return { source, units: source === 'WAREHOUSE' ? [{ type: 'WAREHOUSE' }] : [], facts: [], coverage: [], issues: [{ status, reason }], distributions: [], fetchedAt: new Date().toISOString() };
}
