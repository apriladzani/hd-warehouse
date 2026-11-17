import { loadFinanceEnvironment } from './environment.ts';
import { date } from './validation.ts';

// Client for the HD Outlet (Laporan Harian Outlet) REST API, documented at
// <host>/api-docs. Auth: X-API-Key header with a key created by the HD Outlet
// admin (POST /api/api-keys, scope "read" is enough).
//   GET /api/outlets                    → [{ id, name, active, … }]
//   GET /api/master/expense-categories  → [{ key, name, active, … }]
//   GET /api/reports?startDate&endDate  → [DailyReport]
export class HdOutletError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

// Accepts the host, its /api path or the docs URL people copy from the browser
// (https://host/api-docs/) and returns the API base (https://host/api/).
export function normalizeHdOutletBase(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new HdOutletError('CONFIGURATION', 'OUTLET_FINANCE_API_BASE_URL bukan URL yang valid.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) {
    throw new HdOutletError('CONFIGURATION', 'OUTLET_FINANCE_API_BASE_URL harus https (http hanya untuk localhost) tanpa kredensial atau query.');
  }
  const base = url.pathname.replace(/\/+$/, '').replace(/\/(?:api-docs(?:\.json)?|api)$/i, '');
  url.pathname = `${base}/api/`;
  return url;
}

export type HdOutletConfig = { enabled: boolean; baseUrl: string; apiKey: string; timeoutMs: number; syncDays: number; syncHour: number };
export function hdOutletConfig(env: NodeJS.ProcessEnv = loadFinanceEnvironment()): HdOutletConfig {
  const number = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = value === undefined || value === '' ? fallback : Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  return {
    enabled: env.OUTLET_FINANCE_API_ENABLED === 'true',
    baseUrl: env.OUTLET_FINANCE_API_BASE_URL ?? '',
    apiKey: (env.OUTLET_FINANCE_API_TOKEN ?? '').trim(),
    timeoutMs: number(env.OUTLET_FINANCE_API_TIMEOUT_MS, 8000, 1000, 60000),
    syncDays: number(env.OUTLET_FINANCE_SYNC_DAYS, 7, 1, 62),
    syncHour: number(env.OUTLET_FINANCE_SYNC_HOUR, 1, 0, 23),
  };
}

export type HdOutlet = { id: number; name: string; active: boolean };
export type HdExpenseCategory = { key: string; name: string };
export type HdReport = {
  id: number; reportDate: string; outletName: string;
  totalIncome: string; totalLoss: string; totalExpense: string;
  // Each numeric expense of the report by its key (meal, bonus, gas, custom keys …).
  expenses: Record<string, string>;
  payload: Record<string, unknown>; // the whole report, kept as reference (stock, tosser, payments, sales)
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
// HD Outlet sends money as JSON numbers (Rupiah, at most 2 decimals).
export function moneyFrom(value: unknown): string | null {
  const n = typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e15) return null;
  return n.toFixed(2);
}
export const EXPENSE_KEY = /^[a-z][a-z0-9_]{0,59}$/;
const NOT_AN_EXPENSE = new Set(['total_expense', 'lain_lain_keterangan']);

// Validates one report; throws for a report whose identity or totals are unusable.
export function decodeReport(value: unknown): HdReport {
  if (!record(value)) throw new HdOutletError('CONTRACT', 'Laporan bukan objek.');
  const id = value.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new HdOutletError('CONTRACT', 'ID laporan tidak valid.');
  let reportDate: string;
  try { reportDate = date(String(value.report_date ?? '').slice(0, 10)); } catch { throw new HdOutletError('CONTRACT', `Laporan #${id}: tanggal tidak valid.`); }
  if (typeof value.outlet_name !== 'string' || !value.outlet_name.trim()) throw new HdOutletError('CONTRACT', `Laporan #${id}: nama outlet kosong.`);
  const totalIncome = moneyFrom(value.total_income), totalLoss = moneyFrom(value.total_loss ?? 0), totalExpense = moneyFrom(value.total_expense ?? 0);
  if (totalIncome === null || totalLoss === null || totalExpense === null) throw new HdOutletError('CONTRACT', `Laporan #${id}: total pemasukan/kerugian/pengeluaran tidak valid.`);
  const expenses: Record<string, string> = {};
  if (value.expenses !== undefined && value.expenses !== null) {
    if (!record(value.expenses)) throw new HdOutletError('CONTRACT', `Laporan #${id}: data pengeluaran tidak valid.`);
    for (const [key, raw] of Object.entries(value.expenses)) {
      if (NOT_AN_EXPENSE.has(key) || !EXPENSE_KEY.test(key)) continue;
      if (typeof raw !== 'number' && !(typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw.trim()))) continue; // text fields
      const amount = moneyFrom(raw);
      if (amount === null) throw new HdOutletError('CONTRACT', `Laporan #${id}: pengeluaran "${key}" tidak valid.`);
      expenses[key] = amount;
    }
  }
  return { id, reportDate, outletName: value.outlet_name.trim(), totalIncome, totalLoss, totalExpense, expenses, payload: value };
}

