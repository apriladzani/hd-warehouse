import React, { useEffect, useMemo, useState } from 'react';
import { Download, Info, RefreshCw } from 'lucide-react';
import type { User } from '../types.ts';
import { Button, StateMessage } from '../components/common/UI.tsx';
import { ApiState, DetailView, EliminationNote, Filters, Issues, MetricTable, MissingInputs, Modal, Panel, Status, UnitTable } from './components.tsx';
import { EntryManager } from './EntryManager.tsx';
import { AccountSettings, HdAttendanceSettings, HdOutletSettings } from './FinanceSettings.tsx';
import { createFinanceClient } from './api.ts';
import { useFinance } from './hooks.ts';
import { COMMERCIAL, DA, DC, LABELS, PAGES, PL, PROFIT_LOSS, financePage, initialFilter, modeLabel, reportCsv, unavailableValue, unitLabel, valueText, type Detail, type Metric, type OutletOption, type Report, type Unit } from './model.ts';

function HdOutletState({ report }: { report: Report }) {
  const hd = report.hdOutlet;
  if (!hd || report.filter.mode === 'WAREHOUSE') return null;
  const last = hd.lastSync;
  return <p className="fn-muted">HD Outlet: {hd.enabled ? 'aktif' : 'nonaktif'}{last ? ` · sinkron terakhir ${last.finishedAt ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(last.finishedAt)) : ''} (${last.status})` : ' · belum pernah sinkron'}</p>;
}

