import { loadFinanceEnvironment } from './environment.ts';

// Client for the HD Attendance & Payroll REST API, documented at
// <host>/api/docs. Auth: X-API-Key header (a key from the API_KEYS of the HD
// Attendance backend). Only GET endpoints are used; nothing is ever written there.
//   GET /api/outlets     → [{ id: "1", name, outlet_code }]
//   GET /api/positions   → [{ id: "1", name, dailyWage }]
//   GET /api/employees   → [{ id, employee_code, name, position_id, position_name, status }]
//   GET /api/attendance  → [{ id, employee_id, outlet_id, outlet_name, attendance_date, status, … }]
// The attendance list has no date filter: the whole list is read and filtered here.
export class HdAttendanceError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

// Accepts the host, its /api path or the docs URL copied from the browser
// (https://host/api/docs/) and returns the API base (https://host/api/).
export function normalizeHdAttendanceBase(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new HdAttendanceError('CONFIGURATION', 'HDATTENDANCE_API_BASE_URL bukan URL yang valid.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) {
    throw new HdAttendanceError('CONFIGURATION', 'HDATTENDANCE_API_BASE_URL harus https (http hanya untuk localhost) tanpa kredensial atau query.');
  }
  const base = url.pathname.replace(/\/+$/, '').replace(/\/(?:docs|openapi\.json)$/i, '').replace(/\/api$/i, '');
  url.pathname = `${base}/api/`;
  return url;
}

export type HdAttendanceConfig = { enabled: boolean; baseUrl: string; apiKey: string; timeoutMs: number; syncDays: number; syncHour: number };
export function hdAttendanceConfig(env: NodeJS.ProcessEnv = loadFinanceEnvironment()): HdAttendanceConfig {
  const number = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = value === undefined || value === '' ? fallback : Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  return {
    enabled: env.HDATTENDANCE_API_ENABLED === 'true',
    baseUrl: env.HDATTENDANCE_API_BASE_URL ?? '',
    apiKey: (env.HDATTENDANCE_API_KEY ?? '').trim(),
    timeoutMs: number(env.HDATTENDANCE_API_TIMEOUT_MS, 15000, 1000, 60000),
    syncDays: number(env.HDATTENDANCE_SYNC_DAYS, 7, 1, 62),
    syncHour: number(env.HDATTENDANCE_SYNC_HOUR, 1, 0, 23),
  };
}

export type HdaOutlet = { id: number; name: string };
export type HdaPosition = { id: number; name: string; dailyWage: string };
export type HdaEmployee = { id: number; positionId: number | null };
export type HdaAttendance = { id: number; employeeId: number; outletId: number | null; outletName: string | null; date: string; status: string };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
// Ids come as numbers or numeric strings ("1").
export function idFrom(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d{1,10}$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function wageFrom(value: unknown): string | null {
  const n = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12 ? n.toFixed(2) : null;
}
const jakartaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
// HD Attendance stores a DATE and its server sends it as the UTC instant of
// local midnight ("2026-11-16T17:00:00.000Z" is 17 Nov in Asia/Jakarta).
export function attendanceDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? jakartaDay.format(new Date(ms)) : null;
}

export class HdAttendanceClient {
  private readonly base: URL;
  constructor(baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 15000, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = normalizeHdAttendanceBase(baseUrl);
    if (!apiKey || /[\r\n\s]/.test(apiKey)) throw new HdAttendanceError('CONFIGURATION', 'HDATTENDANCE_API_KEY (API key HD Attendance) belum diisi di .env.');
  }

