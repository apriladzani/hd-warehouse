import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeLoginFailure } from '../src/components/common/LoginPage.tsx';
import { MALFORMED_REPLY_MESSAGE } from '../src/lib/authRequest.ts';
import { AuthButton, AuthInput, PasswordInput } from '../src/components/common/AuthUI.tsx';

test('a failed login names its own cause instead of always blaming the password', () => {
  // The case that used to be wrong: the request never reached the server, and
  // the user was told to check credentials that were never even read.
  assert.match(describeLoginFailure(null, undefined, false), /tidak terhubung ke jaringan/);
  assert.match(describeLoginFailure(null, undefined, true), /Tidak bisa menghubungi server/);

  assert.match(describeLoginFailure(401, 'Email atau password salah', true), /salah/);
  assert.match(describeLoginFailure(503, 'Sumber autentikasi operasional tidak tersedia.', true), /Coba lagi beberapa saat/);
  assert.match(describeLoginFailure(500, undefined, true), /gangguan di server/);
  assert.match(describeLoginFailure(400, 'Email dan password wajib diisi', true), /wajib diisi/);

  // Every branch tells the user what to do next, not just what went wrong.
  for (const status of [null, 400, 401, 429, 500, 503]) {
    const message = describeLoginFailure(status, undefined, true);
    assert.ok(/coba lagi|administrator|wajib diisi/i.test(message), `${status}: ${message}`);
  }
});

test('a non-JSON error body never gets blamed on the fields the user typed', () => {
  // The real case: body-parser was broken, so every POST came back 400 with an
  // HTML error page. The user had filled both fields and was still told they
  // were empty.
  const message = describeLoginFailure(400, undefined, true, false);
  assert.equal(message, MALFORMED_REPLY_MESSAGE);
  assert.doesNotMatch(message, /wajib diisi/);
  assert.match(message, /masalah di server/);
  // A 400 that does explain itself in JSON is still passed through.
  assert.match(describeLoginFailure(400, 'Email dan password wajib diisi', true, true), /wajib diisi/);
});

test('offline beats the status code: a response cannot arrive without a network', () => {
  assert.equal(describeLoginFailure(401, 'Email atau password salah', false), describeLoginFailure(null, undefined, false));
});

test('the backend 503 wording never reaches the user', () => {
  assert.doesNotMatch(describeLoginFailure(503, 'Sumber autentikasi operasional tidak tersedia.', true), /Sumber autentikasi/);
});

test('a rejected attempt marks both fields invalid for assistive tech', () => {
  const field = renderToStaticMarkup(<AuthInput id="login-email" invalid />);
  assert.match(field, /aria-invalid="true"/);
  assert.match(field, /hd-auth-input--invalid/);

  const clean = renderToStaticMarkup(<AuthInput id="login-email" />);
  assert.doesNotMatch(clean, /aria-invalid/);
  assert.doesNotMatch(clean, /hd-auth-input--invalid/);
});

test('the password field accepts an outside ref so focus can return to it', () => {
  const ref = React.createRef<HTMLInputElement>();
  const html = renderToStaticMarkup(<PasswordInput id="login-password" value="" onChange={() => {}} inputRef={ref} invalid describedBy="login-error" />);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="login-error"/);
  // The Caps Lock hint is keyboard-driven, so it is absent until a key reports it.
  assert.doesNotMatch(html, /Caps Lock aktif/);
});

test('a submitting button reports itself busy, not just disabled', () => {
  const busy = renderToStaticMarkup(<AuthButton loading>Masuk</AuthButton>);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /disabled=""/);
  assert.match(busy, /Memproses/);

  assert.doesNotMatch(renderToStaticMarkup(<AuthButton>Masuk</AuthButton>), /aria-busy/);
});
