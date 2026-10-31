export type LegacyEntry = { id: string; amount: string; accountCode: string; isVoided: boolean };
export type Replacement = { id: string; legacyEntryId: string | null; status: 'draft' | 'posted' | 'void' };
// A posted/void replacement owns the legacy identity permanently. Voiding it
// must not resurrect the old entry. Drafts never suppress the legacy original.
export function transitionLegacy(legacy: LegacyEntry[], replacements: Replacement[]) {
  const owners = new Map<string, string>();
  for (const entry of replacements) {
    if (!entry.legacyEntryId || entry.status === 'draft') continue;
    if (owners.has(entry.legacyEntryId)) throw new Error('Duplicate legacy ownership');
    owners.set(entry.legacyEntryId, entry.id);
  }
  return legacy.filter(entry => !entry.isVoided && !owners.has(entry.id));
}