  async get(pathname: string): Promise<unknown[]> {
    const url = new URL(pathname, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) throw new HdAttendanceError('UNSAFE_PATH', 'Path API tidak aman.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // redirect: 'error' so the key is never forwarded to another host. The
      // host sits behind Cloudflare, which refuses some default client names.
      const response = await this.fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { 'X-API-Key': this.apiKey, Accept: 'application/json', 'User-Agent': 'hdhub-finance/1.0' } });
      if (!response.ok) {
        await response.body?.cancel();
        const message = response.status === 401 ? 'API key HD Attendance ditolak (401). Periksa HDATTENDANCE_API_KEY.'
          : response.status === 403 ? 'HD Attendance menolak akses (403).'
          : `HD Attendance menjawab HTTP ${response.status}.`;
        throw new HdAttendanceError(`HTTP_${response.status}`, message);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new HdAttendanceError('INVALID_RESPONSE', 'HD Attendance tidak mengembalikan JSON. Periksa HDATTENDANCE_API_BASE_URL.');
      const reader = response.body?.getReader();
      if (!reader) throw new HdAttendanceError('INVALID_RESPONSE', 'Respons HD Attendance kosong.');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 50_000_000) { await reader.cancel(); throw new HdAttendanceError('RESPONSE_TOO_LARGE', 'Respons HD Attendance terlalu besar.'); }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(body)) throw new HdAttendanceError('CONTRACT', `Data ${pathname} HD Attendance bukan daftar.`);
      return body;
    } catch (error) {
      if (error instanceof HdAttendanceError) throw error;
      if (error instanceof SyntaxError) throw new HdAttendanceError('INVALID_RESPONSE', 'Respons HD Attendance bukan JSON yang valid.');
      throw new HdAttendanceError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', controller.signal.aborted ? `HD Attendance tidak menjawab dalam ${this.timeoutMs / 1000} detik.` : 'HD Attendance tidak dapat dihubungi.');
    } finally { clearTimeout(timer); }
  }

  async outlets(): Promise<HdaOutlet[]> {
    return (await this.get('outlets')).map(row => {
      const id = record(row) ? idFrom(row.id) : null;
      if (!record(row) || id === null || typeof row.name !== 'string' || !row.name.trim()) throw new HdAttendanceError('CONTRACT', 'Data outlet HD Attendance tidak valid.');
      return { id, name: row.name.trim() };
    });
  }

  async positions(): Promise<HdaPosition[]> {
    return (await this.get('positions')).map(row => {
      const id = record(row) ? idFrom(row.id) : null, dailyWage = record(row) ? wageFrom(row.dailyWage ?? 0) : null;
      if (!record(row) || id === null || dailyWage === null) throw new HdAttendanceError('CONTRACT', 'Data posisi HD Attendance tidak valid.');
      return { id, name: String(row.name ?? `Posisi #${id}`).trim(), dailyWage };
    });
  }

  // Only what the salary needs: the employee's position. Names and contact
  // details are not read into Finance.
  async employees(): Promise<HdaEmployee[]> {
    return (await this.get('employees')).map(row => {
      const id = record(row) ? idFrom(row.id) : null;
      if (!record(row) || id === null) throw new HdAttendanceError('CONTRACT', 'Data karyawan HD Attendance tidak valid.');
      return { id, positionId: idFrom(row.position_id) };
    });
  }

  // Attendance in the date range (Asia/Jakarta). Unusable rows are returned as
  // errors next to the valid ones.
  async attendance(startDate: string, endDate: string): Promise<{ rows: HdaAttendance[]; errors: string[] }> {
    const rows: HdaAttendance[] = [], errors: string[] = [], seen = new Set<number>();
    for (const row of await this.get('attendance')) {
      const id = record(row) ? idFrom(row.id) : null;
      if (!record(row) || id === null) { errors.push('Absensi tanpa ID yang valid dilewati.'); continue; }
      const date = attendanceDay(row.attendance_date), employeeId = idFrom(row.employee_id);
      if (!date || !employeeId) { errors.push(`Absensi #${id}: tanggal atau karyawan tidak valid.`); continue; }
      if (date < startDate || date > endDate || seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, employeeId, outletId: idFrom(row.outlet_id), outletName: typeof row.outlet_name === 'string' && row.outlet_name.trim() ? row.outlet_name.trim() : null,
        date, status: String(row.status ?? '').trim().toLowerCase() || 'present' });
    }
    return { rows, errors };
  }
}
