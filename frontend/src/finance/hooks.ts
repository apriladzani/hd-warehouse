import { useEffect, useMemo, useState } from 'react';
import type { User } from '../types.ts';
import { createFinanceClient } from './api.ts';
import { reportQuery, type Accounts, type Filter, type Report } from './model.ts';
export type Remote<T> = { data: T | null; loading: boolean; error: string | null };
export function useFinance(user: User, filter: Filter) {
  const password = (user as User & { password?: string }).password;
  const client = useMemo(() => createFinanceClient(user), [user.email, user.role, password]);
  const key = reportQuery(filter);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<Remote<Report> & { key: string }>({ key: '', data: null, loading: true, error: null });
  const [accounts, setAccounts] = useState<Remote<Accounts>>({ data: null, loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    setReport({ key, data: null, loading: true, error: null });
    client.report(filter, controller.signal).then(data => { if (!controller.signal.aborted) setReport({ key, data, loading: false, error: null }); }).catch(error => { if (!controller.signal.aborted) setReport({ key, data: null, loading: false, error: error instanceof Error ? error.message : 'Gagal memuat Finance.' }); });
    return () => controller.abort();
  }, [client, key, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setAccounts({ data: null, loading: true, error: null });
    client.accounts(controller.signal).then(data => { if (!controller.signal.aborted) setAccounts({ data, loading: false, error: null }); }).catch(error => { if (!controller.signal.aborted) setAccounts({ data: null, loading: false, error: error instanceof Error ? error.message : 'Gagal memuat akun.' }); });
    return () => controller.abort();
  }, [client, revision]);
  return { report: report.key === key ? report : { data: null, loading: true, error: null }, accounts, reload: () => setRevision(r => r + 1) };
}
