import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeGoogleError, GOOGLE_SIGN_IN_URL, googleErrorKind, readGoogleOutcome } from '../src/lib/googleSignIn.ts';
import { GoogleSignInButton } from '../src/components/common/AuthUI.tsx';

test('the redirect outcome is read from the query string without side effects', () => {
  assert.deepEqual(readGoogleOutcome('?oauth=ok'), { ok: true, error: null });
  assert.deepEqual(readGoogleOutcome('?oauth_error=state'), { ok: false, error: 'state' });
  assert.deepEqual(readGoogleOutcome(''), { ok: false, error: null });
  assert.deepEqual(readGoogleOutcome('?oauth=maybe'), { ok: false, error: null });
});

test('every server outcome code becomes a sentence that says what to do next', () => {
  for (const code of ['unconfigured', 'cancelled', 'state', 'exchange', 'profile', 'unverified', 'domain', 'inactive', 'conflict', 'server']) {
    const message = describeGoogleError(code)!;
    assert.ok(message.length > 20, code);
    assert.match(message, /coba|hubungi|gunakan|verifikasi|masuk|mulai/i, `${code}: ${message}`);
  }
  // An unknown code is still explained, never shown raw.
  assert.equal(describeGoogleError('weird'), describeGoogleError('server'));
  assert.equal(describeGoogleError(null), null);
});

test('cancelling is the user\'s own choice and is not shown as an error', () => {
  assert.equal(googleErrorKind('cancelled'), 'info');
  assert.equal(googleErrorKind('state'), 'error');
});

test('the Google button is a plain link to the server, with the brand mark and a divider', () => {
  const html = renderToStaticMarkup(<GoogleSignInButton href={GOOGLE_SIGN_IN_URL} />);
  assert.match(html, /href="\/api\/auth\/google"/);
  assert.match(html, /Lanjutkan dengan Google/);
  assert.match(html, /role="separator"/);
  for (const colour of ['#EA4335', '#4285F4', '#FBBC05', '#34A853']) assert.match(html, new RegExp(colour));
  assert.match(renderToStaticMarkup(<GoogleSignInButton href={GOOGLE_SIGN_IN_URL} label="Daftar dengan Google" />), /Daftar dengan Google/);
});
