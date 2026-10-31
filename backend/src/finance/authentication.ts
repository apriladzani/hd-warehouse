import { createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request } from 'express';
import type { SelectExecutor } from './WarehouseFinanceDataSource.ts';
import type { FinancePrincipal } from './router.ts';
import { financeFailure } from './readOnlyConnection.ts';
const derive = promisify(scrypt);
const safeEqual = (left: string, right: string) => {
  const a = createHash('sha256').update(left).digest(), b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
};
export async function verifyFinanceLoginPassword(password: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== 'string' || !stored) return false;
  const match = /^scrypt\$([a-f\d]{32})\$([a-f\d]{128})$/i.exec(stored);
  if (!match) return safeEqual(password, stored) || safeEqual(password, stored.replace(/(?:\r\n|\n|\r)$/, ''));
  const expected = Buffer.from(match[2], 'hex');
  const actual = await derive(password, Buffer.from(match[1], 'hex'), expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}
export function financeCookie(req: Request): string {
  const raw = String(req.header('Cookie') ?? '').split(';').map(p => p.trim()).find(p => p.startsWith('hd_finance_access='));
  if (!raw) return '';
  try { const token = decodeURIComponent(raw.slice('hd_finance_access='.length)); return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''; }
  catch { return ''; }
}
export function createFinanceReadAuthenticator(db: SelectExecutor) {
  async function identity(req: Request) {
    const login = String(req.header('X-Auth-Email') ?? '').trim().toLowerCase();
    const password = String(req.header('X-Auth-Password') ?? '');
    if (!login || !password || login.length > 255 || Buffer.byteLength(password, 'utf8') > 1024) return null;
    const rows = await db.select(`SELECT id, role, password, is_active AS isActive FROM users
      WHERE (LOWER(email) = ? OR LOWER(username) = ?) LIMIT 2`, [login, login]);
    // Ambiguous email/username identities fail closed, no in-memory seed fallback.
    if (rows.length !== 1 || Number(rows[0].isActive) !== 1 || !await verifyFinanceLoginPassword(password, rows[0].password)) return null;
    const id = Number(rows[0].id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return { id, role: String(rows[0].role).toUpperCase() };
  }
  async function gate(userId: number, token: string) {
    if (!token) return { configured: false, active: false, expiresIn: 0 };
    const rows = await db.select(`SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), s.expires_at)) AS expiresIn
      FROM finance_access_sessions s JOIN finance_security f ON f.id = 1
      WHERE s.token_hash = ? AND s.user_id = ? AND s.password_version = f.password_version
      AND f.password_hash IS NOT NULL AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`, [createHash('sha256').update(token).digest('hex'), userId]);
    const seconds = Number(rows[0]?.expiresIn ?? 0);
    return { configured: true, active: Number.isFinite(seconds) && seconds > 0, expiresIn: Math.max(0, Math.min(900, seconds || 0)) };
  }
  return {
    identity,
    gate,
    async authenticate(req: Request): Promise<FinancePrincipal | null> {
      try {
        const user = await identity(req);
        if (!user) return null;
        return { role: user.role, warehouseGateVerified: user.role === 'WAREHOUSE' ? (await gate(user.id, financeCookie(req))).active : false };
      } catch (error) { throw financeFailure(error, 'authentication'); }
    },
    async status(req: Request) {
      const user = await identity(req);
      if (!user || user.role !== 'WAREHOUSE') return null;
      const security = await db.select('SELECT password_hash IS NOT NULL AS configured FROM finance_security WHERE id = 1', []);
      if (!security.length || !Number(security[0].configured)) return { configured: false, active: false, expiresIn: 0 };
      const session = await gate(user.id, financeCookie(req));
      return { ...session, configured: true };
    },
  };
}
