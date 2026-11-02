// Self-service password reset. The pure parts (mail settings, message body)
// run anywhere; the token lifecycle needs the database from backend/.env and
// runs against connection-local TEMPORARY tables, so the server's data and
// schema are untouched.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { passwordResetMessage, readMailSettings, resetPasswordUrl } from '../src/mail.ts';

const dbTest = { skip: !process.env.DB_TESTS };
after(async () => { if (process.env.DB_TESTS) await (await import('./helpers/temporaryDatabase.ts')).closePool(); });

test('mail stays off until a host and a sender are both configured', () => {
  assert.equal(readMailSettings({}), null);
  assert.equal(readMailSettings({ SMTP_HOST: 'smtp.example.test' }), null, 'no sender');
  assert.equal(readMailSettings({ SMTP_FROM: 'a@example.test' }), null, 'no host');
  assert.equal(readMailSettings({ SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'a@b.test', SMTP_PORT: '0' }), null, 'bad port');

  const settings = readMailSettings({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'bot@example.test', SMTP_PASSWORD: 'x' });
  assert.equal(settings?.port, 587);
  assert.equal(settings?.secure, false, '587 upgrades with STARTTLS');
  assert.equal(settings?.from, 'bot@example.test', 'falls back to the SMTP user');

  assert.equal(readMailSettings({ SMTP_HOST: 'h', SMTP_FROM: 'f', SMTP_PORT: '465' })?.secure, true, '465 is implicit TLS');
  assert.equal(readMailSettings({ SMTP_HOST: 'h', SMTP_FROM: 'f', SMTP_PORT: '465', SMTP_SECURE: 'false' })?.secure, false, 'explicit wins');
});

test('the reset link carries the token and survives a trailing slash', () => {
  const settings = readMailSettings({ SMTP_HOST: 'h', SMTP_FROM: 'f', APP_BASE_URL: 'https://hd.example.test/' })!;
  assert.equal(resetPasswordUrl(settings, 'abc+/='), 'https://hd.example.test/reset-password?token=abc%2B%2F%3D');
});

test('the email says what the link does, how long it lasts, and what to do if unwanted', () => {
  const message = passwordResetMessage('Budi <script>', 'https://hd.example.test/reset-password?token=t&a=b', 60, 'budi@example.test');
  assert.equal(message.subject, 'Atur ulang password HD Hub Management');
  assert.ok(message.subject.length <= 50, 'DESIGN.md: subject at most 50 characters');
  for (const body of [message.text, message.html]) {
    assert.match(body, /1 jam/, 'sixty minutes read as one hour');
    assert.match(body, /hanya bisa dipakai satu kali/);
    assert.match(body, /Abaikan email ini/);
    assert.match(body, /budi@example\.test/, 'names the account being reset');
  }
  assert.match(passwordResetMessage('x', 'https://a.test/r', 90).text, /90 menit/);
  // The name and link are interpolated into HTML, so they must be escaped.
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /Budi &lt;script&gt;/);
  assert.match(message.html, /token=t&amp;a=b/);
});

test('the email follows the DESIGN.md mail rules', () => {
  const message = passwordResetMessage('Budi', 'https://hdhub.example.test/reset-password?token=abc', 60);
  const html = message.html;
  assert.ok(Buffer.byteLength(html) < 102 * 1024, 'under the Gmail clipping limit');
  assert.match(html, /<html lang="id"/);
  assert.match(html, /role="presentation"/);
  assert.doesNotMatch(html, /<svg|data:image|<script/i, 'no SVG, data URIs or script');
  // Exactly one call to action, in brand red, with an Outlook (VML) twin.
  assert.equal(html.match(/>Atur Ulang Password &rarr;</g)?.length, 2, 'VML button plus the regular button');
  assert.match(html, /<v:roundrect[^>]+fillcolor="#DC2626"/);
  assert.match(html, /background:#DC2626;[^"]*color:#FFFFFF/);
  // Fallback link, preheader, dashboard taken from the link's own origin.
  assert.match(html, /Tombol tidak berfungsi\? Salin link ini ke browser/);
  assert.match(html, /display:none[^>]*>Link berlaku selama 1 jam\./);
  // Footer (DESIGN.md §5.8, §5.10): help, support inbox, four links and the legal line.
  for (const [label, path] of [['Dashboard', ''], ['Bantuan', '/bantuan'], ['Syarat &amp; Ketentuan', '/syarat-ketentuan'], ['Kebijakan Privasi', '/kebijakan-privasi']]) {
    assert.match(html, new RegExp(`href="https://hdhub\\.example\\.test${path}"[^>]*>${label}<`), label);
  }
  assert.match(html, />Pusat Bantuan</);
  assert.match(html, /href="mailto:support@hdhub\.kii\.lat"/);
  assert.match(html, /PT HD FriedChicken &middot; /);
  assert.match(html, /terdaftar sebagai pengguna HD Hub Management/);
  assert.match(message.text, /PT HD FriedChicken/);
  // Every image has alt text and size, and the hero ships inside the message.
  for (const img of html.match(/<img [^>]+>/g) ?? []) {
    assert.match(img, /alt="[^"]+"/);
    assert.match(img, /width="\d+"/);
    assert.match(img, /height="\d+"/);
  }
  const [hero] = message.attachments;
  assert.match(html, new RegExp(`src="cid:${hero.cid}"`));
  assert.equal(hero.contentType, 'image/png');
  assert.equal(hero.contentDisposition, 'inline');
  assert.equal(hero.content.subarray(1, 4).toString(), 'PNG');
  // Dark mode and the mobile breakpoint are declared for the clients that read them.
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /max-width:480px/);
});

