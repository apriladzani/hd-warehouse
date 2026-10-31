import React, { useEffect, useRef, useState } from 'react';
import type { FinancePeriod, OutletSalesBreakdown, WarehouseItemProfitability } from '../../types.ts';
import { formatMoney } from '../../finance/model.ts';
import { warehouseEstimate, warehouseEstimateTotals } from '../../finance/warehouseEstimate.ts';
import { outletName, type OutletOption } from '../../finance/outletFilter.ts';
import { formatDateIndo } from '../../lib/format.ts';
const unknown = 'Belum terverifikasi';
const qty = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('id-ID');
const signed = (n: number | null | undefined) => n == null ? '—' : n > 0 ? `+${qty(n)}` : qty(n);
const average = (v: string | null | undefined) => v == null ? unknown : Number(v) === 0 ? '—' : `Rp${Number(v).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (n: number | null | undefined) => n == null || n === 0 ? undefined : n < 0 ? 'fin-negative' : 'fin-positive';
const moneyTone = (v: string | null | undefined) => v != null && v.startsWith('-') && Number(v) !== 0 ? 'fin-negative' : undefined;
const money = (v: string | null | undefined) => v == null ? unknown : formatMoney(v);
const AVERAGE_HINT = 'Harga rata-rata di akhir periode. HPP dihitung dari rata-rata saat masing-masing transaksi terjadi.';
export const WAREHOUSE_STOCK_NOTE = 'Stok adalah stok gudang pusat, tidak dipecah per outlet.';

// "Box Nasi (pack/10)" → name "Box Nasi", unit "pack/10".
export function splitItemName(full: string) {
  const match = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(full);
  return match ? { name: match[1], unit: match[2] } : { name: full, unit: '' };
}
export const hasActivity = (r: WarehouseItemProfitability) => [r.openingStock, r.purchaseQuantity, r.correctionQuantity, r.quantity, r.physicalStock, r.difference, r.closingStock]
  .some(n => Number(n ?? 0) !== 0) || [r.totalSellingAmountExact, r.totalCogsAmountExact].some(v => v != null && Number(v) !== 0);

export function periodNote(period?: FinancePeriod | null) {
  if (!period || period.status === 'Open') return 'Estimasi berjalan, dapat berubah sampai periode ditutup.';
  if (period.status === 'All') return 'Gabungan semua periode: stok awal periode pertama, total pergerakan, dan stok akhir terkini.';
  if (period.locked && period.closedAt) return `Data terkunci per ${formatDateIndo(period.closedAt)}. Nilai historis periode ini.`;
  return 'Periode sudah ditutup, tetapi snapshot belum disimpan. Angka dihitung ulang dari histori transaksi.';
}

// An item row restricted to one outlet's sales (for the per-outlet grouping).
const forOutlet = (r: WarehouseItemProfitability, o: OutletSalesBreakdown): WarehouseItemProfitability => ({
  ...r, quantity: o.soldQuantity, averageSellingPrice: o.soldQuantity ? Number(o.sales) / o.soldQuantity : 0,
  totalSellingAmountExact: o.sales, totalCogsAmountExact: o.cogs ?? null, totalProfitExact: o.profit ?? null,
});
export function outletGroups(rows: WarehouseItemProfitability[]) {
  const ids = [...new Set(rows.flatMap(r => (r.outletBreakdown ?? []).map(o => o.outletId)))];
  return ids.map(outletId => {
    const items = rows.flatMap(r => (r.outletBreakdown ?? []).filter(o => o.outletId === outletId && (o.soldQuantity || Number(o.sales))).map(o => forOutlet(r, o)));
    return { outletId, items, totals: warehouseEstimateTotals(items) };
  }).filter(g => g.items.length).sort((a, b) => Number(b.totals.sales ?? 0) - Number(a.totals.sales ?? 0) || a.outletId - b.outletId);
}

type Cell = { value: string; title?: string; className?: string };
type Column = { key: string; label: string; title?: string; cell: (r: WarehouseItemProfitability) => Cell };
type Props = { rows: WarehouseItemProfitability[]; loading: boolean; period?: FinancePeriod | null; outletFiltered?: boolean; showCost?: boolean; outlets?: OutletOption[] };

export function WarehouseFinanceTable({ rows, loading, period, outletFiltered = false, showCost = true, outlets = [] }: Props) {
  const open = !period || period.status === 'Open';
  const [hideInactive, setHideInactive] = useState(true);
  const [byOutlet, setByOutlet] = useState(false);
  const visible = hideInactive ? rows.filter(hasActivity) : rows;
  const hiddenCount = rows.length - visible.length;
  // Warehouse stock is not split per outlet, so stock columns go when sales are.
  const outletView = outletFiltered || byOutlet;

  const stock: Column[] = outletView
    ? [{ key: 'sold', label: outletFiltered ? 'Terjual ke outlet terpilih' : 'Terjual', cell: r => ({ value: qty(r.quantity) }) }]
    : [
      { key: 'opening', label: 'Stok Awal', cell: r => ({ value: qty(r.openingStock) }) },
      { key: 'in', label: 'Masuk', cell: r => ({ value: r.correctionQuantity ? `${qty(r.purchaseQuantity)} (${signed(r.correctionQuantity)})` : qty(r.purchaseQuantity), title: r.correctionQuantity ? `Termasuk koreksi periode sebelumnya ${signed(r.correctionQuantity)}.` : undefined }) },
      { key: 'sold', label: 'Terjual', cell: r => ({ value: qty(r.quantity) }) },
      // Physical count and difference exist only once a period has an opname.
      ...(open ? [] : [
        { key: 'physical', label: 'Stok Fisik', cell: (r: WarehouseItemProfitability) => ({ value: qty(r.physicalStock), title: r.physicalStock == null ? 'Barang tidak diperiksa saat opname.' : undefined }) },
        { key: 'difference', label: 'Selisih', cell: (r: WarehouseItemProfitability) => ({ value: signed(r.difference), title: r.systemStock == null ? undefined : `Stok sistem ${qty(r.systemStock)}.`, className: tone(r.difference) }) },
      ]),
      { key: 'closing', label: 'Stok Akhir', cell: r => ({ value: qty(r.closingStock), title: r.physicalStock == null ? 'Stok sistem (belum ada stok fisik).' : undefined }) },
    ];
  const finance: Column[] = [
    ...(showCost ? [{ key: 'average', label: 'Rata-rata Akhir', title: AVERAGE_HINT, cell: (r: WarehouseItemProfitability) => ({ value: average(r.periodAverage), title: AVERAGE_HINT }) }] : []),
    { key: 'price', label: 'Harga Jual', cell: r => ({ value: formatMoney((r.quantity ? r.averageSellingPrice : r.catalogPrice).toFixed(6)) }) },
    ...(showCost ? [{ key: 'cogs', label: 'Total HPP', cell: (r: WarehouseItemProfitability) => ({ value: money(warehouseEstimate(r).cost), title: 'Qty × rata-rata pada saat tiap penjualan.' }) }] : []),
    { key: 'sales', label: 'Total Penjualan', cell: r => ({ value: money(warehouseEstimate(r).sales) }) },
    ...(showCost ? [{ key: 'profit', label: 'Estimasi Keuntungan', cell: (r: WarehouseItemProfitability) => { const v = warehouseEstimate(r).profit; return { value: money(v), className: moneyTone(v) }; } }] : []),
  ];
  const columns = [...stock, ...finance];
  // Quantities are not summed: units differ (kg, pack, pcs).
  const sums = (t: ReturnType<typeof warehouseEstimateTotals>): Record<string, Cell> => ({
    cogs: { value: money(t.cost) }, sales: { value: money(t.sales) }, profit: { value: money(t.profit), className: moneyTone(t.profit) },
  });
  const totals = sums(warehouseEstimateTotals(visible));
  const groups = byOutlet ? outletGroups(visible) : [];

  const scroller = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener('scroll', update); };
  }, [visible.length, columns.length, loading, byOutlet]);

  const name = (full: string) => { const { name, unit } = splitItemName(full); return <><span className="fin-item-name" title={full}>{name}</span>{unit && <span className="fin-item-unit">{unit}</span>}</>; };
  const body = loading ? 'Memuat laporan…' : !visible.length ? (rows.length ? 'Semua barang tanpa aktivitas pada periode ini.' : 'Tidak ada barang pada filter ini.') : null;
  const cellClass = (i: number, extra?: string) => [i === stock.length ? 'fin-group-start' : '', extra ?? ''].join(' ').trim() || undefined;
  const itemRow = (r: WarehouseItemProfitability, key: React.Key) => <tr key={key}>
    <th scope="row" className="fin-name">{name(r.itemName)}</th>
    {columns.map((c, i) => { const cell = c.cell(r); return <td key={c.key} title={cell.title} className={cellClass(i, cell.className)}>{cell.value}</td>; })}
  </tr>;
  const sumRow = (label: string, cells: Record<string, Cell>, className: string) => <tr className={className}>
    <th scope="row" className="fin-name">{label}</th>
    {columns.map((c, i) => { const cell = cells[c.key] ?? { value: '—' }; return <td key={c.key} className={cellClass(i, cell.className)}>{cell.value}</td>; })}
  </tr>;
  const card = (r: WarehouseItemProfitability, key: React.Key) => { const e = warehouseEstimate(r); return <article className="fin-card" key={key}>
    <h3>{name(r.itemName)}</h3>
    {outletView
      ? <dl className="fin-card-stock"><div><dt>{outletFiltered ? 'Terjual ke outlet terpilih' : 'Terjual'}</dt><dd>{qty(r.quantity)}</dd></div></dl>
      : <dl className="fin-card-stock">
        <div><dt>Awal → Akhir</dt><dd>{qty(r.openingStock)} → {qty(r.closingStock)}</dd></div>
        <div><dt>Masuk</dt><dd>{qty(r.purchaseQuantity)}</dd></div>
        <div><dt>Terjual</dt><dd>{qty(r.quantity)}</dd></div>
      </dl>}
    <dl className="fin-card-money">
      {showCost && <div><dt>HPP</dt><dd>{money(e.cost)}</dd></div>}
      <div><dt>Penjualan</dt><dd>{money(e.sales)}</dd></div>
      {showCost && <div><dt>Keuntungan</dt><dd className={moneyTone(e.profit)}>{money(e.profit)}</dd></div>}
    </dl>
  </article>; };
  const totalCard = (label: string, t: Record<string, Cell>, key: React.Key = label) => <article className="fin-card fin-card--total" key={key}><h3><span className="fin-item-name">{label}</span></h3><dl className="fin-card-money">
    {showCost && <div><dt>HPP</dt><dd>{t.cogs.value}</dd></div>}<div><dt>Penjualan</dt><dd>{t.sales.value}</dd></div>{showCost && <div><dt>Keuntungan</dt><dd className={t.profit.className}>{t.profit.value}</dd></div>}
  </dl></article>;

  return <section className="hd-surface fin-detail" aria-labelledby="finance-detail-heading">
    <header className="fin-detail-header">
      <div><h2 id="finance-detail-heading">Rincian Transaksi Keuangan</h2><p>{periodNote(period)}</p>
        {outletView && <p>{WAREHOUSE_STOCK_NOTE}</p>}</div>
      <div className="fin-detail-toggles">
        <label className="fin-detail-toggle"><input type="checkbox" checked={byOutlet} onChange={e => setByOutlet(e.target.checked)} />Rincian per outlet</label>
        <label className="fin-detail-toggle"><input type="checkbox" checked={hideInactive} onChange={e => setHideInactive(e.target.checked)} />Sembunyikan barang tanpa aktivitas{hideInactive && hiddenCount > 0 && <span> ({hiddenCount})</span>}</label>
      </div>
    </header>
    {byOutlet && !body && <ul className="fin-outlet-summary" aria-label="Ringkasan per outlet">{groups.map(g => <li key={g.outletId}>
      <strong>{outletName(g.outletId, outlets)}</strong>
      <dl><div><dt>Total Penjualan</dt><dd>{money(g.totals.sales)}</dd></div>
        {showCost && <div><dt>HPP</dt><dd>{money(g.totals.cost)}</dd></div>}
        {showCost && <div><dt>Keuntungan</dt><dd className={moneyTone(g.totals.profit)}>{money(g.totals.profit)}</dd></div>}</dl>
    </li>)}</ul>}
    <div className={`fin-detail-scroll${moreRight ? ' fin-detail-scroll--more' : ''}`}>
      <div className="fin-detail-scroller" ref={scroller}>
        <table className="fin-detail-table">
          <colgroup><col className="fin-col-name" />{stock.map(c => <col key={c.key} className={outletView ? 'fin-col-sold' : 'fin-col-qty'} />)}{finance.map(c => <col key={c.key} className="fin-col-money" />)}</colgroup>
          <thead>
            <tr className="fin-head-groups"><th rowSpan={2} scope="col" className="fin-name">Nama Barang</th><th colSpan={stock.length} scope="colgroup">{outletView ? 'Outlet' : 'Stok'}</th><th colSpan={finance.length} scope="colgroup" className="fin-group-start">Keuangan</th></tr>
            <tr className="fin-head-columns">{columns.map((c, i) => <th key={c.key} scope="col" title={c.title} className={i === stock.length ? 'fin-group-start' : undefined}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {body ? <tr><td className="fin-empty" colSpan={columns.length + 1}>{body}</td></tr>
              : byOutlet ? groups.map(g => <React.Fragment key={g.outletId}>
                {sumRow(outletName(g.outletId, outlets), sums(g.totals), 'fin-group-row')}
                {g.items.map(r => itemRow(r, `${g.outletId}-${r.itemId}`))}
              </React.Fragment>)
              : visible.map(r => itemRow(r, r.itemId))}
          </tbody>
          {!body && <tfoot>{sumRow('Total', totals, '')}</tfoot>}
        </table>
      </div>
    </div>
    <div className="fin-detail-cards">{body ? <p className="fin-empty">{body}</p> : <>
      {byOutlet ? groups.map(g => <React.Fragment key={g.outletId}>
        {totalCard(outletName(g.outletId, outlets), sums(g.totals), `g-${g.outletId}`)}
        {g.items.map(r => card(r, `${g.outletId}-${r.itemId}`))}
      </React.Fragment>) : visible.map(r => card(r, r.itemId))}
      {totalCard('Total', totals)}
    </>}</div>
  </section>;
}