export function FinanceWorkspace({ currentUser, pathname }: { currentUser: User; pathname: string }) {
  const page = financePage(pathname);
  const [filter, setFilter] = useState(initialFilter);
  const { report: remote, accounts, reload } = useFinance(currentUser, filter);
  const report = remote.data;
  const canEdit = currentUser.role === 'FINANCE';
  const client = useMemo(() => createFinanceClient(currentUser), [currentUser.email, currentUser.role]);
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  useEffect(() => { if (report?.outlets) setOutlets(report.outlets.map(o => ({ id: o.id, name: o.name, isActive: o.isActive }))); }, [report]);

  // Drill-down of a component (optionally one unit): sub-codes and entries.
  const [selected, setSelected] = useState<{ key: Metric; unit: Unit | null } | null>(null);
  const [detail, setDetail] = useState<{ data: Detail | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  useEffect(() => setSelected(null), [pathname, filter]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail({ data: null, loading: true, error: null });
    client.detail(filter, selected.key, selected.unit, controller.signal).then(data => setDetail({ data, loading: false, error: null }))
      .catch(error => { if (!controller.signal.aborted) setDetail({ data: null, loading: false, error: error instanceof Error ? error.message : 'Rincian gagal dimuat.' }); });
    return () => controller.abort();
  }, [selected, client]);
  const open = (key: Metric, unit: Unit | null = null) => setSelected({ key, unit });
  const selectedUnit = selected?.unit ? report?.byUnit.find(r => unitLabel(r.unit) === unitLabel(selected.unit!)) : undefined;
  const detailValue = selected ? (selectedUnit?.metrics[selected.key] ?? (selected.unit ? undefined : report?.metrics[selected.key]) ?? unavailableValue) : unavailableValue;
  const detailSources = selected ? (selectedUnit?.sources[selected.key] ?? report?.sources[selected.key] ?? []) : [];

  const exportCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `finance-${filter.mode.toLowerCase()}-${filter.startDate}-${filter.endDate}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const title = PAGES.find(([key]) => key === page)![1];
  const entries = (classes: ('DC' | 'DA' | 'CI')[]) => canEdit
    ? <EntryManager key={classes.join()} classes={classes} accounts={accounts.data} outlets={outlets} filter={filter} canEdit={canEdit} onChanged={reload} />
    : <p className="fn-section-note">Input dan daftar entri hanya untuk role Finance. Klik komponen di atas untuk melihat rincian per kode dan per entri.</p>;
  // Input panels for each page. Finance sees them right under the filter card;
  // other roles see the note at the bottom of the page.
  const INPUTS: Partial<Record<typeof page, [string, ('DC' | 'DA' | 'CI')[]]>> = {
    'commercial-income': ['Other Income (input Finance)', ['CI']],
    'distribution-cost': ['Entri biaya', ['DC']],
    'depreciation-amortization': ['Entri DA', ['DA']],
  };
  const input = INPUTS[page];
  const inputPanel = input && <Panel title={input[0]} collapseKey={`input:${page}`}>{entries(input[1])}</Panel>;

  return <div className="fn-workspace">
    <header className="fn-heading"><div><p className="fn-eyebrow">FINANCE · HD WAREHOUSE</p><h1>{title}</h1><p className="fn-muted">Sumber: input Finance, transaksi Warehouse, dan laporan harian HD Outlet. Dihitung di backend per outlet dan periode.</p>{report && <HdOutletState report={report} />}</div><Button onClick={reload} disabled={remote.loading}><RefreshCw size={14} />Muat ulang</Button></header>
    {page !== 'settings' && <Filters filter={filter} onChange={setFilter} outlets={outlets} />}
    {canEdit && inputPanel}
    {page !== 'settings' && <ApiState loading={remote.loading} error={remote.error} reload={reload} />}
    {accounts.error && <p role="alert">Master kode biaya: {accounts.error}</p>}
    {report?.sourceContext === 'test-fixture' && <p className="fn-notice" role="status">Sumber Finance saat ini adalah database fixture pengujian. Data ini bukan data operasional asli.</p>}
    {page !== 'settings' && !remote.loading && report && !report.complete && <div className="fn-notice" role="status"><Info size={16} /><span>Sebagian komponen <strong>Partial</strong> atau <strong>Missing</strong>: angka yang tampil adalah jumlah data yang sudah ada. Klik komponen untuk melihat alasannya.</span></div>}
    {page !== 'settings' && report && <Issues report={report} />}

    {report && page === 'dashboard' && <>
      <section className="fn-kpis" aria-label="Ringkasan Finance">{(['CI', 'DC', 'EBITDA', 'EBIT'] as Metric[]).map(key => { const value = report.metrics[key]; return <button key={key} onClick={() => open(key)}><span>{LABELS[key]}</span><strong>{valueText(value)}</strong><Status value={value.status} /></button>; })}</section>
      <MissingInputs report={report} keys={[...DC, ...DA]} />
      <Panel title="Ringkasan per unit"><UnitTable report={report} onDetail={open} /></Panel>
    </>}
    {report && page === 'commercial-income' && <>
      <Panel title="Commercial Income"><MetricTable keys={COMMERCIAL} report={report} onDetail={key => open(key)} /><EliminationNote report={report} /><p className="fn-section-note">Outlet: SI dan SH dari laporan harian HD Outlet; COGS = barang yang di-approve Warehouse untuk outlet (qty disetujui × harga di request). Warehouse: SI = penjualan ke outlet (qty disetujui × harga); COGS = HPP saat approve. Request yang dibatalkan tidak dihitung. OI dari input Finance.</p></Panel>
      <Panel title="Per unit"><UnitTable report={report} keys={['SI', 'OI', 'SH', 'COGS', 'CI']} onDetail={open} /></Panel>
      {!canEdit && inputPanel}
    </>}
    {report && page === 'distribution-cost' && <>
      <Panel title="Distribution Cost"><MetricTable report={report} keys={[...DC, 'DC']} onDetail={key => open(key)} /></Panel>
      <MissingInputs report={report} keys={DC} />
      <Panel title="Per unit"><UnitTable report={report} keys={[...DC, 'DC']} onDetail={open} /></Panel>
      {!canEdit && inputPanel}
    </>}
    {report && page === 'depreciation-amortization' && <>
      <Panel title="Depreciation & Amortization"><MetricTable report={report} keys={[...DA, 'DA']} onDetail={key => open(key)} /><p className="fn-section-note">DA tidak termasuk Distribution Cost; DA mengurangi EBIT, tidak EBITDA.</p></Panel>
      <MissingInputs report={report} keys={DA} />
      {!canEdit && inputPanel}
    </>}
    {report && page === 'profit-loss' && <>
      <Panel title={`Profit & Loss · ${modeLabel(filter.mode)}`}><MetricTable keys={PROFIT_LOSS} report={report} onDetail={key => open(key)} /><EliminationNote report={report} /></Panel>
      <Panel title="Per unit"><UnitTable report={report} keys={PROFIT_LOSS} onDetail={open} /></Panel>
    </>}
    {report && page === 'reports' && <>
      <Panel title={`Laporan ${modeLabel(filter.mode)}`} action={<Button disabled={remote.loading} onClick={exportCsv}><Download size={14} />Export CSV</Button>}><MetricTable keys={PL} report={report} onDetail={key => open(key)} /><EliminationNote report={report} /></Panel>
      <Panel title="Perbandingan unit"><UnitTable report={report} onDetail={open} /></Panel>
    </>}
    {page === 'settings' && (canEdit
      ? <><HdOutletSettings filter={filter} accounts={accounts.data} outlets={outlets} onChanged={reload} /><HdAttendanceSettings filter={filter} outlets={outlets} onChanged={reload} /><AccountSettings accounts={accounts.data} canEdit={canEdit} onChanged={reload} /></>
      : <><StateMessage>Pengaturan integrasi dan master kode hanya untuk role Finance.</StateMessage><AccountSettings accounts={accounts.data} canEdit={false} onChanged={reload} /></>)}

    {report && selected && <Modal wide title={`Detail ${selected.key} · ${LABELS[selected.key]}`} onClose={() => setSelected(null)}>
      <DetailView metric={selected.key} value={detailValue} sources={detailSources} unit={selected.unit} detail={detail.data} loading={detail.loading} error={detail.error} outlets={outlets} />
    </Modal>}
  </div>;
}