test('a reset token is single-use, and using it changes the password', dbTest, async () => {
  const { withTemporaryDatabase } = await import('./helpers/temporaryDatabase.ts');
  await withTemporaryDatabase(async (connection) => {
    const { createPasswordResetToken, findPasswordResetToken, consumePasswordResetToken } = await import('../src/db/repository.ts');
    const { verifyFinanceLoginPassword } = await import('../src/finance/authentication.ts');

    await connection.query(
      "INSERT INTO users (name, username, email, password, role, is_active) VALUES ('Budi', 'budi', 'budi@example.test', 'lama', 'OUTLET', 1)",
    );
    const [[user]]: any = await connection.query("SELECT id FROM users WHERE username = 'budi'");

    // Username and email both reach the same account.
    const byEmail = await createPasswordResetToken('BUDI@EXAMPLE.TEST');
    assert.equal(byEmail?.userId, Number(user.id));
    const created = await createPasswordResetToken('budi');
    assert.equal(created?.userId, Number(user.id));

    // Requesting again replaces the earlier link rather than adding to it.
    assert.equal(await findPasswordResetToken(byEmail!.token), null, 'the superseded link stops working');
    const [[count]]: any = await connection.query('SELECT COUNT(*) AS n FROM password_reset_tokens');
    assert.equal(Number(count.n), 1);

    // The raw token is never stored.
    const [[stored]]: any = await connection.query('SELECT token_hash FROM password_reset_tokens');
    assert.notEqual(stored.token_hash, created!.token);
    assert.match(stored.token_hash, /^[a-f0-9]{64}$/);

    assert.ok(await findPasswordResetToken(created!.token));
    assert.equal(await consumePasswordResetToken(created!.token, 'rahasia-baru'), true);

    const [[after_]]: any = await connection.query('SELECT password FROM users WHERE id = ?', [Number(user.id)]);
    assert.match(after_.password, /^scrypt\$/, 'stored hashed, never in the clear');
    assert.equal(await verifyFinanceLoginPassword('rahasia-baru', after_.password), true);
    assert.equal(await verifyFinanceLoginPassword('lama', after_.password), false);

    // Replay is refused and the row is gone.
    assert.equal(await consumePasswordResetToken(created!.token, 'sekali-lagi'), false);
    const [[left]]: any = await connection.query('SELECT COUNT(*) AS n FROM password_reset_tokens');
    assert.equal(Number(left.n), 0);
  });
});

test('expired links, unknown logins and disabled accounts get no usable token', dbTest, async () => {
  const { withTemporaryDatabase } = await import('./helpers/temporaryDatabase.ts');
  await withTemporaryDatabase(async (connection) => {
    const { createPasswordResetToken, findPasswordResetToken, consumePasswordResetToken } = await import('../src/db/repository.ts');

    assert.equal(await createPasswordResetToken('tidak-ada@example.test'), null);
    assert.equal(await createPasswordResetToken(''), null);

    await connection.query(
      "INSERT INTO users (name, username, email, password, role, is_active) VALUES ('Mati', 'mati', 'mati@example.test', 'x', 'OUTLET', 0)",
    );
    assert.equal(await createPasswordResetToken('mati'), null, 'a disabled account cannot reset');

    await connection.query(
      "INSERT INTO users (name, username, email, password, role, is_active) VALUES ('Siti', 'siti', 'siti@example.test', 'x', 'OUTLET', 1)",
    );
    const created = await createPasswordResetToken('siti');
    await connection.query('UPDATE password_reset_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)');
    assert.equal(await findPasswordResetToken(created!.token), null);
    assert.equal(await consumePasswordResetToken(created!.token, 'password-baru'), false);

    // Deactivating the account after the link was sent also closes it.
    const second = await createPasswordResetToken('siti');
    await connection.query("UPDATE users SET is_active = 0 WHERE username = 'siti'");
    assert.equal(await findPasswordResetToken(second!.token), null);
  });
});
