import nodemailer, { type Transporter } from 'nodemailer';
import { HERO_RESET_PASSWORD_PNG_BASE64 } from './emailAssets.ts';

// Mail is optional: the app runs without SMTP, and the features that need it
// report that they are unavailable rather than failing at startup.
export type MailSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  baseUrl: string;
};

export function readMailSettings(env: NodeJS.ProcessEnv = process.env): MailSettings | null {
  const host = String(env.SMTP_HOST || '').trim();
  const from = String(env.SMTP_FROM || env.SMTP_USER || '').trim();
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return {
    host,
    port,
    // Port 465 is implicit TLS; 587 and 25 upgrade with STARTTLS instead.
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user: String(env.SMTP_USER || '').trim(),
    password: String(env.SMTP_PASSWORD || ''),
    from,
    baseUrl: String(env.APP_BASE_URL || '').trim().replace(/\/+$/, ''),
  };
}

export const isMailConfigured = (env: NodeJS.ProcessEnv = process.env) => readMailSettings(env) !== null;

let cached: { settings: MailSettings; transport: Transporter } | null = null;

function transportFor(settings: MailSettings) {
  if (cached && JSON.stringify(cached.settings) === JSON.stringify(settings)) return cached.transport;
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
  });
  cached = { settings, transport };
  return transport;
}

export const resetPasswordUrl = (settings: MailSettings, token: string) =>
  `${settings.baseUrl || ''}/reset-password?token=${encodeURIComponent(token)}`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string
));

// Durations read the way people say them: 60 becomes "1 jam", 90 stays
// "90 menit".
const formatDuration = (minutes: number) =>
  minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} jam` : `${minutes} menit`;

export const HERO_RESET_PASSWORD_CID = 'hero-reset-password@hdhub';

export function passwordResetMessage(name: string, link: string, minutes: number, email?: string) {
  const duration = formatDuration(minutes);
  const account = email ? `akun ${email}` : 'akun HD Hub Management kamu';
  return {
    subject: 'Atur ulang password HD Hub Management',
    text: [
      'Atur ulang password kamu',
      '',
      `Halo ${name || 'Pengguna'}, kami menerima permintaan untuk mengatur ulang password ${account}.`,
      `Buka link berikut untuk membuat password baru. Link ini berlaku selama ${duration} dan hanya bisa dipakai satu kali.`,
      '',
      link,
      '',
      'Tidak meminta reset password? Abaikan email ini, password kamu tetap aman.',
      '',
      `Ada pertanyaan? Hubungi ${EMAIL_ORG.supportEmail}.`,
      '',
      '-- ',
      `Kamu menerima email ini karena terdaftar sebagai pengguna ${EMAIL_ORG.brand}.`,
      `${EMAIL_ORG.company} · ${EMAIL_ORG.address}`,
      `© ${new Date().getFullYear()} ${EMAIL_ORG.brand}. Hak cipta dilindungi.`,
    ].join('\n'),
    html: resetEmailHtml({
      name: escapeHtml(name || 'Pengguna'),
      email: email ? escapeHtml(email) : null,
      link: escapeHtml(link),
      dashboard: dashboardUrl(link),
      duration,
    }),
    // The hero travels inside the message as an inline (cid:) image, so it
    // needs no public hosting and is not blocked like SVG or data: URIs.
    attachments: [{
      filename: 'atur-ulang-password.png',
      content: Buffer.from(HERO_RESET_PASSWORD_PNG_BASE64, 'base64'),
      contentType: 'image/png',
      cid: HERO_RESET_PASSWORD_CID,
      contentDisposition: 'inline' as const,
    }],
  };
}

// The app's own address, taken from the reset link, for the footer.
function dashboardUrl(link: string) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? escapeHtml(url.origin) : null;
  } catch {
    return null;
  }
}

// Layout and tokens follow DESIGN.md (Email Templates). Mail clients are not
// browsers: Outlook renders through Word, Gmail ignores most of <head>, and
// flexbox, grid and SVG are unavailable. So every visual rule is inline on a
// nested table; <style> carries only what inline styles cannot express - the
// mobile breakpoint and dark mode - for the clients that honour it. The logo
// is drawn in HTML rather than an image so it survives blocked images, and
// the button has a VML twin so Outlook desktop shows a real rounded button.
const T = {
  brand: '#DC2626',
  heading: '#0F172A',
  body: '#334155',
  muted: '#64748B',
  subtle: '#94A3B8',
  border: '#E2E8F0',
  separator: '#CBD5E1',
  canvas: '#F8FAFC',
  surface: '#FFFFFF',
  onPrimary: '#FFFFFF',
} as const;
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Who sends the email, shown in every footer (DESIGN.md §5.8 and §5.10).
// DUMMY: the address, the support inbox and the three help pages are
// placeholders until the real ones exist. The pages are not routes in the app
// yet, so they open the login screen.
export const EMAIL_ORG = {
  brand: 'HD Hub Management',
  company: 'PT HD FriedChicken',
  address: 'Jl. Contoh Raya No. 123, Jakarta Selatan 12345', // DUMMY
  supportEmail: 'support@hdhub.kii.lat', // DUMMY
  helpPath: '/bantuan', // DUMMY
  termsPath: '/syarat-ketentuan', // DUMMY
  privacyPath: '/kebijakan-privasi', // DUMMY
} as const;

function footerLinks(origin: string) {
  const separator = `<span style="color:${T.separator};">&nbsp;|&nbsp;</span>`;
  return [
    ['Dashboard', origin],
    ['Bantuan', `${origin}${EMAIL_ORG.helpPath}`],
    ['Syarat &amp; Ketentuan', `${origin}${EMAIL_ORG.termsPath}`],
    ['Kebijakan Privasi', `${origin}${EMAIL_ORG.privacyPath}`],
  ].map(([label, href]) => `<a class="text-muted" href="${href}" style="color:${T.muted};text-decoration:none;white-space:nowrap;">${label}</a>`).join(separator);
}

function resetEmailHtml(m: { name: string; email: string | null; link: string; dashboard: string | null; duration: string }) {
  const account = m.email ? `akun <strong class="text-heading" style="color:${T.heading};font-weight:600;">${m.email}</strong>` : 'akun HD Hub Management kamu';
  const year = new Date().getFullYear();
  // A non-breaking space keeps "1 jam" from splitting across lines.
  const duration = m.duration.replace(' ', '&nbsp;');
  return `<!DOCTYPE html>
