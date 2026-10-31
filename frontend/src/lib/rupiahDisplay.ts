// Presentation only. Never use the rounded string in storage or calculations.
export function rupiahDecimalDisplay(amount: string | null): string {
  if (amount === null || !/^-?\d+(?:\.\d+)?$/.test(amount)) return '—';
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const rounded = BigInt(whole) + (fraction && fraction[0] >= '5' ? 1n : 0n);
  return `${negative && rounded !== 0n ? '−' : ''}Rp${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
