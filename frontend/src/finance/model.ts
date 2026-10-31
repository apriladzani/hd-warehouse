import { rupiahDecimalDisplay } from '../lib/rupiahDisplay.ts';
import type { Filter, Metric, Value, Unit } from '../../../backend/src/finance/domain.ts';
import type { FinanceAggregationService } from '../../../backend/src/finance/FinanceAggregationService.ts';
export type { Filter, Metric, Value, Unit };
export type Report = ReturnType<FinanceAggregationService['aggregate']> & { sourceContext?: 'test-fixture' | 'configured-source' };
export type Accounts = { accounts: { code: string; name: string; group: string }[]; persistenceEnabled: boolean };
export const PAGES = [
  ['dashboard', 'Dashboard Finance'], ['commercial-income', 'Commercial Income'],
  ['distribution-cost', 'Distribution Cost'], ['depreciation-amortization', 'Depreciation & Amortization'],
  ['profit-loss', 'Profit & Loss'], ['reports', 'Laporan Keuangan'], ['settings', 'Pengaturan Finance'],
] as const;
export type FinancePage = typeof PAGES[number][0];
export const financePath = (page: FinancePage) => `/warehouse/finance/${page}`;
export const isFinancePath = (path: string) => path === '/warehouse/finance' || PAGES.some(([page]) => path === financePath(page));
export function financePage(path: string): FinancePage { return PAGES.find(([page]) => path === financePath(page))?.[0] ?? 'dashboard'; }
export const LABELS: Record<Metric, string> = {
  SI: 'Sales Income', OI: 'Other Income', SH: 'Shrinkage', CM: 'Commercial Margin',
  CRW: 'COGS Raw Material', CSM: 'COGS Support Material', CPM: 'COGS Packaging', COGS: 'Total COGS', CI: 'Commercial Income',
  LC: 'Labor Cost', UC: 'Utilities', MC: 'Maintenance', TC: 'Transportation', AC: 'Advertising', LP: 'Rent', TX: 'Tax',
  DA01: 'Depreciation', DA02: 'Amortization', DC: 'Distribution Cost', DA: 'Depreciation & Amortization', EBITDA: 'EBITDA', EBIT: 'EBIT',
};
export const COMMERCIAL: Metric[] = ['SI', 'OI', 'SH', 'CM', 'CRW', 'CSM', 'CPM', 'COGS', 'CI'];
export const PL: Metric[] = [...COMMERCIAL, 'DC', 'DA', 'EBITDA', 'EBIT'];
export const DC: Metric[] = ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX'];
export const DA: Metric[] = ['DA01', 'DA02'];
export const unavailableValue: Value = { amount: null, status: 'Missing', reasons: ['Laporan Finance belum tersedia.'] };
export const unitLabel = (unit: Unit) => unit.type === 'WAREHOUSE' ? 'Warehouse' : `Outlet #${unit.outletId}`;
export const modeLabel = (mode: Filter['mode']) => ({ WAREHOUSE: 'Warehouse', OUTLET: 'Outlet', ALL: 'Keseluruhan' })[mode];
export function initialFilter(): Filter {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { mode: 'WAREHOUSE', startDate: `${get('year')}-${get('month')}-01`, endDate: `${get('year')}-${get('month')}-${get('day')}`, outletIds: null, timezone: 'Asia/Jakarta' };
}
export const formatMoney = rupiahDecimalDisplay;
export const valueText = (value?: Value) => value?.status === 'Available' && value.amount !== null ? formatMoney(value.amount) : '—';
export function sourceLabel(metric: Metric, mode: Filter['mode']): string {
  if (['OI', 'SH', ...DC, ...DA, 'DC', 'DA'].includes(metric)) return 'Finance manual transaction';
  if (metric === 'SI') return mode === 'WAREHOUSE' ? 'Warehouse database' : mode === 'OUTLET' ? 'HD Outlet API' : 'Warehouse database + HD Outlet API';
  if (['CRW', 'CSM', 'CPM', 'COGS'].includes(metric)) return mode === 'WAREHOUSE' ? 'Warehouse database' : 'Warehouse database + alokasi konsumsi Outlet';
  return 'Hasil formula backend';
}
export function reportQuery(filter: Filter): string {
  const query = new URLSearchParams({ mode: filter.mode, startDate: filter.startDate, endDate: filter.endDate, timezone: filter.timezone });
  if (filter.outletIds) query.set('outletIds', [...filter.outletIds].sort((a, b) => a - b).join(','));
  return query.toString();
}
const csvCell = (value: string) => {
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};
export function reportCsv(report: Report): string {
  const rows: string[][] = [['Mode', 'Mulai', 'Akhir', 'Outlet filter', 'Unit', 'Kode', 'Nama', 'Nominal IDR', 'Status', 'Kelengkapan', 'Alasan', 'Sumber']];
  const add = (unit: string, metrics: Report['metrics']) => {
    for (const code of PL) {
      const value = metrics[code];
      rows.push([modeLabel(report.filter.mode), report.filter.startDate, report.filter.endDate, report.filter.outletIds?.join('|') ?? 'Semua', unit, code, LABELS[code], value.status === 'Available' ? value.amount ?? '' : '', value.status, report.complete ? 'Lengkap' : 'Belum lengkap', value.reasons.join('; '), sourceLabel(code, report.filter.mode)]);
    }
  };
  add('Total', report.metrics); report.byUnit.forEach(row => add(unitLabel(row.unit), row.metrics));
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
