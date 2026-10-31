// Mirrors the existing dashboard policy. This function authenticates nobody;
// callers must supply a verified principal and a server-verified gate result.
export function canReadMultiSourceFinance(role: string | undefined, warehouseGate: boolean): boolean {
  const normalized = role?.toUpperCase();
  return normalized === 'FINANCE' || (normalized === 'WAREHOUSE' && warehouseGate);
}
export function canManageFinance(role: string | undefined): boolean { return role?.toUpperCase() === 'FINANCE'; }
