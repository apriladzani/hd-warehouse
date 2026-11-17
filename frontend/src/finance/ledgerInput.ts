// Rupiah as Finance types it ("3.500.000", "Rp 3.500.000", "1.250,50") into
// the decimal-dot string the ledger API takes ("3500000", "1250.50").
// Dots group thousands, a comma marks decimals. Null when it is not a
// positive amount the ledger accepts (≤ 18 digits, ≤ 6 decimals).
export function parseRupiah(text: string): string | null {
  const cleaned = text.replace(/rp/gi, '').replace(/\s/g, '');
  if (!/^[\d.,]+$/.test(cleaned) || (cleaned.match(/,/g)?.length ?? 0) > 1) return null;
  const [whole, fraction] = cleaned.split(',');
  if (whole.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(whole)) return null;
  const digits = whole.replace(/\./g, '').replace(/^0+(?=\d)/, '');
  if (!/^\d{1,18}$/.test(digits) || (fraction !== undefined && !/^\d{1,6}$/.test(fraction))) return null;
  const value = fraction === undefined ? digits : `${digits}.${fraction}`;
  return /^0+(\.0+)?$/.test(value) ? null : value;
}

type UnitRef = { type: 'WAREHOUSE' } | { type: 'OUTLET'; outletId: number };
// Unit label with the outlet's name when it is known.
export function unitName(unit: UnitRef, outlets: { id: number; name: string }[]) {
  if (unit.type === 'WAREHOUSE') return 'Warehouse';
  return outlets.find((o) => o.id === unit.outletId)?.name ?? `Outlet #${unit.outletId}`;
}

export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', posted: 'Posted', void: 'Void' };
