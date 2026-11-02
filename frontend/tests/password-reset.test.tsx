import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeTransportFailure, MALFORMED_REPLY_MESSAGE, OFFLINE_MESSAGE, UNREACHABLE_MESSAGE, type JsonResult } from '../src/lib/authRequest.ts';
import { MIN_PASSWORD_LENGTH, ResetPasswordPage, describePasswordProblem } from '../src/components/common/ResetPasswordPage.tsx';
import { ForgotPasswordPage } from '../src/components/common/ForgotPasswordPage.tsx';

const result = (over: Partial<JsonResult> = {}): JsonResult => ({ ok: false, status: 400, data: null, online: true, parsed: true, ...over });

test('transport failures are named the same way on every auth screen', () => {
  assert.equal(describeTransportFailure(result({ online: false })), OFFLINE_MESSAGE);
  assert.equal(describeTransportFailure(result({ status: null })), UNREACHABLE_MESSAGE);
  // Offline wins: a status code cannot arrive without a network.
  assert.equal(describeTransportFailure(result({ status: 401, online: false })), OFFLINE_MESSAGE);

  assert.match(describeTransportFailure(result({ status: 500 }))!, /gangguan di server/);
  assert.match(describeTransportFailure(result({ status: 503 }))!, /Coba lagi nanti|belum tersedia/);
  assert.match(describeTransportFailure(result({ status: 429 }))!, /Tunggu beberapa saat|Terlalu banyak/);

  // A reply that is not JSON cannot be the route's own validation talking, so
  // it is never reported as a problem with what the user typed.
  assert.equal(describeTransportFailure(result({ status: 400, parsed: false })), MALFORMED_REPLY_MESSAGE);

  // Screen-specific cases are left to the screen.
  assert.equal(describeTransportFailure(result({ status: 400 })), null);
  assert.equal(describeTransportFailure(result({ status: 401 })), null);
});

test('a new password is checked for length and for a matching confirmation', () => {
  assert.match(describePasswordProblem('', '')!, new RegExp(`minimal ${MIN_PASSWORD_LENGTH}`));
  assert.match(describePasswordProblem('abc', 'abc')!, new RegExp(`minimal ${MIN_PASSWORD_LENGTH}`));
  assert.match(describePasswordProblem('rahasia', '')!, /Ulangi password baru/);
  assert.match(describePasswordProblem('rahasia', 'rahasi')!, /belum sama/);
  assert.equal(describePasswordProblem('rahasia', 'rahasia'), null);
});

test('the forgot form asks for one identifier and promises nothing about the account', () => {
  const html = renderToStaticMarkup(<ForgotPasswordPage onNavigateToLogin={() => {}} />);
  assert.match(html, /Username \/ Email/);
  assert.match(html, /Kirim Tautan Reset/);
  assert.match(html, /id="forgot-login"/);
  // The old dead button is gone for good.
  assert.doesNotMatch(html, /Kirim Link Reset/);
  // Nothing on the resting form claims an email was sent.
  assert.doesNotMatch(html, /sudah dikirim/);
});

test('the reset screen checks the link before offering the form', () => {
  const html = renderToStaticMarkup(<ResetPasswordPage token="t" onNavigateToLogin={() => {}} onNavigateToForgotPassword={() => {}} />);
  // First paint is the check, not a password form the link may not have earned.
  assert.match(html, /Memeriksa tautan reset password/);
  assert.doesNotMatch(html, /<input/);
});

test('the reset screen takes its token from the caller, not from the page', () => {
  const page = <ResetPasswordPage token="abc123" onNavigateToLogin={() => {}} onNavigateToForgotPassword={() => {}} />;
  assert.equal((page.props as any).token, 'abc123');
});
