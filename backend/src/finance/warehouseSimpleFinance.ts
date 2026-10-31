import { decimal, money } from './decimal.ts';
export function inventoryReceiptAverage(stock: number, average: string, quantity: number, price: string) {
  if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid stock quantity');
  const old = decimal(average), incoming = decimal(price);
  if (old < 0n || incoming < 0n) throw new Error('Invalid cost');
  if (!stock) return money(incoming);
  const n = BigInt(stock + quantity);
  return money((BigInt(stock) * old + BigInt(quantity) * incoming + n / 2n) / n);
}
export function opnameAverage(physical: number, previous: string) {
  if (!Number.isSafeInteger(physical) || physical < 0 || decimal(previous) < 0n) throw new Error('Invalid opname');
  return physical === 0 ? '0.000000' : money(decimal(previous));
}
// Costs of sold units are historical approval snapshots. Their weighted mean
// is displayed when units sold have different historic cost bases.
export function simpleWarehouseFinance(quantity: number, catalog: string, historicalCogs: string | null, fallbackAverage: string | null) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Invalid sold quantity');
  const price = decimal(catalog); if (price < 0n) throw new Error('Invalid catalog price');
  const sales = money(BigInt(quantity) * price);
  const cost = historicalCogs === null ? null : decimal(historicalCogs);
  if (cost !== null && cost < 0n) throw new Error('Invalid historical COGS');
  const average = quantity > 0 ? cost === null ? null : money((cost + BigInt(quantity) / 2n) / BigInt(quantity)) : fallbackAverage;
  return { sales, average, cogs: quantity === 0 ? '0.000000' : cost === null ? null : money(cost), profit: quantity === 0 ? '0.000000' : cost === null ? null : money(decimal(sales) - cost) };
}

export function displayedWarehouseAverage(closed: boolean, inventory: string | null, soldAverage: string | null, periodAverage: string | null) {
  const value = closed ? soldAverage ?? periodAverage : inventory;
  if (value === null) return null;
  const parsed = decimal(value);
  return parsed < 0n ? null : money(parsed);
}
