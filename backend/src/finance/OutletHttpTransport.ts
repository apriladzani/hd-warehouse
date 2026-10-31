import type { Filter, Mapping } from './domain.ts';
import { unavailable } from './domain.ts';
import { OutletFinanceDataSource, type OutletPage, type VerifiedOutletTransport } from './OutletFinanceDataSource.ts';
import { loadFinanceEnvironment } from './environment.ts';

// Implement only after review of provider documentation/code. No production
// implementation is registered in this stage. Tests use an explicit mock contract.
export interface OutletHttpContract {
  id: string;
  evidence: string;
  reportRequest(filter: Filter, cursor: string | null): { path: string; query: Record<string, string> };
  decodeReport(body: unknown): OutletPage;
}
export class OutletHttpError extends Error {
  constructor(readonly code: string, readonly retryAfterSeconds?: number) { super(`Outlet request failed: ${code}`); }
}
export class OutletHttpTransport implements VerifiedOutletTransport {
  readonly contractId: string;
  private readonly base: URL;
  constructor(baseUrl: string, private readonly token: string, private readonly timeoutMs: number, private readonly contract: OutletHttpContract) {
    this.base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (this.base.username || this.base.password || this.base.search || this.base.hash ||
      !(this.base.protocol === 'https:' || (this.base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname))) ||
      !token.trim() || /[\r\n]/.test(token) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !contract.id || !contract.evidence) throw new OutletHttpError('CONFIGURATION');
    this.contractId = contract.id;
  }
  async page(filter: Filter, cursor: string | null): Promise<OutletPage> {
    return this.contract.decodeReport(await this.get(this.contract.reportRequest(filter, cursor)));
  }
  async get(request: { path: string; query: Record<string, string> }): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(request.path, this.base);
      if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password || url.hash) throw new OutletHttpError('UNSAFE_PATH');
      for (const [key, value] of Object.entries(request.query)) url.searchParams.set(key, value);
      const response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } });
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d{1,8}$/.test(retry) ? Number(retry) : undefined;
        await response.body?.cancel(); throw new OutletHttpError(`HTTP_${response.status}`, seconds);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new OutletHttpError('INVALID_RESPONSE');
      // Bound memory as well as time; never log provider payloads or errors.
      const reader = response.body?.getReader();
      if (!reader) throw new OutletHttpError('INVALID_RESPONSE');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new OutletHttpError('RESPONSE_TOO_LARGE'); }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof OutletHttpError) throw error;
      throw new OutletHttpError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_OR_INVALID_RESPONSE');
    } finally { clearTimeout(timer); }
  }
}

export type OutletMapping = Mapping & { displayName: string; evidence: string };
// Explicit configuration only. No name/ID inference, persistence or DB writes.
export function createConfiguredOutletSource(env = loadFinanceEnvironment(), contract?: OutletHttpContract, mappings: OutletMapping[] = []) {
  if (env.OUTLET_FINANCE_API_ENABLED !== 'true') return new OutletFinanceDataSource();
  if (!contract) return { read: async () => unavailable('OUTLET', 'Missing', 'HD Outlet provider contract not verified; live blocked') };
  try {
    const verified = mappings.filter(m => m.status === 'validated' && m.evidence?.trim() && m.displayName?.trim());
    if (!verified.length) return { read: async () => ({ ...unavailable('OUTLET', 'Missing', 'Outlet mapping not verified; live blocked'), issues: [{ status: 'Unmapped' as const, reason: 'Outlet mapping not verified; live blocked' }] }) };
    const timeout = Number(env.OUTLET_FINANCE_API_TIMEOUT_MS ?? '3000');
    return new OutletFinanceDataSource(verified, new OutletHttpTransport(env.OUTLET_FINANCE_API_BASE_URL ?? '', env.OUTLET_FINANCE_API_TOKEN ?? '', timeout, contract), timeout + 100);
  } catch { return { read: async () => unavailable('OUTLET', 'Error', 'Invalid Outlet API configuration') }; }
}