<html lang="id" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Atur ulang password kamu</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  @media (max-width:480px) {
    .container { padding:32px 24px !important; }
    .h1 { font-size:26px !important; line-height:34px !important; }
    .hero { width:100% !important; height:auto !important; }
    .btn, .btn td { width:100% !important; }
    .btn a { display:block !important; min-width:0 !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg-canvas { background:#0B1120 !important; }
    .bg-surface { background:#0F172A !important; border-color:#1E293B !important; }
    .text-heading { color:#F8FAFC !important; }
    .text-body { color:#CBD5E1 !important; }
    .text-muted { color:#94A3B8 !important; }
    .divider { background:#1E293B !important; }
  }
</style>
</head>
<body class="bg-canvas" style="margin:0;padding:0;background:${T.canvas};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">Link berlaku selama ${m.duration}.&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>

<table role="presentation" class="bg-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.canvas};">
<tr><td align="center" style="padding:32px 16px;">

<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="bg-surface" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${T.surface};border:1px solid ${T.border};border-radius:16px;">
<tr><td class="container" align="center" style="padding:40px;font-family:${FONT};">

  <!-- Logo -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
    <td width="48" height="48" align="center" valign="middle" bgcolor="${T.brand}" style="width:48px;height:48px;border-radius:10px;background:${T.brand};font-family:${FONT};font-size:20px;line-height:48px;font-weight:700;color:${T.onPrimary};letter-spacing:-0.5px;" aria-label="HD Hub Management">HD</td>
  </tr></table>

  <!-- Hero -->
  <img class="hero" src="cid:${HERO_RESET_PASSWORD_CID}" width="360" height="200" alt="Ilustrasi gembok merah yang tersenyum" style="display:block;border:0;outline:none;margin:32px auto;width:360px;max-width:100%;height:auto;border-radius:12px;">

  <!-- Heading -->
  <h1 class="h1 text-heading" style="margin:0 0 16px;font-family:${FONT};font-size:32px;line-height:40px;font-weight:700;letter-spacing:-0.5px;color:${T.heading};">Atur ulang<br>password kamu</h1>

  <!-- Body -->
  <p class="text-body" style="margin:0 auto 32px;max-width:480px;font-family:${FONT};font-size:16px;line-height:28px;color:${T.body};">Halo ${m.name}, kami menerima permintaan untuk mengatur ulang password ${account}. Klik tombol di bawah untuk membuat password baru. Link ini berlaku selama ${duration} dan hanya bisa dipakai satu kali.</p>

  <!-- Button -->
  <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${m.link}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="21%" fillcolor="${T.brand}" stroke="f">
      <w:anchorlock/>
      <center style="color:${T.onPrimary};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Atur Ulang Password &rarr;</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-->
    <a href="${m.link}" style="display:inline-block;min-width:156px;padding:14px 32px;border-radius:10px;background:${T.brand};font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${T.onPrimary};text-decoration:none;text-align:center;">Atur Ulang Password &rarr;</a>
    <!--<![endif]-->
  </td></tr></table>

  <!-- Fallback link -->
  <p class="text-muted" style="margin:24px auto 0;max-width:480px;font-family:${FONT};font-size:13px;line-height:20px;color:${T.muted};word-break:break-all;">Tombol tidak berfungsi? Salin link ini ke browser:<br><a href="${m.link}" style="color:${T.brand};text-decoration:underline;">${m.link}</a></p>

  <!-- Not requested -->
  <p class="text-muted" style="margin:24px auto 0;max-width:480px;font-family:${FONT};font-size:14px;line-height:22px;color:${T.muted};">Tidak meminta reset password? Abaikan email ini, password kamu tetap aman.</p>

  <!-- Help -->
  <p class="text-muted" style="margin:48px auto 0;max-width:440px;font-family:${FONT};font-size:14px;line-height:22px;color:${T.muted};">Ada pertanyaan? ${m.dashboard ? `Kunjungi <a href="${m.dashboard}${EMAIL_ORG.helpPath}" style="color:${T.brand};font-weight:600;text-decoration:none;">Pusat Bantuan</a> atau hubungi` : 'Hubungi'} <a href="mailto:${EMAIL_ORG.supportEmail}" style="color:${T.brand};font-weight:600;text-decoration:none;">${EMAIL_ORG.supportEmail}</a>. Tim kami siap membantu soal akun dan operasional gudang kamu.</p>

  <!-- Divider -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;"><tr><td class="divider" width="120" height="1" style="width:120px;height:1px;line-height:1px;font-size:0;background:${T.border};">&nbsp;</td></tr></table>
${m.dashboard ? `
  <!-- Footer links -->
  <p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:22px;color:${T.muted};">${footerLinks(m.dashboard)}</p>
` : ''}
  <!-- Legal -->
  <p style="margin:0;font-family:${FONT};font-size:12px;line-height:20px;color:${T.subtle};">Kamu menerima email ini karena terdaftar sebagai pengguna ${EMAIL_ORG.brand}.<br>${EMAIL_ORG.company} &middot; ${EMAIL_ORG.address}<br>&copy; ${year} ${EMAIL_ORG.brand}. Hak cipta dilindungi.</p>

</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->

</td></tr>
</table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(to: string, name: string, token: string, minutes: number, env: NodeJS.ProcessEnv = process.env) {
  const settings = readMailSettings(env);
  if (!settings) throw new Error('SMTP belum dikonfigurasi.');
  const message = passwordResetMessage(name, resetPasswordUrl(settings, token), minutes, to);
  await transportFor(settings).sendMail({ from: settings.from, to, ...message });
}
