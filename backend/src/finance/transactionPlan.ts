import { canManageFinance } from './access.ts';
import { validateTransaction, type FinanceTransactionDraft } from './validation.ts';
export type TransactionRecord = FinanceTransactionDraft & { id: string };
export type AuditPlan = { entityType: 'transaction'; entityId: string; action: 'CREATE' | 'UPDATE' | 'POST' | 'VOID'; actorId: number; occurredAt: string; reason: string; before: TransactionRecord | null; after: TransactionRecord };
// Pure mutation plan only. A future persistence implementation must lock the
// record, compare version, and insert its audit in the SAME database transaction.
// No executor, database import or write endpoint is provided in Stage 2.
export function planTransactionChange(
  actor: { id: number; role: string },
  before: TransactionRecord | null,
  candidate: Record<string, unknown>,
  reason: string,
): { record: TransactionRecord; audit: AuditPlan } {
  if (!canManageFinance(actor.role) || !Number.isSafeInteger(actor.id) || actor.id <= 0) throw new Error('Finance mutation denied');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new Error('Audit reason required');
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) throw new Error('Transaction identity required');
  const after = { ...validateTransaction(candidate), id: candidate.id };
  let action: AuditPlan['action'] = 'CREATE';
  if (!before) {
    if (after.status !== 'draft' || after.version !== 1) throw new Error('Create as draft version 1');
  } else {
    if (before.id !== after.id || after.version !== before.version + 1 || before.idempotencyKey !== after.idempotencyKey || before.legacyEntryId !== after.legacyEntryId) throw new Error('Identity/version conflict');
    if (before.status === 'void') throw new Error('Void is immutable');
    if (before.status === 'posted') {
      if (after.status !== 'void') throw new Error('Posted entry may only be voided; replace via linked new entry');
      for (const field of ['date', 'unit', 'accountCode', 'amount', 'notes', 'reference', 'nature', 'counterparty'] as const) {
        if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) throw new Error('Posted financial fields are immutable');
      }
    }
    action = after.status === 'posted' ? 'POST' : after.status === 'void' ? 'VOID' : 'UPDATE';
  }
  return { record: after, audit: { entityType: 'transaction', entityId: after.id, action, actorId: actor.id, occurredAt: new Date().toISOString(), reason: reason.trim(), before: before ? structuredClone(before) : null, after: structuredClone(after) } };
}
