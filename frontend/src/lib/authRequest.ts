// Every auth screen has to tell the same three stories: the device has no
// network, the server could not be reached, or the server answered. Keeping the
// wording in one place stops the pages from blaming the user for a dead cable.
export const OFFLINE_MESSAGE = 'Perangkat ini sedang tidak terhubung ke jaringan. Sambungkan kembali, lalu coba lagi.';
export const UNREACHABLE_MESSAGE = 'Tidak bisa menghubungi server. Periksa koneksi jaringan Anda atau hubungi administrator.';

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

// status is null when the request never completed, so no server ever saw it.
// parsed is false when the reply was not JSON at all, which means the error
// came from something other than the route's own validation.
export type JsonResult = { ok: boolean; status: number | null; data: any; online: boolean; parsed: boolean };

export const MALFORMED_REPLY_MESSAGE = 'Server mengembalikan respons yang tidak dikenali. Ini masalah di server, bukan pada data yang Anda isi. Hubungi administrator.';

export async function requestJson(url: string, init?: RequestInit): Promise<JsonResult> {
  const online = isOnline();
  try {
    const response = await fetch(url, init);
    let data: any = null;
    let parsed = true;
    try { data = await response.json(); } catch { parsed = false; }
    return { ok: response.ok, status: response.status, data, online, parsed };
  } catch {
    return { ok: false, status: null, data: null, online, parsed: false };
  }
}

// The branches every auth screen shares. Screen-specific cases (a rejected
// password, a spent reset link) are described by the screen itself.
export function describeTransportFailure(result: JsonResult): string | null {
  if (!result.online) return OFFLINE_MESSAGE;
  if (result.status === null) return UNREACHABLE_MESSAGE;
  // A route that rejects input always says why in JSON. A non-JSON error body
  // means the request never reached that check, so never blame the input.
  if (!result.parsed) return MALFORMED_REPLY_MESSAGE;
  if (result.status === 429) return result.data?.error || 'Terlalu banyak percobaan. Tunggu beberapa saat, lalu coba lagi.';
  if (result.status === 503) return result.data?.error || 'Layanan belum tersedia saat ini. Coba lagi nanti atau hubungi administrator.';
  if (result.status >= 500) return result.data?.error || 'Terjadi gangguan di server. Coba lagi beberapa saat lagi.';
  return null;
}
