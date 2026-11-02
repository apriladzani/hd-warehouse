import { financeFailure } from './readOnlyConnection.ts';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SelectExecutor } from './WarehouseFinanceDataSource.ts';
import { createFinanceReadAuthenticator, financeCookie, verifyFinanceLoginPassword } from './authentication.ts';
const COOKIE = 'hd_operational_session';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Process-local: restart revokes all sessions. Never persists passwords/tokens.
export function createOperationalSessions(source: SelectExecutor, now = Date.now) {
  const db: SelectExecutor = { select: async (sql, params) => { try { return await source.select(sql, params); } catch (error) { throw financeFailure(error, 'authentication'); } } };
  const sessions = new Map<string, { id: number; credential: string; expires: number }>();
  const gateReader = createFinanceReadAuthenticator(db);
  function token(req: Request) {
    const raw = String(req.header('Cookie') ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
    return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : '';
  }
  function cookie(res: Response, value: string, age: number) {
    res.append('Set-Cookie', `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.setHeader('Cache-Control', 'no-store');
  }
  function prune() { for (const [key, entry] of sessions) if (entry.expires <= now()) sessions.delete(key); }
  async function identity(req: Request) {
    prune(); const key = hash(token(req)), entry = sessions.get(key); if (!entry) return null;
    const rows = await db.select('SELECT id, name, username, email, role, password, is_active AS isActive FROM users WHERE id = ? LIMIT 2', [entry.id]);
    const row = rows[0];
    if (rows.length !== 1 || Number(row.isActive) !== 1 || typeof row.password !== 'string' || hash(row.password) !== entry.credential) { sessions.delete(key); return null; }
    return { id: entry.id, name: String(row.name), username: String(row.username ?? ''), email: String(row.email), role: String(row.role).toUpperCase() === 'USER' ? 'OUTLET' : String(row.role).toUpperCase() };
  }
  function start(req: Request, res: Response, row: any) {
    prune(); if (sessions.size >= 10000) throw new Error('Session capacity exceeded');
    const raw = randomBytes(32).toString('base64url'); sessions.delete(hash(token(req)));
    sessions.set(hash(raw), { id: Number(row.id), credential: hash(String(row.password)), expires: now() + 8 * 3600000 }); cookie(res, raw, 8 * 3600);
    return { id: Number(row.id), name: String(row.name), username: String(row.username ?? ''), email: String(row.email), role: String(row.role).toUpperCase() === 'USER' ? 'OUTLET' : String(row.role).toUpperCase() };
  }
  return {
    async login(req: Request, res: Response, login: unknown, password: unknown) {
      if (typeof login !== 'string' || typeof password !== 'string' || !password || login.length > 255 || Buffer.byteLength(password) > 1024) return null;
      const rows = await db.select('SELECT id, name, username, email, role, password, is_active AS isActive FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) LIMIT 2', [login.trim().toLowerCase(), login.trim().toLowerCase()]);
      const row = rows[0];
      if (rows.length !== 1 || Number(row.isActive) !== 1 || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || !await verifyFinanceLoginPassword(password, row.password)) return null;
      return start(req, res, row);
    },
    // For a user already proven by another means (Google sign-in). The session
    // is still bound to the stored password hash, so a later password change
    // ends it exactly like a password login.
    async loginVerifiedUser(req: Request, res: Response, userId: number) {
      if (!Number.isSafeInteger(userId) || userId <= 0) return null;
      const rows = await db.select('SELECT id, name, username, email, role, password, is_active AS isActive FROM users WHERE id = ? LIMIT 2', [userId]);
      const row = rows[0];
      if (rows.length !== 1 || Number(row.isActive) !== 1 || typeof row.password !== 'string' || !row.password) return null;
      return start(req, res, row);
    },
    logout(req: Request, res: Response) { sessions.delete(hash(token(req))); cookie(res, '', 0); },
    identity,
    async authenticate(req: Request) {
      const user = await identity(req); if (!user) return null;
      return { role: user.role, warehouseGateVerified: user.role === 'WAREHOUSE' ? (await gateReader.gate(user.id, financeCookie(req))).active : false };
    },
    async status(req: Request) {
      const user = await identity(req); if (!user || user.role !== 'WAREHOUSE') return null;
      const rows = await db.select('SELECT password_hash IS NOT NULL AS configured FROM finance_security WHERE id = 1', []);
      if (!rows.length || !Number(rows[0].configured)) return { configured: false, active: false, expiresIn: 0 };
      return { ...await gateReader.gate(user.id, financeCookie(req)), configured: true };
    },
  };
}
