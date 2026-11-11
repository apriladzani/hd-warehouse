// The backend values each item; the page only adds up the rows the active
// filters leave and orders them. An item without a price (never bought) is
// neither zero nor part of the total - it is counted separately so the total
// can say it is incomplete.
export type ValuedItem = { stockValue?: number | null };
export type ValueSort = 'none' | 'desc' | 'asc';

export const UNPRICED_LABEL = 'Harga belum tersedia';

export function totalStockValue(items: ValuedItem[]) {
  let total = 0;
  let unpriced = 0;
  for (const item of items) {
    if (item.stockValue == null) unpriced += 1;
    else total += Number(item.stockValue);
  }
  return { total, unpriced };
}

// Highest or lowest first; unpriced items always sink to the bottom, because
// "no price" is not a low value.
export function sortByStockValue<T extends ValuedItem>(items: T[], direction: ValueSort): T[] {
  if (direction === 'none') return items;
  return [...items].sort((a, b) => {
    const left = a.stockValue, right = b.stockValue;
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
    return direction === 'desc' ? right - left : left - right;
  });
}

export const nextValueSort = (current: ValueSort): ValueSort =>
  current === 'none' ? 'desc' : current === 'desc' ? 'asc' : 'none';
