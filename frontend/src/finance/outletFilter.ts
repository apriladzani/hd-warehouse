// Outlet filter state lives in the URL (?outlet=1,4,7) so a refresh or a shared
// link keeps it. No ids, or every outlet, means "Semua Outlet".
export type OutletOption = { id: number; name: string };

export function readOutletParam(search: string): number[] {
  const value = new URLSearchParams(search).get('outlet');
  if (!value) return [];
  return [...new Set(value.split(',').map(Number).filter(id => Number.isSafeInteger(id) && id >= 0))].sort((a, b) => a - b);
}

export function withOutletParam(href: string, ids: number[]): string {
  const url = new URL(href);
  url.searchParams.delete('outlet');
  // Commas stay literal (?outlet=1,4,7) so the link is readable when shared.
  const rest = url.searchParams.toString();
  const outlet = ids.length ? `outlet=${[...ids].sort((a, b) => a - b).join(',')}` : '';
  const query = [rest, outlet].filter(Boolean).join('&');
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}

// The ids actually sent to the API: selecting every outlet is the same as no filter.
export const effectiveOutletIds = (selected: number[], all: OutletOption[]) =>
  all.length > 0 && all.every(o => selected.includes(o.id)) ? [] : selected;

export function outletFilterLabel(selected: number[], all: OutletOption[]) {
  const ids = effectiveOutletIds(selected, all);
  if (!ids.length) return 'Semua Outlet';
  if (ids.length === 1) return all.find(o => o.id === ids[0])?.name ?? outletName(ids[0], all);
  return `${ids.length} Outlet`;
}

export const outletName = (id: number, all: OutletOption[]) => id === 0 ? 'Tanpa outlet' : all.find(o => o.id === id)?.name ?? `Outlet #${id}`;
