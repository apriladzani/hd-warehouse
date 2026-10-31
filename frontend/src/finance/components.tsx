import React, { useEffect, useRef, useState } from 'react';
import { X, RefreshCw, ChevronRight, Database, Info } from 'lucide-react';
import { Button, StateMessage } from '../components/common/UI.tsx';
import { LABELS, modeLabel, unitLabel, sourceLabel, unavailableValue, valueText, formatMoney, type Metric, type Value, type Filter, type Report } from './model.ts';
export function Status({ value = 'Missing' }: { value?: string }) { return <span className={`fn-status fn-status--${value.toLowerCase()}`}>{value}</span>; }
export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="hd-surface fn-panel"><header className="fn-panel-heading"><h2>{title}</h2>{action}</header>{children}</section>;
}
export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose]);
  return <div className="fn-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} className="fn-modal hd-surface" role="dialog" aria-modal="true" aria-labelledby="fn-modal-title"><header className="fn-panel-heading"><h2 id="fn-modal-title">{title}</h2><Button aria-label="Tutup detail" onClick={onClose}><X size={16} /></Button></header><div className="fn-modal-body">{children}</div></div></div>;
}
export function Filters({ filter, onChange, outlets }: { filter: Filter; onChange: (filter: Filter) => void; outlets: { id: number; name: string }[] }) {
  const [start, setStart] = useState(filter.startDate), [end, setEnd] = useState(filter.endDate);
  const invalid = !start || !end || start > end;
  const toggle = (id: number) => {
    const selected = filter.outletIds ?? [];
    const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
    onChange({ ...filter, outletIds: next.length ? next : null });
  };
  return <section className="hd-surface fn-filters" aria-label="Filter Finance bersama">
    <div className="fn-filter-top"><div className="fn-segments" role="group" aria-label="Sumber data">{(['WAREHOUSE', 'OUTLET', 'ALL'] as const).map(mode => <button type="button" key={mode} aria-pressed={filter.mode === mode} onClick={() => onChange({ ...filter, mode })}>{modeLabel(mode)}</button>)}</div><span className="fn-muted">Periode bisnis · Asia/Jakarta</span></div>
    <form className="fn-filter-fields" onSubmit={e => { e.preventDefault(); if (!invalid) onChange({ ...filter, startDate: start, endDate: end }); }}>
      <label>Start Date<input className="hd-input" type="date" required value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>End Date<input className="hd-input" type="date" required value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>
      <div className="fn-outlets"><span>Outlet / unit</span><details><summary className="hd-input">{filter.outletIds ? `${filter.outletIds.length} outlet dipilih` : 'Semua Outlet'}</summary><div className="fn-outlet-options"><label><input type="checkbox" checked={filter.outletIds === null} onChange={() => onChange({ ...filter, outletIds: null })} />Semua Outlet</label>{outlets.map(outlet => <label key={outlet.id}><input type="checkbox" checked={filter.outletIds?.includes(outlet.id) ?? false} onChange={() => toggle(outlet.id)} />{outlet.name} · #{outlet.id}</label>)}{!outlets.length && <p className="fn-muted">Master outlet belum tersedia dari backend Finance.</p>}</div></details></div>
      <Button type="submit" disabled={invalid}>Terapkan periode</Button>
    </form>
    {invalid && <p role="alert">Tanggal awal dan akhir harus valid; tanggal akhir tidak boleh lebih awal.</p>}
    <p className="fn-filter-caption">Filter aktif: {modeLabel(filter.mode)} · {filter.startDate} — {filter.endDate} · {filter.outletIds?.map(id => `#${id}`).join(', ') ?? 'Semua Outlet'}. {filter.mode === 'WAREHOUSE' ? 'Pilihan outlet menyaring tujuan distribusi; biaya Warehouse tetap milik Warehouse.' : 'Berlaku untuk seluruh ringkasan, tabel, perbandingan, dan ekspor.'}</p>
  </section>;
}
export function Loading() { return <div className="fn-skeleton" role="status" aria-label="Memuat laporan Finance"><span /><span /><span /><span /></div>; }
export function ApiState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
  if (loading) return <Loading />;
  if (!error) return null;
  return <div className="fn-api-state"><StateMessage kind="error">{error} Data tidak diganti dengan angka contoh.</StateMessage><Button onClick={reload}><RefreshCw size={14} />Coba lagi</Button></div>;
}
export function MetricTable({ keys, report, onDetail, mode = report?.filter.mode ?? 'WAREHOUSE' }: { keys: Metric[]; report: Report | null; onDetail: (key: Metric) => void; mode?: Filter['mode'] }) {
  return <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Kode</th><th>Komponen</th><th className="fn-right">Nominal</th><th>Status</th><th>Sumber data</th><th>Detail</th></tr></thead><tbody>{keys.map(key => {
    const value = report?.metrics[key] ?? unavailableValue;
    return <tr key={key} className={['CM', 'COGS', 'CI', 'DC', 'DA', 'EBITDA', 'EBIT'].includes(key) ? 'fn-total-row' : ''}><th scope="row">{key}</th><td>{LABELS[key]}</td><td className="fn-money">{valueText(value)}</td><td><Status value={value.status} /></td><td>{sourceLabel(key, mode)}</td><td><Button variant="ghost" aria-label={`Detail ${key}`} onClick={() => onDetail(key)}><ChevronRight size={14} /></Button></td></tr>;
  })}</tbody></table></div>;
}
export function UnitTable({ report, keys = ['SI', 'CI', 'DC', 'EBITDA', 'EBIT'], onDetail }: { report: Report | null; keys?: Metric[]; onDetail: (key: Metric, unitIndex: number) => void }) {
  if (!report?.byUnit.length) return <StateMessage>Breakdown unit menunggu laporan backend sesuai filter aktif.</StateMessage>;
  return <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Unit</th>{keys.map(key => <th key={key} className="fn-right">{key}</th>)}</tr></thead><tbody>{report.byUnit.map((row, index) => <tr key={unitLabel(row.unit)}><th scope="row">{unitLabel(row.unit)}</th>{keys.map(key => <td className="fn-right" key={key}><button className="fn-value-link" onClick={() => onDetail(key, index)} aria-label={`${key} ${unitLabel(row.unit)}`}><span>{valueText(row.metrics[key])}</span><Status value={row.metrics[key].status} /></button></td>)}</tr>)}</tbody></table></div>;
}
export function SourceDetail({ metric, value, mode, children }: { metric: Metric; value: Value; mode: Filter['mode']; children?: React.ReactNode }) {
  return <><div className="fn-detail-value"><div><span>{metric} · {LABELS[metric]}</span><strong>{valueText(value)}</strong></div><Status value={value.status} /></div><p><Database size={14} className="fn-inline" /> {sourceLabel(metric, mode)}</p>{value.reasons.length > 0 && <ul className="fn-reasons">{value.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}<p className="fn-notice"><Info size={15} />Nilai mengikuti hasil backend. Missing bukan nol; distribusi internal tidak menjadi penjualan eksternal.</p>{children}</>;
}
export function Reconciliation({ report }: { report: Report | null }) {
  const distributions = report?.reconciliation.distributions ?? [], internal = report?.reconciliation.internalFacts ?? [];
  const [detail, setDetail] = useState<{ title: string; fields: [string, string][] } | null>(null);
  return <><p className="fn-section-note">Transaksi internal hanya untuk rekonsiliasi. Tidak ditambahkan ke SI eksternal atau nilai final grup.</p>{!distributions.length && !internal.length ? <StateMessage>Tidak ada baris rekonsiliasi internal pada respons untuk filter ini. Daftar transaksi eksternal dan ledger rinci belum disediakan API.</StateMessage> : <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Jenis</th><th>Referensi</th><th>Unit / tujuan</th><th className="fn-right">Nilai internal</th><th>Detail</th></tr></thead><tbody>{distributions.map(d => <tr key={`d:${d.id}`}><td>Distribusi Warehouse</td><td>{d.reference}</td><td>{d.outletId ? `Outlet #${d.outletId}` : 'Unmapped'}</td><td className="fn-money">{formatMoney(d.amount)}</td><td><Button onClick={() => setDetail({ title: d.reference, fields: [['ID baris', d.id], ['Referensi', d.reference], ['Nilai distribusi', formatMoney(d.amount)], ['Snapshot biaya internal', formatMoney(d.cost)], ['Pengakuan', 'Internal; bukan SI eksternal']] })}>Lihat sumber</Button></td></tr>)}{internal.map(f => <tr key={`f:${f.source}:${f.id}:${f.metric}`}><td>Internal · {f.metric}</td><td>{f.reference}</td><td>{unitLabel(f.unit)}</td><td className="fn-money">{formatMoney(f.amount)}</td><td><Button onClick={() => setDetail({ title: f.reference, fields: [['Sumber', f.source], ['ID', f.id], ['Tanggal', f.date], ['Kode', f.metric], ['Nominal internal', formatMoney(f.amount)]] })}>Lihat sumber</Button></td></tr>)}</tbody></table></div>}{detail && <Modal title={`Transaksi sumber · ${detail.title}`} onClose={() => setDetail(null)}><dl className="fn-definition">{detail.fields.map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}</dl></Modal>}</>;
}
