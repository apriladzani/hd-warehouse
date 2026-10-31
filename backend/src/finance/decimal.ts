// Fixed scale matches the proposed DECIMAL(24,6). No binary floating point for money.
const SCALE = 1_000_000n;
export function decimal(value: string): bigint {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid decimal string (18 integer digits, 6 decimal places maximum)');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'))) * (negative ? -1n : 1n);
}
export function money(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const result = `${value < 0n ? '-' : ''}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(6, '0')}`;
  decimal(result); // Overflow is an error, never a rounded/unsafe value.
  return result;
}
export const sumMoney = (values: string[]) => money(values.reduce((sum, value) => sum + decimal(value), 0n));
export function quantityCost(quantity: string, cost: string): string {
  if (!/^\d+$/.test(quantity)) throw new Error('Quantity must be an integer string');
  const parsedCost = decimal(cost);
  if (parsedCost < 0n) throw new Error('Unit cost must be nonnegative');
  return money(BigInt(quantity) * parsedCost);
}