export class HdOutletClient {
  private readonly base: URL;
  constructor(baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 8000, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = normalizeHdOutletBase(baseUrl);
    if (!apiKey || /[\r\n\s]/.test(apiKey)) throw new HdOutletError('CONFIGURATION', 'OUTLET_FINANCE_API_TOKEN (API key HD Outlet) belum diisi di .env.');
  }

  async get(pathname: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(pathname, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) throw new HdOutletError('UNSAFE_PATH', 'Path API tidak aman.');
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // redirect: 'error' so the key is never forwarded to another host.
      const response = await this.fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { 'X-API-Key': this.apiKey, Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        const message = response.status === 401 ? 'API key HD Outlet ditolak (401). Periksa OUTLET_FINANCE_API_TOKEN.'
          : response.status === 403 ? 'API key HD Outlet tidak punya akses ke endpoint ini (403).'
          : `HD Outlet menjawab HTTP ${response.status}.`;
        throw new HdOutletError(`HTTP_${response.status}`, message);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new HdOutletError('INVALID_RESPONSE', 'HD Outlet tidak mengembalikan JSON. Periksa OUTLET_FINANCE_API_BASE_URL.');
      const reader = response.body?.getReader();
      if (!reader) throw new HdOutletError('INVALID_RESPONSE', 'Respons HD Outlet kosong.');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 20_000_000) { await reader.cancel(); throw new HdOutletError('RESPONSE_TOO_LARGE', 'Respons HD Outlet terlalu besar; perpendek periode sinkron.'); }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof HdOutletError) throw error;
      throw new HdOutletError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', controller.signal.aborted ? `HD Outlet tidak menjawab dalam ${this.timeoutMs / 1000} detik.` : 'HD Outlet tidak dapat dihubungi.');
    } finally { clearTimeout(timer); }
  }

  async outlets(): Promise<HdOutlet[]> {
    const body = await this.get('outlets');
    if (!Array.isArray(body)) throw new HdOutletError('CONTRACT', 'Daftar outlet HD Outlet tidak valid.');
    return body.map(row => {
      if (!record(row) || typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.name !== 'string' || !row.name.trim()) throw new HdOutletError('CONTRACT', 'Data outlet HD Outlet tidak valid.');
      return { id: row.id, name: row.name.trim(), active: row.active !== false };
    });
  }

  async expenseCategories(): Promise<HdExpenseCategory[]> {
    const body = await this.get('master/expense-categories');
    if (!Array.isArray(body)) throw new HdOutletError('CONTRACT', 'Kategori pengeluaran HD Outlet tidak valid.');
    return body.filter(row => record(row) && typeof row.key === 'string' && EXPENSE_KEY.test(row.key))
      .map(row => ({ key: String((row as any).key), name: String((row as any).name ?? (row as any).key).trim() || String((row as any).key) }));
  }

  // Reports in the date range. Invalid reports are returned as errors next to
  // the valid ones, so one bad report does not block the others.
  async reports(startDate: string, endDate: string): Promise<{ reports: HdReport[]; errors: string[] }> {
    date(startDate); date(endDate);
    const body = await this.get('reports', { startDate, endDate });
    if (!Array.isArray(body)) throw new HdOutletError('CONTRACT', 'Daftar laporan HD Outlet tidak valid.');
    const reports: HdReport[] = [], errors: string[] = [], seen = new Set<number>();
    for (const row of body) {
      try {
        const report = decodeReport(row);
        if (report.reportDate < startDate || report.reportDate > endDate) continue;
        if (seen.has(report.id)) continue;
        seen.add(report.id); reports.push(report);
      } catch (error) { errors.push(error instanceof Error ? error.message : 'Laporan tidak valid.'); }
    }
    return { reports, errors };
  }
}
