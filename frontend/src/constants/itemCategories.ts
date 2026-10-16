export const ITEM_CATEGORIES = [
  { name: 'Raw Material', code: 'RM' },
  { name: 'Support Material', code: 'SM' },
  { name: 'Packaging', code: 'PKG' },
] as const;

export type ItemCategory = typeof ITEM_CATEGORIES[number]['name'];
