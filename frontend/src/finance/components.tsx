import React, { useEffect, useRef, useState } from 'react';
import { X, RefreshCw, ChevronRight, Database, Info, Paperclip } from 'lucide-react';
import { Button, StateMessage } from '../components/common/UI.tsx';
import { FORMULA_TEXT, LABELS, TOTAL_ROWS, modeLabel, unitLabel, unavailableValue, valueText, formatMoney, sourceText, type Detail, type Metric, type Value, type Filter, type Report, type OutletOption, type Unit } from './model.ts';

export function Status({ value = 'Missing' }: { value?: string }) { return <span className={`fn-status fn-status--${value.toLowerCase()}`}>{value}</span>; }
export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="hd-surface fn-panel"><header className="fn-panel-heading"><h2>{title}</h2>{action}</header>{children}</section>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="fn-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} className={`fn-modal hd-surface${wide ? ' fn-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="fn-modal-title"><header className="fn-panel-heading"><h2 id="fn-modal-title">{title}</h2><Button aria-label="Tutup" onClick={onClose}><X size={16} /></Button></header><div className="fn-modal-body">{children}</div></div></div>;
}

export function Filters({ filter, onChange, outlets }: { filter: Filter; onChange: (filter: Filter) => void; outlets: OutletOption[] }) {
  const [start, setStart] = useState(filter.startDate), [end, setEnd] = useState(filter.endDate);
  const invalid = !start || !end || start > end;
  const toggle = (id: number) => {
    const selected = filter.outletIds ?? [];
    const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
    onChange({ ...filter, outletIds: next.length ? next : null });
  };
  const chosen = filter.outletIds?.map(id => unitLabel({ type: 'OUTLET', outletId: id }, outlets));
  return <section className="hd-surface fn-filters" aria-label="Filter Finance bersama">
    <div className="fn-filter-top"><div className="fn-segments" role="group" aria-label="Tampilan">{(['ALL', 'OUTLET', 'WAREHOUSE'] as const).map(mode => <button type="button" key={mode} aria-pressed={filter.mode === mode} onClick={() => onChange({ ...filter, mode })}>{modeLabel(mode)}</button>)}</div><span className="fn-muted">Periode bisnis · Asia/Jakarta</span></div>
    <form className="fn-filter-fields" onSubmit={e => { e.preventDefault(); if (!invalid) onChange({ ...filter, startDate: start, endDate: end }); }}>
      <label>Tanggal mulai<input className="hd-input" type="date" required value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>Tanggal akhir<input className="hd-input" type="date" required value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>
      <div className="fn-outlets"><span>Outlet</span><details><summary className="hd-input">{chosen ? (chosen.length === 1 ? chosen[0] : `${chosen.length} outlet dipilih`) : 'Semua Outlet'}</summary><div className="fn-outlet-options"><label><input type="checkbox" checked={filter.outletIds === null} onChange={() => onChange({ ...filter, outletIds: null })} />Semua Outlet</label>{outlets.map(outlet => <label key={outlet.id}><input type="checkbox" checked={filter.outletIds?.includes(outlet.id) ?? false} onChange={() => toggle(outlet.id)} />{outlet.name}{outlet.isActive === false ? ' (nonaktif)' : ''}</label>)}{!outlets.length && <p className="fn-muted">Daftar outlet belum termuat.</p>}</div></details></div>
      <Button type="submit" disabled={invalid}>Terapkan periode</Button>
    </form>
    {invalid && <p role="alert">Tanggal awal dan akhir harus valid; tanggal akhir tidak boleh lebih awal.</p>}
    <p className="fn-filter-caption">Filter aktif: {modeLabel(filter.mode)} · {filter.startDate} — {filter.endDate} · {chosen?.join(', ') ?? 'Semua Outlet'}. {filter.mode === 'ALL' ? 'Keseluruhan = semua outlet terpilih + Warehouse.' : filter.mode === 'WAREHOUSE' ? 'Hanya biaya Warehouse (gudang pusat).' : 'Hanya outlet.'} Berlaku untuk semua halaman Finance.</p>
  </section>;
}
export function Loading() { return <div className="fn-skeleton" role="status" aria-label="Memuat laporan Finance"><span /><span /><span /><span /></div>; }
export function ApiState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
  if (loading) return <Loading />;
  if (!error) return null;
  return <div className="fn-api-state"><StateMessage kind="error">{error} Tidak ada angka pengganti yang ditampilkan.</StateMessage><Button onClick={reload}><RefreshCw size={14} />Coba lagi</Button></div>;
}

