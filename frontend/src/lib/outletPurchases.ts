// Purchases of an Outlet account: what the warehouse approved on its requests,
// approved quantity × price. Pending, rejected and cancelled lines bought
// nothing (a cancelled request's lines become 'Cancelled'), so they count nowhere.

type Line = { itemId: number; itemName?: string | null; status: string; approvedQuantity?: number | null; price?: number | null };
type Req = { id: number; outletId?: number | null; outletName?: string | null; items?: Line[] };

export type PurchaseRow = { key: string; name: string; quantity: number; amount: number; requests: number };

const boughtLines = (request: Req) => (request.items ?? []).filter((line) => line.status === 'Approved' && Number(line.approvedQuantity) > 0);

// Totals, per outlet and per item, both sorted by amount, largest first.
export function purchaseRecap(requests: Req[]) {
  let amount = 0, quantity = 0, count = 0;
  const byOutlet = new Map<string, PurchaseRow>();
  const byItem = new Map<string, PurchaseRow & { outlets: Set<string> }>();
  for (const request of requests) {
    const lines = boughtLines(request);
    if (!lines.length) continue;
    count += 1;
    const outletKey = String(request.outletId ?? 'none');
    const outlet = byOutlet.get(outletKey) ?? { key: outletKey, name: request.outletName || 'Tanpa outlet', quantity: 0, amount: 0, requests: 0 };
    outlet.requests += 1;
    for (const line of lines) {
      const qty = Number(line.approvedQuantity);
      const value = qty * Number(line.price || 0);
      amount += value; quantity += qty;
      outlet.quantity += qty; outlet.amount += value;
      const itemKey = String(line.itemId);
      const item = byItem.get(itemKey) ?? { key: itemKey, name: line.itemName || `Barang #${line.itemId}`, quantity: 0, amount: 0, requests: 0, outlets: new Set<string>() };
      item.quantity += qty; item.amount += value; item.requests += 1; item.outlets.add(outletKey);
      byItem.set(itemKey, item);
    }
    byOutlet.set(outletKey, outlet);
  }
  const sorted = <T extends PurchaseRow>(rows: T[]) => rows.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'id'));
  return {
    amount, quantity, requests: count,
    byOutlet: sorted([...byOutlet.values()]),
    byItem: sorted([...byItem.values()].map(({ outlets: _outlets, ...row }) => row)),
  };
}

// Per item, per outlet: quantity and amount of one item at each outlet, for the
// item table when an account has several outlets.
export function itemOutletMatrix(requests: Req[]) {
  const matrix = new Map<string, Map<string, { quantity: number; amount: number }>>();
  for (const request of requests) {
    const outletKey = String(request.outletId ?? 'none');
    for (const line of boughtLines(request)) {
      const cells = matrix.get(String(line.itemId)) ?? new Map();
      const cell = cells.get(outletKey) ?? { quantity: 0, amount: 0 };
      cell.quantity += Number(line.approvedQuantity);
      cell.amount += Number(line.approvedQuantity) * Number(line.price || 0);
      cells.set(outletKey, cell);
      matrix.set(String(line.itemId), cells);
    }
  }
  return matrix;
}
