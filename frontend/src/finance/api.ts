import type { Accounts, Detail, Filter, Metric, Report, Unit } from './model.ts';
import { reportQuery, LABELS, unitKey } from './model.ts';
import type { User } from '../types.ts';
export class FinanceApiError extends Error {
  constructor(public kind: 'unavailable' | 'access' | 'invalid' | 'network', message: string) { super(message); }
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown) => typeof value === 'string' && /^-?\d{1,18}\.\d{6}$/.test(value);
const unit = (value: unknown) => record(value) && (value.type === 'WAREHOUSE' || (value.type === 'OUTLET' && Number.isSafeInteger(value.outletId) && value.outletId > 0));
const STATUSES = ['Available', 'Partial', 'Missing'];
const SOURCES = ['Finance manual', 'HD Outlet API', 'Warehouse'];
function metrics(value: unknown): boolean {
  return record(value) && Object.keys(LABELS).every(key => {
    const metric = value[key];
    return record(metric) && STATUSES.includes(metric.status) && amount(metric.amount) && Array.isArray(metric.reasons) && metric.reasons.every((r: unknown) => typeof r === 'string');
  });
}
const sources = (value: unknown) => record(value) && Object.keys(LABELS).every(key => Array.isArray(value[key]) && value[key].every((s: unknown) => SOURCES.includes(s as string)));

// The report must match the filter asked for and the backend contract; a number
// is never shown from a response that does not.
export function validateReport(value: unknown, filter: Filter): Report {
  const ok = record(value) && record(value.filter) && reportQuery(value.filter as Filter) === reportQuery(filter)
    && metrics(value.metrics) && sources(value.sources) && typeof value.complete === 'boolean'
    && (!value.complete || Object.values(value.metrics).every((m: any) => m.status === 'Available'))
    && Array.isArray(value.byUnit) && value.byUnit.every((row: any) => record(row) && unit(row.unit) && metrics(row.metrics) && sources(row.sources))
    && Array.isArray(value.outlets) && value.outlets.every((o: any) => record(o) && Number.isSafeInteger(o.id) && o.id > 0 && typeof o.name === 'string' && typeof o.isActive === 'boolean')
    && Array.isArray(value.issues) && value.issues.every((i: any) => record(i) && STATUSES.includes(i.status) && typeof i.reason === 'string')
    && Array.isArray(value.notices) && value.notices.every((n: any) => record(n) && unit(n.unit) && Array.isArray(n.metrics) && n.metrics.every((m: unknown) => typeof m === 'string' && Object.hasOwn(LABELS, m as string)));
  if (!ok) throw new FinanceApiError('invalid', 'Respons Finance tidak sesuai kontrak. Angka tidak ditampilkan.');
  return value as Report;
}

async function readJson(response: Response, user: User | null) {
  if (response.status === 401 || response.status === 403) {
    let code = '', message = '';
    try { const body = await response.json(); code = body?.code ?? ''; message = body?.error ?? ''; } catch {}
    if (user?.role === 'WAREHOUSE' && code === 'FINANCE_ACCESS_REQUIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event('finance-access-required'));
    throw new FinanceApiError('access', response.status === 401 ? 'Sesi login tidak tersedia atau berakhir. Keluar dan login kembali.'
      : code === 'FINANCE_ACCESS_REQUIRED' ? 'Sesi akses Warehouse Finance berakhir. Verifikasi password Finance kembali.'
      : /Finance role required/.test(message) ? 'Hanya role Finance yang dapat mengubah data Finance.'
      : /Same-origin/.test(message) ? 'Penyimpanan ditolak karena permintaan tidak berasal dari halaman aplikasi ini. Muat ulang halaman lalu coba lagi.'
      : 'Role akun tidak memiliki akses Finance. Hubungi pengelola akses.');
  }
  if (response.status === 503) throw new FinanceApiError('network', 'Database Finance tidak dapat dibaca saat ini. Coba lagi beberapa saat lagi.');
  let body: any = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  if (!response.ok) throw new FinanceApiError(response.status === 404 ? 'unavailable' : 'network', typeof body?.error === 'string' ? body.error : 'Layanan Finance sedang bermasalah. Coba lagi.');
  if (body === null) throw new FinanceApiError('invalid', 'Respons Finance tidak dapat dibaca.');
  return body;
}

export function createFinanceClient(user: User, request: typeof fetch = fetch) {
  async function get(path: string, signal?: AbortSignal): Promise<any> {
    let response: Response;
    try { response = await request(path, { method: 'GET', headers: {}, credentials: 'same-origin', signal }); }
    catch (error) { if (signal?.aborted) throw error; throw new FinanceApiError('network', 'Backend Finance tidak dapat dihubungi. Coba kembali setelah layanan tersedia.'); }
    return readJson(response, user);
  }
  return {
    async report(filter: Filter, signal?: AbortSignal) { return validateReport(await get(`/api/finance/v2/report?${reportQuery(filter)}`, signal), filter); },
    async detail(filter: Filter, metric: Metric, of?: Unit | null, signal?: AbortSignal): Promise<Detail> {
      const query = new URLSearchParams(reportQuery(filter)); query.set('metric', metric); if (of) query.set('unit', unitKey(of));
      const body = await get(`/api/finance/v2/report/detail?${query}`, signal);
      if (!record(body) || !Array.isArray(body.accounts) || !Array.isArray(body.entries)) throw new FinanceApiError('invalid', 'Rincian Finance tidak sesuai kontrak.');
      return body as Detail;
    },
    async accounts(signal?: AbortSignal): Promise<Accounts> {
      const value = await get('/api/finance/v2/accounts', signal);
      if (!record(value) || typeof value.persistenceEnabled !== 'boolean' || !Array.isArray(value.accounts) || !Array.isArray(value.groups)
        || !value.accounts.every((a: any) => record(a) && ['code', 'name', 'groupCode', 'metric'].every(k => typeof a[k] === 'string') && typeof a.isActive === 'boolean')) throw new FinanceApiError('invalid', 'Master kode biaya belum tersedia dalam format yang sesuai.');
      return value as Accounts;
    },
  };
}

// Writes (Finance role). The browser adds the page's Origin, which the backend
// requires for every change.
export async function financeWrite(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, request: typeof fetch = fetch): Promise<any> {
  let response: Response;
  try {
    response = await request(path, { method, credentials: 'same-origin', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch { throw new FinanceApiError('network', 'Backend Finance tidak dapat dihubungi.'); }
  return readJson(response, null);
}
export async function financeGet(path: string, request: typeof fetch = fetch): Promise<any> {
  let response: Response;
  try { response = await request(path, { method: 'GET', credentials: 'same-origin' }); } catch { throw new FinanceApiError('network', 'Backend Finance tidak dapat dihubungi.'); }
  return readJson(response, null);
}
