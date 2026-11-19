import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileText, Printer, X } from 'lucide-react';
import { FORMULA_TEXT, LABELS, TOTAL_ROWS, formatMoney, modeLabel, unitLabel, unavailableValue, valueText, type Metric, type Report, type Value } from './model.ts';

export type ReportLayout = 'total' | 'unit';

// Units per printed table: a wide period with many outlets continues in the
// next table instead of squeezing every outlet onto one line.
export const UNITS_PER_TABLE = 6;
export const chunk = <T,>(list: T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts.length ? parts : [[]];
};

const PRINT_CSS = (landscape: boolean) => `
  @media print {
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
    body > *:not(.hd-print-root) { display: none !important; }
    .hd-print-root .no-print { display: none !important; }
    .hd-print-root, .hd-print-root .hd-print-backdrop, .hd-print-root .hd-print-dialog, .hd-print-root .hd-print-scroll {
      position: static !important; inset: auto !important; display: block !important;
      width: auto !important; max-width: none !important; height: auto !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; overflow: visible !important;
      background: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; backdrop-filter: none !important;
    }
    #printable-finance-report { width: auto !important; margin: 0 !important; padding: 10mm !important; box-shadow: none !important; border: 0 !important; font-size: 9pt !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    #printable-finance-report thead { display: table-header-group !important; }
    #printable-finance-report tr { break-inside: avoid !important; }
    #printable-finance-report .fr-block { break-inside: avoid-page; }
  }
  #printable-finance-report { background: #fff; color: #0f172a; font-family: Inter, system-ui, sans-serif; font-size: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(15,23,42,.12); }
  #printable-finance-report h1 { font-size: 16px; margin: 0; }
  #printable-finance-report .fr-meta { color: #475569; margin: 4px 0 12px; line-height: 1.5; }
  #printable-finance-report table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  #printable-finance-report th, #printable-finance-report td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
  #printable-finance-report thead th { background: #f1f5f9; }
  #printable-finance-report .fr-num { text-align: right; white-space: nowrap; }
  #printable-finance-report .fr-total td, #printable-finance-report .fr-total th { font-weight: 700; background: #f8fafc; }
  #printable-finance-report .fr-formula { color: #64748b; font-size: .85em; }
  #printable-finance-report .fr-note { color: #475569; font-size: .9em; margin: 4px 0; }
`;

const amount = (value: Value | undefined) => {
  const v = value ?? unavailableValue;
  return v.status === 'Missing' ? '—' : `${valueText(v)}${v.status === 'Partial' ? ' *' : ''}`;
};

