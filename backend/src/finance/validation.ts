import { unitKey, type BaseMetric, type Filter, type Unit } from './domain.ts';
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

// Chart of accounts. The database table finance_accounts is the master (Admin
// Finance adds codes there); these rows are only its initial seed.
//   class: DC Distribution Cost · DA Depreciation & Amortization · CI Commercial Income
//   manual: Finance may type entries for it (SI/SH come from HD Outlet, COGS from Warehouse)
//   extensible: new codes may be added to the group (DA has exactly DA01 + DA02 in the formula)
export type AccountClass = 'DC' | 'DA' | 'CI';
export const ACCOUNT_CLASSES: Record<AccountClass, string> = { DC: 'Distribution Cost', DA: 'Depreciation & Amortization', CI: 'Commercial Income' };
export const ACCOUNT_GROUPS: Record<string, { name: string; class: AccountClass; manual: boolean; extensible: boolean }> = {
  LC: { name: 'Labour Cost', class: 'DC', manual: true, extensible: true },
  UC: { name: 'Utility Cost', class: 'DC', manual: true, extensible: true },
  MC: { name: 'Maintenance Cost', class: 'DC', manual: true, extensible: true },
  TC: { name: 'Transportation Cost', class: 'DC', manual: true, extensible: true },
  AC: { name: 'Advertising Cost', class: 'DC', manual: true, extensible: true },
  LP: { name: 'Leased Property', class: 'DC', manual: true, extensible: true },
  TX: { name: 'Tax', class: 'DC', manual: true, extensible: true },
  DA: { name: 'Depreciation & Amortization', class: 'DA', manual: true, extensible: false },
  SI: { name: 'Sales Income', class: 'CI', manual: false, extensible: false },
  OI: { name: 'Other Income', class: 'CI', manual: true, extensible: true },
  SH: { name: 'Shrinkage', class: 'CI', manual: false, extensible: false },
  CRW: { name: 'COGS Raw Material', class: 'CI', manual: false, extensible: false },
  CSM: { name: 'COGS Support Material', class: 'CI', manual: false, extensible: false },
  CPM: { name: 'COGS Packaging', class: 'CI', manual: false, extensible: false },
};
export const DEFAULT_ACCOUNTS: [code: string, name: string, group: string][] = [
  ['LC01', 'Salary', 'LC'], ['LC02', 'Overtime', 'LC'], ['LC03', 'Bonus/Insentif', 'LC'], ['LC04', 'Meal', 'LC'], ['LC05', 'THR', 'LC'], ['LC06', 'Uniform', 'LC'],
  ['UC01', 'Electrical', 'UC'], ['UC02', 'Water/PAM', 'UC'], ['UC03', 'Gas LPG', 'UC'], ['UC04', 'Telecom', 'UC'],
  ['MC01', 'Cleaning', 'MC'], ['MC02', 'Equipment', 'MC'], ['MC03', 'Repair/Service', 'MC'],
  ['TC01', 'Gasoline', 'TC'], ['TC02', 'Tickets', 'TC'], ['TC03', 'Parking', 'TC'], ['TC04', 'Repair/Service', 'TC'],
  ['AC01', 'Print Media', 'AC'], ['AC02', 'Digital Media', 'AC'], ['AC03', 'Voucher', 'AC'], ['AC04', 'Outlet Promo', 'AC'],
  ['LP01', 'Rent', 'LP'], ['TX01', 'Tax', 'TX'],
  ['DA01', 'Depreciation', 'DA'], ['DA02', 'Amortization', 'DA'],
  ['SI', 'Sales Income', 'SI'], ['OI', 'Other Income', 'OI'], ['SH', 'Shrinkage', 'SH'],
  ['CRW', 'COGS Raw Material', 'CRW'], ['CSM', 'COGS Support Material', 'CSM'], ['CPM', 'COGS Packaging', 'CPM'],
];
export const ACCOUNT_CODE = /^[A-Z]{2,3}\d{0,3}$/;
// The formula component an account rolls into: its group, except each DA code
// which is its own component (DA = DA01 + DA02).
export function accountMetric(code: string, group: string): BaseMetric {
  if (!Object.hasOwn(ACCOUNT_GROUPS, group)) throw new Error('Unknown account group');
  if (group === 'DA') { if (code !== 'DA01' && code !== 'DA02') throw new Error('DA has exactly DA01 and DA02'); return code; }
  return group as BaseMetric;
}

export type TransactionSource = 'manual' | 'hdoutlet';
export type FinanceTransactionDraft = {
  date: string; unit: Unit; accountCode: string; amount: string; notes: string;
  reference: string; status: 'draft' | 'posted' | 'void'; nature: 'INTERNAL' | 'EXTERNAL';
  counterparty: Unit | null; idempotencyKey: string; legacyEntryId: string | null; version: number;
  source: TransactionSource; sourceRef: string | null; attachment: string | null;
};
function text(value: unknown, max: number, required: boolean): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid text');
  return value.trim();
}
function validUnit(unit: unknown): unit is Unit {
  if (!unit || typeof unit !== 'object' || !('type' in unit)) return false;
  return unit.type === 'WAREHOUSE' ? !('outletId' in unit) : unit.type === 'OUTLET' && 'outletId' in unit && Number.isSafeInteger(unit.outletId) && (unit.outletId as number) > 0;
}
// Attachments are stored by the server as /api/finance/v2/transactions/attachments/<uuid>.<ext>.
export const ATTACHMENT_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|png|jpg|webp)$/;
export function validateTransaction(input: Record<string, unknown>): FinanceTransactionDraft {
  if (typeof input.accountCode !== 'string' || !ACCOUNT_CODE.test(input.accountCode)) throw new Error('Invalid account');
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
  const source = input.source ?? 'manual';
  if (source !== 'manual' && source !== 'hdoutlet') throw new Error('Invalid source');
  const sourceRef = input.sourceRef == null ? null : text(input.sourceRef, 120, true);
  if (source === 'hdoutlet' && !sourceRef) throw new Error('Synced entry requires its source reference');
  const attachment = input.attachment == null || input.attachment === '' ? null : String(input.attachment);
  if (attachment !== null && !ATTACHMENT_PATH.test(attachment)) throw new Error('Invalid attachment');
  const counterparty = input.counterparty as Unit | undefined;
  return {
    date: date(input.date), unit: unit.type === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: unit.outletId },
    accountCode: input.accountCode, amount: money(decimal(input.amount)), notes: text(input.notes, 500, true), reference: text(input.reference, 255, false),
    status: input.status as FinanceTransactionDraft['status'], nature: input.nature as FinanceTransactionDraft['nature'],
    counterparty: counterparty ? counterparty.type === 'WAREHOUSE' ? { type: 'WAREHOUSE' } : { type: 'OUTLET', outletId: counterparty.outletId } : null,
    idempotencyKey: text(input.idempotencyKey, 100, true), legacyEntryId: input.legacyEntryId as string ?? null, version: input.version as number,
    source, sourceRef, attachment,
  };
}