// Components with their amount, status and the sources the backend used.
export function MetricTable({ keys, report, onDetail }: { keys: Metric[]; report: Report | null; onDetail: (key: Metric) => void }) {
  return <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Kode</th><th>Komponen</th><th className="fn-right">Nominal</th><th>Status</th><th>Sumber data</th><th>Detail</th></tr></thead><tbody>{keys.map(key => {
    const value = report?.metrics[key] ?? unavailableValue;
    return <tr key={key} className={TOTAL_ROWS.includes(key) ? 'fn-total-row' : ''}><th scope="row">{key}</th><td>{LABELS[key]}{FORMULA_TEXT[key] && <span className="fn-formula"> = {FORMULA_TEXT[key]}</span>}</td><td className="fn-money">{valueText(value)}</td><td><Status value={value.status} /></td><td>{sourceText(report?.sources[key])}</td><td><Button variant="ghost" aria-label={`Detail ${key}`} onClick={() => onDetail(key)}><ChevronRight size={14} /></Button></td></tr>;
  })}</tbody></table></div>;
}
// `total` adds the Total keseluruhan column: the filter's total, the same
// number as the component tables (Keseluruhan leaves internal sales out).
export function UnitTable({ report, keys = ['SI', 'CI', 'DC', 'EBITDA', 'EBIT'], onDetail, total = false }: { report: Report | null; keys?: Metric[]; onDetail: (key: Metric, unit: Unit | null) => void; total?: boolean }) {
  if (!report?.byUnit.length) return <StateMessage>Tidak ada unit pada filter ini.</StateMessage>;
  // Codes run down the rows, units run across the columns.
  const units = report.byUnit.map(row => ({ row, name: unitLabel(row.unit, report.outlets) }));
  const cell = (key: Metric, value: Value | undefined, unit: Unit | null, name: string) => { const v = value ?? unavailableValue; return <button className="fn-value-link" onClick={() => onDetail(key, unit)} aria-label={`${key} ${name}`}><span>{valueText(v)}</span>{v.status !== 'Available' && <Status value={v.status} />}</button>; };
  return <div className="fn-table-wrap"><table className="fn-table fn-pivot"><thead><tr><th>Kode</th>{units.map(({ name }) => <th key={name} className="fn-right">{name}</th>)}{total && <th className="fn-right fn-grand">Total keseluruhan</th>}</tr></thead><tbody>{keys.map(key =>
    <tr key={key} className={TOTAL_ROWS.includes(key) ? 'fn-total-row' : ''}><th scope="row" title={LABELS[key]}>{key} <span className="fn-formula">{LABELS[key]}</span></th>{units.map(({ row, name }) => <td className="fn-right" key={name}>{cell(key, row.metrics[key], row.unit, name)}</td>)}{total && <td className="fn-right fn-grand">{cell(key, report.metrics[key], null, 'Total keseluruhan')}</td>}</tr>
  )}</tbody></table></div>;
}

// Units and costs without any input in the period: counted as Rp0, listed so a
// forgotten entry shows.
export function MissingInputs({ report, keys }: { report: Report; keys: Metric[] }) {
  const rows = report.notices.map(n => ({ unit: n.unit, metrics: n.metrics.filter(m => keys.includes(m)) })).filter(n => n.metrics.length);
  if (!rows.length) return null;
  return <details className="fn-notice"><summary><Info size={16} /> {rows.length} unit belum ada input pada periode ini — dihitung Rp0</summary><ul>{rows.map(n => <li key={n.unit.type === 'WAREHOUSE' ? 'W' : n.unit.outletId}><strong>{unitLabel(n.unit, report.outlets)}</strong>: {n.metrics.map(m => `${m} ${LABELS[m]}`).join(', ')}</li>)}</ul></details>;
}