// The P&L as a sheet: every component, its total over the filter
// (Total keseluruhan) and, for the per-unit layout, one column per unit.
export function FinanceReportDocument({ report, keys, layout, printedAt = new Date() }: { report: Report; keys: Metric[]; layout: ReportLayout; printedAt?: Date }) {
  const outlets = report.outlets ?? [];
  const units = report.byUnit.map(row => ({ name: unitLabel(row.unit, outlets), metrics: row.metrics }));
  const chosen = report.filter.outletIds?.map(id => unitLabel({ type: 'OUTLET', outletId: id }, outlets)).join(', ') ?? 'Semua Outlet';
  const partial = keys.some(key => report.metrics[key]?.status === 'Partial' || units.some(u => u.metrics[key]?.status === 'Partial'));
  const eliminated = report.filter.mode === 'ALL' && report.elimination?.amount && !/^0(\.0+)?$/.test(report.elimination.amount);
  const label = (key: Metric) => <th scope="row">{key} · {LABELS[key]}{FORMULA_TEXT[key] && <span className="fr-formula"> = {FORMULA_TEXT[key]}</span>}</th>;
  const groups = chunk(units, UNITS_PER_TABLE);

  return <div id="printable-finance-report" data-layout={layout}>
    <h1>Laporan Profit &amp; Loss · {modeLabel(report.filter.mode)}</h1>
    <p className="fr-meta">Periode {report.filter.startDate} s.d. {report.filter.endDate} · Outlet: {chosen}<br />Dicetak {printedAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p>
    {layout === 'total'
      ? <table className="fr-block"><thead><tr><th>Komponen</th><th className="fr-num">Total keseluruhan</th></tr></thead><tbody>
          {keys.map(key => <tr key={key} className={TOTAL_ROWS.includes(key) ? 'fr-total' : undefined}>{label(key)}<td className="fr-num">{amount(report.metrics[key])}</td></tr>)}
        </tbody></table>
      : groups.map((group, index) => <table key={index} className="fr-block"><thead><tr><th>Komponen</th>{group.map(u => <th key={u.name} className="fr-num">{u.name}</th>)}{index === groups.length - 1 && <th className="fr-num">Total keseluruhan</th>}</tr></thead><tbody>
          {keys.map(key => <tr key={key} className={TOTAL_ROWS.includes(key) ? 'fr-total' : undefined}>{label(key)}{group.map(u => <td key={u.name} className="fr-num">{amount(u.metrics[key])}</td>)}{index === groups.length - 1 && <td className="fr-num">{amount(report.metrics[key])}</td>}</tr>)}
        </tbody></table>)}
    {partial && <p className="fr-note">* Partial: sebagian data sumber belum lengkap; angka adalah jumlah data yang sudah ada.</p>}
    {eliminated && <p className="fr-note">Keseluruhan: penjualan internal Warehouse → Outlet sebesar {formatMoney(report.elimination!.amount)} dikeluarkan dari total SI dan COGS. CI, EBITDA, dan EBIT tidak berubah.</p>}
  </div>;
}

export function PrintableFinanceReport({ report, keys, layout, onClose }: { report: Report; keys: Metric[]; layout: ReportLayout; onClose: () => void }) {
  const landscape = layout === 'unit' && report.byUnit.length > 2;
  const name = `Profit-Loss-${report.filter.mode.toLowerCase()}-${report.filter.startDate}-${report.filter.endDate}`;
  useEffect(() => {
    const original = document.title;
    const before = () => { document.title = name; };
    const after = () => { document.title = original; };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); document.removeEventListener('keydown', escape); document.title = original; };
  }, [name, onClose]);

  return createPortal(<div className="hd-print-root">
    <style>{PRINT_CSS(landscape)}</style>
    <div className="hd-modal-backdrop hd-print-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 overflow-y-auto" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="hd-print-dialog bg-white w-full max-w-5xl rounded-xl overflow-hidden flex flex-col max-h-[96vh]" role="dialog" aria-modal="true" aria-label="Preview cetak laporan">
        <div className="no-print flex items-center justify-between gap-2 px-4 py-3 border-b border-[#E2E8F0]">
          <span className="flex items-center gap-2 text-sm font-bold"><FileText className="w-4 h-4 text-[#FFB800]" />Preview cetak · {layout === 'total' ? 'Ringkasan total' : 'Per unit'} · A4 {landscape ? 'landscape' : 'portrait'}</span>
          <div className="flex items-center gap-2">
            <button id="btn-print-finance-report" className="hd-button hd-button--primary" onClick={() => window.print()}><Printer className="w-3.5 h-3.5" /><span>Cetak</span></button>
            <button className="hd-button hd-button--ghost hd-icon-button" title="Tutup" aria-label="Tutup" onClick={onClose}><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="hd-print-scroll overflow-auto p-4 bg-[#E2E8F0]/50"><FinanceReportDocument report={report} keys={keys} layout={layout} /></div>
      </div>
    </div>
  </div>, document.body);
}

// "Cetak / Export" menu of the P&L page.
export function ReportMenu({ disabled, onPrint, onExport }: { disabled?: boolean; onPrint: (layout: ReportLayout) => void; onExport: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const pick = (action: () => void) => () => { setOpen(false); action(); };
  return <div ref={root} className="fn-menu">
    <button id="btn-finance-report-menu" type="button" className="hd-button hd-button--secondary" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}><Printer size={14} /><span>Cetak / Export</span><ChevronDown size={13} /></button>
    {open && <div role="menu" className="fn-menu-list">
      <button type="button" role="menuitem" onClick={pick(() => onPrint('total'))}><FileText size={14} />Cetak ringkasan total</button>
      <button type="button" role="menuitem" onClick={pick(() => onPrint('unit'))}><FileText size={14} />Cetak per unit</button>
      <button type="button" role="menuitem" onClick={pick(onExport)}><Download size={14} />Export CSV</button>
    </div>}
  </div>;
}
