// Outlet placement of an account (one account, several outlets). The server
// decides what an account may use; these helpers only shape what is shown.

export type HeldOutlet = { id: number; name: string; isActive?: boolean; isDefault?: boolean };
export type OutletProfile = {
  status: 'ok' | 'none' | 'inactive';
  message: string | null;
  outlets: { id: number; name: string; isDefault: boolean }[];
  defaultOutletId: number | null;
};

// "Bantar Malam, Cibubur +1": the first two by name, then how many more.
export function outletSummary(outlets: HeldOutlet[] | undefined, shown = 2) {
  const list = outlets ?? [];
  if (!list.length) return '—';
  const names = list.map((o) => o.name);
  return names.length > shown ? `${names.slice(0, shown).join(', ')} +${names.length - shown}` : names.join(', ');
}

// What the OUTLET field of HD Request shows: a message (no outlet, or all of
// them inactive), the one outlet as text, or a choice.
export function outletFieldMode(profile: OutletProfile | null): 'loading' | 'blocked' | 'single' | 'choice' {
  if (!profile) return 'loading';
  if (profile.status !== 'ok' || !profile.outlets.length) return 'blocked';
  return profile.outlets.length === 1 ? 'single' : 'choice';
}

export const blockedMessage = (profile: OutletProfile | null) =>
  profile?.message || 'Akun belum ditempatkan di outlet. Hubungi Admin.';

// Outlets that appear in a list of requests, by name: the options of the
// outlet filter in Riwayat (an outlet taken away still has its old requests).
export function outletsOfRequests(requests: { outletId?: number | null; outletName?: string | null }[]) {
  const map = new Map<number, string>();
  for (const r of requests) if (r.outletId != null) map.set(r.outletId, r.outletName || `Outlet #${r.outletId}`);
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

// Batalkan for an Outlet account: an approved request of an outlet it still holds.
export const canCancelOwnRequest = (cancellableStatus: boolean, outletId: number | null | undefined, heldOutletIds: number[] | null) =>
  cancellableStatus && (heldOutletIds === null || (outletId != null && heldOutletIds.includes(outletId)));

// The outlet chosen when the form opens: the default, else the first offered.
export const initialOutletId = (profile: OutletProfile | null) =>
  profile?.status === 'ok' ? (profile.defaultOutletId ?? profile.outlets[0]?.id ?? null) : null;