// Gaps the totals carry (an unmapped HD Outlet outlet, a failed sync …).
export function Issues({ report }: { report: Report }) {
  if (!report.issues.length) return null;
  return <div className="fn-notice" role="status"><Info size={16} /><div><strong>Data belum lengkap</strong><ul>{report.issues.map((i, n) => <li key={n}>{i.reason}</li>)}</ul></div></div>;
}

// Keseluruhan: what Warehouse sold to the outlets in scope is internal; it
// leaves SI and COGS of the totals, CI does not change.
export function EliminationNote({ report }: { report: Report }) {
  const amount = report.elimination?.amount;
  if (report.filter.mode !== 'ALL' || !amount || /^0(\.0+)?$/.test(amount)) return null;
  return <p className="fn-section-note"><Info size={13} className="fn-inline" /> Keseluruhan: penjualan internal Warehouse → Outlet sebesar <strong>{formatMoney(amount)}</strong> dikeluarkan dari total SI dan COGS (sudah tercatat sebagai SI Warehouse sekaligus COGS outlet). CI, EBITDA, dan EBIT tidak berubah.</p>;
}

export const attachmentUrl = (name: string) => `/api/finance/v2/transactions/attachments/${encodeURIComponent(name)}`;

// Drill-down: the component's value, then its sub-codes (LC01, LC02 …) and each entry.
export function DetailView({ metric, value, sources, unit, detail, loading, error, outlets }: { metric: Metric; value: Value; sources: readonly string[]; unit: Unit | null; detail: Detail | null; loading: boolean; error: string | null; outlets: OutletOption[] }) {
  return <>
    <div className="fn-detail-value"><div><span>{metric} · {LABELS[metric]}{unit ? ` · ${unitLabel(unit, outlets)}` : ''}</span><strong>{valueText(value)}</strong>{FORMULA_TEXT[metric] && <span>{metric} = {FORMULA_TEXT[metric]}</span>}</div><Status value={value.status} /></div>
    <p><Database size={14} className="fn-inline" /> Sumber data: {sourceText(sources)}</p>
    {value.reasons.length > 0 && <ul className="fn-reasons">{value.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
    {loading && <Loading />}
    {error && <StateMessage kind="error">{error}</StateMessage>}
    {detail && <>
      <h3 className="fn-subheading">Per kode</h3>
      {detail.accounts.length ? <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Kode</th><th>Nama</th><th className="fn-right">Nominal</th><th className="fn-right">Entri</th><th>Sumber</th></tr></thead><tbody>{detail.accounts.map(a => <tr key={a.code}><th scope="row">{a.code}</th><td>{a.name}</td><td className="fn-money">{formatMoney(a.amount)}</td><td className="fn-right">{a.count}</td><td>{sourceText(a.sources)}</td></tr>)}</tbody></table></div> : <StateMessage>Belum ada entri untuk komponen ini pada filter aktif.</StateMessage>}
      {detail.entries.length > 0 && <><h3 className="fn-subheading">Entri ({detail.entries.length})</h3><div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Tanggal</th><th>Unit</th><th>Kode</th><th className="fn-right">Nominal</th><th>Keterangan</th><th>Sumber</th><th>Ref.</th></tr></thead><tbody>{detail.entries.slice(0, 500).map(e => <tr key={e.id}><td>{e.date}</td><td>{unitLabel(e.unit, outlets)}</td><td>{e.accountCode}</td><td className="fn-money">{formatMoney(e.amount)}</td><td className="fn-wrap">{e.notes}</td><td>{e.source}</td><td>{e.reference}{e.attachment && <> <a href={attachmentUrl(e.attachment)} target="_blank" rel="noreferrer" aria-label="Lampiran"><Paperclip size={13} /></a></>}</td></tr>)}</tbody></table></div>{detail.entries.length > 500 && <p className="fn-muted">Menampilkan 500 entri terbaru dari {detail.entries.length}. Persempit periode atau outlet untuk melihat semuanya.</p>}</>}
    </>}
  </>;
}
