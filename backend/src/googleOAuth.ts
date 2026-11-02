import { createHash, randomBytes } from 'node:crypto';

// Google sign-in with the authorization-code flow and PKCE. No SDK: the flow
// is two HTTPS calls, and the profile comes from Google's userinfo endpoint
// over TLS, so there is no ID token signature to verify locally.
export type GoogleSettings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  // Empty means any Google account may sign in.
  allowedDomains: string[];
};

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string };

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

export function readGoogleSettings(env: NodeJS.ProcessEnv = process.env): GoogleSettings | null {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  const base = String(env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  const redirectUri = String(env.GOOGLE_REDIRECT_URI || '').trim() || (base ? `${base}${GOOGLE_CALLBACK_PATH}` : '');
  if (!clientId || !clientSecret || !redirectUri) return null;
  const allowedDomains = String(env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  return { clientId, clientSecret, redirectUri, allowedDomains };
}

const base64url = (buffer: Buffer) => buffer.toString('base64url');

// The state and the PKCE verifier travel together in one short-lived cookie;
// the callback is only honoured when the state Google echoes back matches it.
export function startGoogleSignIn(settings: GoogleSettings) {
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${AUTHORIZE_URL}?${params}`, cookieValue: `${state}.${verifier}` };
}

export function readStateCookie(value: string) {
  const [state, verifier] = value.split('.');
  return state && verifier && /^[A-Za-z0-9_-]+$/.test(state) && /^[A-Za-z0-9_-]+$/.test(verifier) ? { state, verifier } : null;
}

export class GoogleSignInError extends Error {
  constructor(public readonly reason: 'exchange' | 'profile' | 'unverified' | 'domain') { super(reason); }
}

export async function finishGoogleSignIn(settings: GoogleSettings, code: string, verifier: string, fetcher: typeof fetch = fetch): Promise<GoogleProfile> {
  const tokenResponse = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      redirect_uri: settings.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tokens: any = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || typeof tokens?.access_token !== 'string') throw new GoogleSignInError('exchange');

  const profileResponse = await fetcher(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const info: any = await profileResponse.json().catch(() => null);
  if (!profileResponse.ok || typeof info?.sub !== 'string' || typeof info?.email !== 'string') throw new GoogleSignInError('profile');

  const profile: GoogleProfile = {
    sub: info.sub,
    email: info.email.trim().toLowerCase(),
    emailVerified: info.email_verified === true || info.email_verified === 'true',
    name: String(info.name || info.email.split('@')[0]).trim(),
  };
  // An unverified address proves nothing about who owns it, so it can never
  // be used to find, link or create an account.
  if (!profile.emailVerified) throw new GoogleSignInError('unverified');
  const domain = profile.email.split('@')[1] || '';
  if (settings.allowedDomains.length && !settings.allowedDomains.includes(domain)) throw new GoogleSignInError('domain');
  return profile;
}
