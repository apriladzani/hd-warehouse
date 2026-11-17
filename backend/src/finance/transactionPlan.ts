import { canManageFinance } from './access.ts';
import { validateTransaction, type FinanceTransactionDraft } from './validation.ts';
export type TransactionRecord = FinanceTransactionDraft & { id: string };
export type AuditPlan = { entityType: 'transaction'; entityId: string; action: 'CREATE' | 'UPDATE' | 'POST' | 'VOID'; actorId: number; occurredAt: string; reason: string; before: TransactionRecord | null; after: TransactionRecord };
// status: the HTTP answer (400 refused by a rule, 409 conflict with stored data).
export class TransactionRuleError extends Error { status: 400 | 409 = 400; }

// Pure mutation plan. The repository locks the record, compares the version and
// writes the record and this audit in the same database transaction.
//  · A Finance entry is saved posted (it counts at once) or as a draft.
//  · A posted manual entry may be edited; every edit is versioned and audited.
//  · Deleting is a void (soft delete): the row and its history stay.
//  · Entries synced from HD Outlet are never changed by hand: corrections are
//    made in HD Outlet and synced again.
export function planTransactionChange(
  actor: { id: number; role: string },
  before: TransactionRecord | null,
  candidate: Record<string, unknown>,
  reason: string,
): { record: TransactionRecord; audit: AuditPlan } {
  if (!canManageFinance(actor.role) || !Number.isSafeInteger(actor.id) || actor.id <= 0) throw new TransactionRuleError('Finance mutation denied');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new TransactionRuleError('Alasan perubahan wajib diisi (maksimal 500 karakter).');
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) throw new TransactionRuleError('Transaction identity required');
  const after = { ...validateTransaction(candidate), id: candidate.id };
  let action: AuditPlan['action'] = 'CREATE';
  if (!before) {
    if (after.status === 'void' || after.version !== 1) throw new TransactionRuleError('Create as draft or posted version 1');
    if (after.source !== 'manual') throw new TransactionRuleError('Entri HD Outlet hanya dibuat oleh sinkronisasi.');
  } else {
    if (before.source !== 'manual') throw new TransactionRuleError('Data dari HD Outlet tidak dapat diubah manual. Koreksi di HD Outlet lalu sinkron ulang.');
    for (const field of ['id', 'idempotencyKey', 'legacyEntryId', 'source', 'sourceRef'] as const) {
      if (before[field] !== after[field]) throw new TransactionRuleError('Identity conflict');
    }
    if (after.version !== before.version + 1) throw new TransactionRuleError('Version conflict');
    if (before.status === 'void') throw new TransactionRuleError('Entri yang sudah dihapus tidak dapat diubah.');
    if (before.status === 'posted' && after.status === 'draft') throw new TransactionRuleError('Entri posted tidak dapat dikembalikan ke draft.');
    if (after.status === 'void') for (const field of ['date', 'unit', 'accountCode', 'amount', 'notes', 'reference', 'nature', 'counterparty', 'attachment'] as const) {
      if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) throw new TransactionRuleError('Hapus tidak boleh sekaligus mengubah isi entri.');
    }
    action = after.status === 'void' ? 'VOID' : before.status === 'draft' && after.status === 'posted' ? 'POST' : 'UPDATE';
  }
  return { record: after, audit: { entityType: 'transaction', entityId: after.id, action, actorId: actor.id, occurredAt: new Date().toISOString(), reason: reason.trim(), before: before ? structuredClone(before) : null, after: structuredClone(after) } };
}
