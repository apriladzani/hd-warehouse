// Google sign-in. The OAuth steps run against a fake fetch, so Google is never
// called. Account linking needs the database from backend/.env and runs on
// connection-local TEMPORARY tables, so the server's data is untouched.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { finishGoogleSignIn, GoogleSignInError, readGoogleSettings, readStateCookie, startGoogleSignIn } from '../src/googleOAuth.ts';

const dbTest = { skip: !process.env.DB_TESTS };
after(async () => { if (process.env.DB_TESTS) await (await import('./helpers/temporaryDatabase.ts')).closePool(); });

const SETTINGS = readGoogleSettings({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', APP_BASE_URL: 'https://hd.example.test/' })!;

test('Google stays off until id, secret and a callback address are all known', () => {
  assert.equal(readGoogleSettings({}), null);
  assert.equal(readGoogleSettings({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }), null, 'no callback address');
  assert.equal(SETTINGS.redirectUri, 'https://hd.example.test/api/auth/google/callback');
  assert.equal(readGoogleSettings({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/auth/google/callback' })!.redirectUri,
    'http://localhost:3000/api/auth/google/callback', 'an explicit redirect wins');
  assert.deepEqual(readGoogleSettings({ ...{ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', APP_BASE_URL: 'x' }, GOOGLE_ALLOWED_DOMAINS: ' HD.co.id, @kii.lat ' })!.allowedDomains, ['hd.co.id', 'kii.lat']);
});

test('the authorize URL carries state and a PKCE challenge derived from the cookie verifier', () => {
  const { url, cookieValue } = startGoogleSignIn(SETTINGS);
  const params = new URL(url).searchParams;
  const saved = readStateCookie(cookieValue)!;
  assert.equal(params.get('client_id'), 'cid');
  assert.equal(params.get('redirect_uri'), SETTINGS.redirectUri);
  assert.equal(params.get('scope'), 'openid email profile');
  assert.equal(params.get('state'), saved.state);
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('code_challenge'), createHash('sha256').update(saved.verifier).digest('base64url'));
  // The secret never leaves the server.
  assert.doesNotMatch(url, /secret/);
  // Two sign-ins never share a state.
  assert.notEqual(startGoogleSignIn(SETTINGS).cookieValue, cookieValue);
});

test('a tampered or empty state cookie is rejected', () => {
  assert.equal(readStateCookie(''), null);
  assert.equal(readStateCookie('only-state'), null);
  assert.equal(readStateCookie('a<b.c'), null);
  assert.deepEqual(readStateCookie('abc.def'), { state: 'abc', verifier: 'def' });
});

const fakeGoogle = (userinfo: any, tokenOk = true) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/token')) return new Response(JSON.stringify(tokenOk ? { access_token: 'at' } : { error: 'invalid_grant' }), { status: tokenOk ? 200 : 400 });
    return new Response(JSON.stringify(userinfo), { status: 200 });
  }) as typeof fetch;
  return { fetcher, calls };
};

test('a verified Google account comes back as a normalised profile', async () => {
  const google = fakeGoogle({ sub: '123', email: ' Budi@Example.TEST ', email_verified: true, name: 'Budi' });
  const profile = await finishGoogleSignIn(SETTINGS, 'code-1', 'verifier-1', google.fetcher);
  assert.deepEqual(profile, { sub: '123', email: 'budi@example.test', emailVerified: true, name: 'Budi' });
  const body = new URLSearchParams(String(google.calls[0].init?.body));
  assert.equal(body.get('code'), 'code-1');
  assert.equal(body.get('code_verifier'), 'verifier-1');
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal((google.calls[1].init?.headers as any).Authorization, 'Bearer at');
});

test('an unverified email, a foreign domain or a failed exchange never yields a profile', async () => {
  const reason = async (promise: Promise<unknown>) => { try { await promise; return 'none'; } catch (error) { return error instanceof GoogleSignInError ? error.reason : 'other'; } };
  assert.equal(await reason(finishGoogleSignIn(SETTINGS, 'c', 'v', fakeGoogle({ sub: '1', email: 'a@b.test', email_verified: false }).fetcher)), 'unverified');
  assert.equal(await reason(finishGoogleSignIn(SETTINGS, 'c', 'v', fakeGoogle({}, false).fetcher)), 'exchange');
  assert.equal(await reason(finishGoogleSignIn(SETTINGS, 'c', 'v', fakeGoogle({ email: 'no-sub@b.test' }).fetcher)), 'profile');
  const company = { ...SETTINGS, allowedDomains: ['hd.co.id'] };
  assert.equal(await reason(finishGoogleSignIn(company, 'c', 'v', fakeGoogle({ sub: '1', email: 'x@gmail.com', email_verified: true }).fetcher)), 'domain');
  assert.equal((await finishGoogleSignIn(company, 'c', 'v', fakeGoogle({ sub: '1', email: 'x@hd.co.id', email_verified: true }).fetcher)).email, 'x@hd.co.id');
});

test('Google sign-in links, reuses, creates and refuses accounts correctly', dbTest, async () => {
  const { withTemporaryDatabase } = await import('./helpers/temporaryDatabase.ts');
  await withTemporaryDatabase(async (connection) => {
    const { signInWithGoogle } = await import('../src/db/repository.ts');
    const { verifyFinanceLoginPassword } = await import('../src/finance/authentication.ts');
    await connection.query("INSERT INTO users (name, username, email, password, role, is_active) VALUES ('Staff Gudang', 'warehouse', 'warehouse@hd.com', 'warehouse123', 'WAREHOUSE', 1)");
    const [[existing]]: any = await connection.query("SELECT id FROM users WHERE username = 'warehouse'");

    // An existing account is linked by its verified email, keeping its role.
    const first = await signInWithGoogle({ sub: 'g-1', email: 'warehouse@hd.com', name: 'Staff' });
    assert.deepEqual(first, { status: 'ok', userId: Number(existing.id), created: false, linked: true });
    const [[afterLink]]: any = await connection.query('SELECT uid, role, password FROM users WHERE id = ?', [Number(existing.id)]);
    assert.equal(afterLink.uid, 'google:g-1');
    assert.equal(afterLink.role, 'WAREHOUSE');
    assert.equal(afterLink.password, 'warehouse123', 'linking leaves the password login working');

    // Next time it is found by the Google id, even if the Google email changed.
    assert.deepEqual(await signInWithGoogle({ sub: 'g-1', email: 'renamed@gmail.com', name: 'Staff' }), { status: 'ok', userId: Number(existing.id), created: false, linked: false });

    // A different Google account with the same email cannot take it over.
    assert.deepEqual(await signInWithGoogle({ sub: 'g-2', email: 'warehouse@hd.com', name: 'Other' }), { status: 'conflict' });

    // A new person gets a fresh Outlet account with an unguessable password.
    await connection.query("INSERT INTO users (name, username, email, password, role, is_active) VALUES ('Taken', 'budi', 'budi.other@hd.com', 'x', 'OUTLET', 1)");
    const created = await signInWithGoogle({ sub: 'g-3', email: 'budi@gmail.com', name: 'Budi Santoso' });
    assert.equal(created.status, 'ok');
    assert.equal((created as any).created, true);
    const [[fresh]]: any = await connection.query('SELECT username, role, uid, password, is_active AS isActive FROM users WHERE id = ?', [(created as any).userId]);
    assert.equal(fresh.username, 'budi2', 'the taken username gets a suffix');
    assert.equal(fresh.role, 'OUTLET');
    assert.equal(fresh.uid, 'google:g-3');
    assert.equal(Number(fresh.isActive), 1);
    assert.match(fresh.password, /^scrypt\$/);
    assert.equal(await verifyFinanceLoginPassword('', fresh.password), false);

    // A disabled account stays disabled, whether found by id or by email.
    await connection.query("UPDATE users SET is_active = 0 WHERE id = ?", [(created as any).userId]);
    assert.deepEqual(await signInWithGoogle({ sub: 'g-3', email: 'budi@gmail.com', name: 'Budi' }), { status: 'inactive' });
    await connection.query("INSERT INTO users (name, username, email, password, role, is_active) VALUES ('Off', 'off', 'off@hd.com', 'x', 'OUTLET', 0)");
    assert.deepEqual(await signInWithGoogle({ sub: 'g-4', email: 'off@hd.com', name: 'Off' }), { status: 'inactive' });
  });
});
