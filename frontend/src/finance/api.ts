import type { Accounts, Filter, Report } from './model.ts';
import { reportQuery, LABELS } from './model.ts';
import type { User } from '../types.ts';
export class FinanceApiError extends Error {
  constructor(public kind: 'unavailable' | 'access' | 'invalid' | 'network', message: string) { super(message); }
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown) => typeof value === 'string' && /^-?\d{1,18}\.\d{6}$/.test(value);
const rawAmount = (value: unknown) => typeof value === 'string' && /^-?\d{1,18}(\.\d{1,6})?$/.test(value);
const unit = (value: unknown) => record(value) && (value.type === 'WAREHOUSE' || (value.type === 'OUTLET' && Number.isSafeInteger(value.outletId) && value.outletId > 0));
function metrics(value: unknown): boolean {
  return record(value) && Object.keys(LABELS).every(key => {
    const metric = value[key];
    return record(metric) && ['Available', 'Missing', 'Unmapped', 'Error'].includes(metric.status) &&
      (metric.status === 'Available' ? amount(metric.amount) : metric.amount === null) && Array.isArray(metric.reasons) && metric.reasons.every((r: unknown) => typeof r === 'string');
  });
}
export function validateReport(value: unknown, filter: Filter): Report {
  if (!record(value) || !record(value.filter) || !['WAREHOUSE', 'OUTLET', 'ALL'].includes(value.filter.mode) || typeof value.filter.startDate !== 'string' || typeof value.filter.endDate !== 'string' || value.filter.timezone !== 'Asia/Jakarta' || (value.filter.outletIds !== null && (!Array.isArray(value.filter.outletIds) || !value.filter.outletIds.length || !value.filter.outletIds.every((id: unknown) => Number.isSafeInteger(id) && (id as number) > 0))) || reportQuery(value.filter as Filter) !== reportQuery(filter) || !metrics(value.metrics) || typeof value.complete !== 'boolean' || (value.complete && Object.values(value.metrics).some((m: any) => m.status !== 'Available')) ||
    !Array.isArray(value.byUnit) || !value.byUnit.every((row: any) => record(row) && unit(row.unit) && metrics(row.metrics) && record(row.knownAmounts) && Object.entries(row.knownAmounts).every(([key, value]) => Object.hasOwn(LABELS, key) && rawAmount(value))) ||
    (value.outlets !== undefined && (!Array.isArray(value.outlets) || !value.outlets.every((o: any) => record(o) && Number.isSafeInteger(o.id) && o.id > 0 && typeof o.name === 'string' && typeof o.code === 'string' && typeof o.isActive === 'boolean'))) ||
    !Array.isArray(value.issues) || !value.issues.every((i: any) => record(i) && ['Missing', 'Unmapped', 'Error'].includes(i.status) && typeof i.reason === 'string') ||
    !record(value.reconciliation) || !Array.isArray(value.reconciliation.distributions) || !value.reconciliation.distributions.every((d: any) => record(d) && typeof d.id === 'string' && typeof d.reference === 'string' && (d.outletId === null || (Number.isSafeInteger(d.outletId) && d.outletId > 0)) && rawAmount(d.amount) && (d.cost === null || rawAmount(d.cost))) ||
    !Array.isArray(value.reconciliation.internalFacts) || !value.reconciliation.internalFacts.every((f: any) => record(f) && typeof f.id === 'string' && typeof f.reference === 'string' && typeof f.date === 'string' && unit(f.unit) && typeof f.metric === 'string' && Object.hasOwn(LABELS, f.metric) && ['WAREHOUSE', 'OUTLET'].includes(f.source) && rawAmount(f.amount) && f.nature === 'INTERNAL') ||
    !Array.isArray(value.sourceTimes) || !value.sourceTimes.every((s: any) => record(s) && ['WAREHOUSE', 'OUTLET'].includes(s.source) && typeof s.fetchedAt === 'string')) throw new FinanceApiError('invalid', 'Respons Finance tidak sesuai kontrak. Angka tidak ditampilkan.');
  return value as Report;
}
export function createFinanceClient(user: User, request: typeof fetch = fetch) {
  const headers = {};
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try { response = await request(path, { method: 'GET', headers, credentials: 'same-origin', signal }); }
    catch (error) { if (signal?.aborted) throw error; throw new FinanceApiError('network', 'Backend Finance tidak dapat dihubungi. Coba kembali setelah layanan tersedia.'); }
    if (response.status === 401 || response.status === 403) {
      let code = '';
      try { const body = await response.json(); code = body?.code ?? ''; } catch {}
      if (user.role === 'WAREHOUSE' && code === 'FINANCE_ACCESS_REQUIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event('finance-access-required'));
      throw new FinanceApiError('access', response.status === 401 ? 'Sesi login tidak tersedia atau berakhir. Keluar dan login kembali ke aplikasi untuk membuat sesi aman.' : code === 'FINANCE_ACCESS_REQUIRED' ? 'Sesi akses Warehouse Finance berakhir. Verifikasi password Finance kembali.' : 'Role akun tidak memiliki akses Finance. Hubungi pengelola akses.');
    }
    if (response.status === 404 || response.status === 501) throw new FinanceApiError('unavailable', 'Endpoint Finance v2 belum tersedia. Menunggu pemasangan router backend.');
    if (response.status === 503) throw new FinanceApiError('network', 'Layanan Finance read-only belum siap. Periksa konfigurasi akun SELECT-only atau ketersediaan database backend.');
    if (!response.ok) throw new FinanceApiError('network', 'Layanan Finance sedang bermasalah. Tidak ada angka final yang ditampilkan.');
    if (!response.headers.get('content-type')?.includes('application/json')) throw new FinanceApiError('unavailable', 'Endpoint Finance v2 belum tersedia; server belum mengembalikan laporan JSON.');
    try { return await response.json(); } catch { throw new FinanceApiError('invalid', 'Respons Finance tidak dapat dibaca.'); }
  }
  return {
    async report(filter: Filter, signal?: AbortSignal) { return validateReport(await get(`/api/finance/v2/report?${reportQuery(filter)}`, signal), filter); },
    async accounts(signal?: AbortSignal): Promise<Accounts> {
      const value = await get('/api/finance/v2/accounts', signal);
      if (!record(value) || typeof value.persistenceEnabled !== 'boolean' || !Array.isArray(value.accounts) || !value.accounts.every((a: any) => record(a) && ['code', 'name', 'group'].every(k => typeof a[k] === 'string'))) throw new FinanceApiError('invalid', 'Master akun belum tersedia dalam format yang sesuai.');
      return value as Accounts;
    },
  };
}
