import { rupiahDecimalDisplay } from '../lib/rupiahDisplay.ts';
import type { DataStatus, Filter, Metric, SourceLabel, Unit, Value } from '../../../backend/src/finance/domain.ts';
import type { buildDetail, buildReport } from '../../../backend/src/finance/FinanceReportService.ts';
import type { Account } from '../../../backend/src/finance/accounts.ts';
export type { DataStatus, Filter, Metric, SourceLabel, Unit, Value, Account };

export type HdOutletReportStatus = { enabled: boolean; lastSync: { status: string; finishedAt: string | null; message: string | null } | null };
// What the backend computes (FinanceReportService) is what the UI shows.
export type Report = ReturnType<typeof buildReport> & { hdOutlet?: HdOutletReportStatus; sourceContext?: 'test-fixture' | 'configured-source' };
export type Detail = ReturnType<typeof buildDetail>;
export type AccountGroup = { code: string; name: string; classCode: 'DC' | 'DA' | 'CI'; className: string; manual: boolean; extensible: boolean };
export type Accounts = { accounts: Account[]; groups: AccountGroup[]; persistenceEnabled: boolean };
export type OutletOption = { id: number; name: string; isActive?: boolean };

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
  LC: 'Labour Cost', UC: 'Utility Cost', MC: 'Maintenance Cost', TC: 'Transportation Cost', AC: 'Advertising Cost', LP: 'Leased Property', TX: 'Tax',
  DA01: 'Depreciation', DA02: 'Amortization', DC: 'Distribution Cost', DA: 'Depreciation & Amortization', EBITDA: 'EBITDA', EBIT: 'EBIT',
};
export const COMMERCIAL: Metric[] = ['SI', 'OI', 'SH', 'CM', 'CRW', 'CSM', 'CPM', 'COGS', 'CI'];
export const DC: Metric[] = ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX'];
export const DA: Metric[] = ['DA01', 'DA02'];
export const PROFIT_LOSS: Metric[] = ['CI', 'DC', 'EBITDA', 'DA', 'EBIT'];
export const PL: Metric[] = [...COMMERCIAL, ...DC, 'DC', ...DA, 'DA', 'EBITDA', 'EBIT'];
export const TOTAL_ROWS: Metric[] = ['CM', 'COGS', 'CI', 'DC', 'DA', 'EBITDA', 'EBIT'];
export const FORMULA_TEXT: Partial<Record<Metric, string>> = {
  CM: '(SI + OI) − SH', COGS: 'CRW + CSM + CPM', CI: 'CM − COGS', DC: 'LC + UC + MC + TC + AC + LP + TX', DA: 'DA01 + DA02', EBITDA: 'CI − DC', EBIT: 'CI − (DC + DA)',
};
export const STATUS_LABEL: Record<DataStatus, string> = { Available: 'Available', Partial: 'Partial', Missing: 'Missing' };

export const unavailableValue: Value = { amount: '0', status: 'Missing', reasons: ['Laporan Finance belum tersedia.'] };
export function unitLabel(unit: Unit, outlets: OutletOption[] = []) {
  if (unit.type === 'WAREHOUSE') return 'Warehouse';
  return outlets.find(o => o.id === unit.outletId)?.name ?? `Outlet #${unit.outletId}`;
}
export const unitKey = (unit: Unit) => unit.type === 'WAREHOUSE' ? 'WAREHOUSE' : `OUTLET:${unit.outletId}`;
export const modeLabel = (mode: Filter['mode']) => ({ WAREHOUSE: 'Warehouse', OUTLET: 'Outlet', ALL: 'Keseluruhan' })[mode];
export function initialFilter(): Filter {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { mode: 'ALL', startDate: `${get('year')}-${get('month')}-01`, endDate: `${get('year')}-${get('month')}-${get('day')}`, outletIds: null, timezone: 'Asia/Jakarta' };
}
export const formatMoney = rupiahDecimalDisplay;
// Missing means "no data": no number is shown. Partial shows the known sum.
export const valueText = (value?: Value) => !value || value.status === 'Missing' ? '—' : formatMoney(value.amount);
export const sourceText = (sources?: readonly string[]) => sources?.length ? sources.join(' + ') : '—';

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
  const outlets = report.outlets ?? [];
  const rows: string[][] = [['Mode', 'Mulai', 'Akhir', 'Outlet filter', 'Unit', 'Kode', 'Nama', 'Nominal IDR', 'Status', 'Alasan', 'Sumber data']];
  const add = (unit: string, metrics: Report['metrics'], sources: Report['sources']) => {
    for (const code of PL) {
      const value = metrics[code];
      rows.push([modeLabel(report.filter.mode), report.filter.startDate, report.filter.endDate, report.filter.outletIds?.map(id => unitLabel({ type: 'OUTLET', outletId: id }, outlets)).join('|') ?? 'Semua',
        unit, code, LABELS[code], value.status === 'Missing' ? '' : value.amount, value.status, value.reasons.join('; '), sourceText(sources[code])]);
    }
  };
  add('Total', report.metrics, report.sources); report.byUnit.forEach(row => add(unitLabel(row.unit, outlets), row.metrics, row.sources));
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
