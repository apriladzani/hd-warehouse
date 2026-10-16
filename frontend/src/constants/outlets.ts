export const OUTLETS = [
  'Cisalak',
  'Cieunteung',
  'Cigeureung',
  'Ciburuyan',
  'Aboh',
  'BRP',
  'Indihiang',
  'Taman Sari',
  'Kawalu',
  'Bantar Malam',
  'Ria Busana',
  'City Garden',
  'Central Kitchen (CK)',
] as const;

export type OutletName = typeof OUTLETS[number];
