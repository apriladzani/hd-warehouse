import { decimal, money } from './decimal.ts';
export function approvalHpp(quantity: number, lineCost: string | null, snapshots: { quantity: number; unitCost: string | null; source: string }[]) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || snapshots.length !== 1) return null;
  const snapshot = snapshots[0];
  if (snapshot.source !== 'SALE_APPROVAL' || snapshot.quantity !== quantity || snapshot.unitCost === null) return null;
  const cost = decimal(snapshot.unitCost);
  if (cost < 0n || (lineCost !== null && decimal(lineCost) !== cost)) return null;
  return { unitCost: money(cost), amount: money(BigInt(quantity) * cost) };
}
