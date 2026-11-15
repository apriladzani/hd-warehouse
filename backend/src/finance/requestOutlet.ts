// A request records "<outlet name> (<user name>)" as requester_name when it is
// made. That text, not the user's current placement, identifies its outlet.
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function outletFromRequesterName(requesterName: string, master: { id: number; name: string; code: string }[]) {
  // Longest name first, so "Central Kitchen (CK)" is not mistaken for a shorter prefix.
  const candidates = [...master].sort((a, b) => b.name.length - a.name.length);
  const text = normalize(requesterName);
  return candidates.find(o => text === normalize(o.name) || text === normalize(o.code) || text.startsWith(`${normalize(o.name)} (`)) ?? null;
}

type HeldOutlet = { id: number; name: string; isActive: boolean; isDefault: boolean };
export const NO_OUTLET_MESSAGE = 'Akun belum ditempatkan di outlet. Hubungi Admin.';
export const ALL_INACTIVE_MESSAGE = 'Outlet penempatan sedang nonaktif. Hubungi Admin.';

// What the HD Request form offers an Outlet account: nothing (none held, or all
// held outlets inactive), one outlet as text, or a choice with the default first.
export function requestOutletOptions(held: HeldOutlet[]) {
  const active = held.filter(o => o.isActive);
  const status = !held.length ? 'none' as const : !active.length ? 'inactive' as const : 'ok' as const;
  const preferred = active.find(o => o.isDefault) ?? active[0] ?? null;
  return {
    status,
    message: status === 'none' ? NO_OUTLET_MESSAGE : status === 'inactive' ? ALL_INACTIVE_MESSAGE : null,
    outlets: active.map(o => ({ id: o.id, name: o.name, isDefault: o.id === preferred?.id })),
    defaultOutletId: preferred?.id ?? null,
  };
}

// The outlet a submitted request is for. The id sent by the client is only a
// request: it must be an active outlet the account holds (else 403). Without
// an id, an account with exactly one active outlet uses it.
export function chooseRequestOutlet(held: HeldOutlet[], requested: unknown):
  { outlet: { id: number; name: string } } | { status: 400 | 403 | 409; error: string } {
  const { status, outlets } = requestOutletOptions(held);
  if (status === 'none') return { status: 409, error: NO_OUTLET_MESSAGE };
  if (status === 'inactive') return { status: 409, error: ALL_INACTIVE_MESSAGE };
  if (requested === undefined || requested === null || requested === '') {
    if (outlets.length === 1) return { outlet: outlets[0] };
    return { status: 400, error: 'Pilih outlet untuk request ini.' };
  }
  const id = Number(requested);
  const outlet = outlets.find(o => o.id === id);
  if (!outlet) return { status: 403, error: 'Outlet ini tidak terdaftar atau sedang nonaktif untuk akun Anda.' };
  return { outlet };
}
