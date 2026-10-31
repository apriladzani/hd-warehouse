import React from 'react';
import type { User } from '../types.ts';
import { FinanceAccessGate } from '../components/warehouse/FinanceAccessGate.tsx';
import { FinanceWorkspace } from './FinanceWorkspace.tsx';
export function FinanceEntry({ currentUser, pathname, onBack }: { currentUser: User; pathname: string; onBack: () => void }) {
  if (currentUser.role === 'WAREHOUSE') return <FinanceAccessGate currentUser={currentUser} onBack={onBack}><FinanceWorkspace currentUser={currentUser} pathname={pathname} /></FinanceAccessGate>;
  if (currentUser.role === 'FINANCE') return <FinanceWorkspace currentUser={currentUser} pathname={pathname} />;
  return <p role="alert">Akses Finance tidak tersedia untuk role ini.</p>;
}
