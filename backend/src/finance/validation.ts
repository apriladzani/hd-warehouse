import { unitKey, type Filter, type Unit } from './domain.ts';
import { decimal, money } from './decimal.ts';
export function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return value;
}
export function parseFilter(input: Record<string, unknown>): Filter {
  if (typeof input.mode !== 'string' || !['WAREHOUSE', 'OUTLET', 'ALL'].includes(input.mode)) throw new Error('Invalid mode');
  const startDate = date(input.startDate), endDate = date(input.endDate);
  if (endDate < startDate) throw new Error('Invalid date range');
  if (input.timezone !== undefined && input.timezone !== 'Asia/Jakarta') throw new Error('Invalid timezone');
  let outletIds: number[] | null = null;
  if (input.outletIds !== undefined) {
    if (typeof input.outletIds !== 'string' || !/^\d+(,\d+)*$/.test(input.outletIds)) throw new Error('outletIds must contain positive IDs');
    outletIds = [...new Set(input.outletIds.split(',').map(Number))];
    if (outletIds.length > 100 || outletIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid outlet IDs');
  }
  return { mode: input.mode as Filter['mode'], startDate, endDate, outletIds, timezone: 'Asia/Jakarta' };
}
export const ACCOUNTS = {
  OI: ['Other Income', 'OI'], SH: ['Shrinkage', 'SH'],
  LC01: ['Salary', 'LC'], LC02: ['Overtime', 'LC'], LC03: ['Bonus/Incentive', 'LC'], LC04: ['Meal', 'LC'], LC05: ['THR', 'LC'], LC06: ['Uniform', 'LC'],
  UC01: ['Electrical', 'UC'], UC02: ['Water/PAM', 'UC'], UC03: ['Gas LPG', 'UC'], UC04: ['Telecom', 'UC'],
  MC01: ['Cleaning', 'MC'], MC02: ['Equipment', 'MC'], MC03: ['Repair/Service', 'MC'],
  TC01: ['Gasoline', 'TC'], TC02: ['Tickets', 'TC'], TC03: ['Parking', 'TC'], TC04: ['Repair/Service', 'TC'],
  AC01: ['Print Media', 'AC'], AC02: ['Digital Media', 'AC'], AC03: ['Voucher', 'AC'], AC04: ['Outlet Promo', 'AC'],
  LP01: ['Rent', 'LP'], TX01: ['Tax', 'TX'], DA01: ['Depreciation', 'DA01'], DA02: ['Amortization', 'DA02'],
} as const;
export type FinanceTransactionDraft = {
  date: string; unit: Unit; accountCode: keyof typeof ACCOUNTS; amount: string; notes: string;
  reference: string; status: 'draft' | 'posted' | 'void'; nature: 'INTERNAL' | 'EXTERNAL';
  counterparty: Unit | null; idempotencyKey: string; legacyEntryId: string | null; version: number;
};
function required(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid required text');
  return value.trim();
}
function validUnit(unit: unknown): unit is Unit {
  if (!unit || typeof unit !== 'object' || !('type' in unit)) return false;
  return unit.type === 'WAREHOUSE' ? !('outletId' in unit) : unit.type === 'OUTLET' && 'outletId' in unit && Number.isSafeInteger(unit.outletId) && (unit.outletId as number) > 0;
}
export function validateTransaction(input: Record<string, unknown>): FinanceTransactionDraft {
  if (typeof input.accountCode !== 'string' || !Object.hasOwn(ACCOUNTS, input.accountCode)) throw new Error('Invalid account');
  if (typeof input.amount !== 'string' || decimal(input.amount) <= 0n) throw new Error('Amount must be a positive decimal string');
  const unit = input.unit as Unit;
  if (!validUnit(unit)) throw new Error('Invalid unit');
  if (!['draft', 'posted', 'void'].includes(String(input.status))) throw new Error('Invalid status');
  if (!['INTERNAL', 'EXTERNAL'].includes(String(input.nature))) throw new Error('Invalid transaction nature');
  if (input.nature === 'INTERNAL' && !validUnit(input.counterparty)) throw new Error('Internal entry requires counterparty unit');
  if (input.counterparty != null && !validUnit(input.counterparty)) throw new Error('Invalid counterparty');
  if (input.counterparty && unitKey(unit) === unitKey(input.counterparty as Unit)) throw new Error('Counterparty must be a different unit');
  if (input.legacyEntryId != null && (typeof input.legacyEntryId !== 'string' || !/^[1-9]\d*$/.test(input.legacyEntryId))) throw new Error('Invalid legacy reference');
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 1) throw new Error('Invalid version');
  const counterparty = input.counterparty as Unit | undefined;
  return { date: date(input.date), unit: unit.type === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: unit.outletId }, accountCode: input.accountCode as keyof typeof ACCOUNTS, amount: money(decimal(input.amount)), notes: required(input.notes, 500), reference: required(input.reference, 255), status: input.status as FinanceTransactionDraft['status'], nature: input.nature as FinanceTransactionDraft['nature'], counterparty: counterparty ? counterparty.type === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: counterparty.outletId } : null, idempotencyKey: required(input.idempotencyKey, 100), legacyEntryId: input.legacyEntryId as string ?? null, version: input.version as number };
}
