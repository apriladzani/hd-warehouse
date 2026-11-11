import { decimal } from './decimal.ts';

// Value of the stock on the current-stock page: current stock × moving
// average cost, worked out in fixed-point decimals and rounded half-up to
// whole rupiah only at the end.
//
// An item that has never been bought has no cost to value it at. That is not
// a cost of zero (goods received free are bought at zero and do have one), so
// both numbers are null and the item stays out of any total. Stock at or below
// zero is worth nothing, while its average stays visible.
export type StockValuation = { avgCost: number | null; stockValue: number | null };

const SCALE = 1_000_000n;

const toDecimalString = (value: string | number) =>
  typeof value === 'number' ? value.toFixed(6) : String(value).trim();

export function stockValuation(stock: number, average: string | number | null | undefined, purchased: boolean): StockValuation {
  if (!purchased || average == null || average === '') return { avgCost: null, stockValue: null };
  const avg = decimal(toDecimalString(average));
  if (avg < 0n) return { avgCost: null, stockValue: null };
  const avgCost = Number(toDecimalString(average));
  if (!Number.isSafeInteger(stock) || stock <= 0) return { avgCost, stockValue: 0 };
  const exact = BigInt(stock) * avg;
  return { avgCost, stockValue: Number((exact + SCALE / 2n) / SCALE) };
}
