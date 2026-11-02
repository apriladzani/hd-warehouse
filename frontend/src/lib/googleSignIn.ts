// Google sign-in is a full-page redirect, so its outcome comes back as a query
// parameter on /login rather than as a fetch reply.
export const GOOGLE_SIGN_IN_URL = '/api/auth/google';

const GOOGLE_ERRORS: Record<string, string> = {
  unconfigured: 'Masuk dengan Google belum diaktifkan di server. Hubungi administrator.',
  cancelled: 'Masuk dengan Google dibatalkan. Anda bisa mencoba lagi atau masuk dengan password.',
  state: 'Sesi masuk dengan Google kedaluwarsa atau tidak cocok. Mulai lagi dari tombol Google di halaman ini.',
  exchange: 'Google tidak bisa memverifikasi akun Anda saat ini. Coba lagi beberapa saat lagi.',
  profile: 'Google tidak mengirim data akun yang dibutuhkan. Coba lagi beberapa saat lagi.',
  unverified: 'Email akun Google Anda belum terverifikasi. Verifikasi dulu di Google, lalu coba lagi.',
  domain: 'Akun Google ini tidak diizinkan masuk. Gunakan akun email perusahaan Anda.',
  inactive: 'Akun Anda sedang dinonaktifkan. Hubungi administrator.',
  conflict: 'Email ini sudah tertaut ke akun Google lain. Masuk dengan password, atau hubungi administrator.',
  server: 'Terjadi gangguan di server saat masuk dengan Google. Coba lagi beberapa saat lagi.',
};

export const describeGoogleError = (code: string | null | undefined) =>
  code ? GOOGLE_ERRORS[code] || GOOGLE_ERRORS.server : null;

// Cancelling is the user's own choice, not a failure, so it is shown calmly.
export const googleErrorKind = (code: string | null | undefined): 'info' | 'error' =>
  code === 'cancelled' ? 'info' : 'error';

// Reading is pure so it is safe in a state initializer, which React may run
// twice in development. Clearing is separate and belongs in an effect.
export function readGoogleOutcome(search = typeof window === 'undefined' ? '' : window.location.search) {
  const params = new URLSearchParams(search);
  return { ok: params.get('oauth') === 'ok', error: params.get('oauth_error') };
}

// Removes the outcome from the address bar, so a refresh or a shared link does
// not replay an old error.
export function clearGoogleOutcome() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('oauth') && !params.has('oauth_error')) return;
  params.delete('oauth');
  params.delete('oauth_error');
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
}
