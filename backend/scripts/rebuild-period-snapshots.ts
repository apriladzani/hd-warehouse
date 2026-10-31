// Rebuilds every Stock Opname period from transaction history, in order, carrying
// closing stock/average into the next period. Without --apply nothing is written.
//   npm run finance:rebuild-periods                 # comparison only
//   npm run finance:rebuild-periods -- --csv=out.csv
//   npm run finance:rebuild-periods -- --apply      # store missing snapshots
import { writeFileSync } from 'node:fs';
import { db, pool } from '../src/db/index.ts';
import { items, inventoryCostPeriods } from '../src/db/schema.ts';
import { loadLedger, saveSnapshot } from '../src/db/periodClosing.ts';
import { getFinancePeriods } from '../src/db/repository.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find(a => a.startsWith('--csv='))?.slice('--csv='.length);
const rp = (value: string | number | null) => value === null ? '—' : Math.round(Number(value)).toLocaleString('id-ID');
const avg = (value: string | number | null) => value === null ? '—' : Number(value).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

try {
  const [data, itemRows, counts, periods] = [await loadLedger(), await db.select().from(items), await db.select().from(inventoryCostPeriods), await getFinancePeriods()];
  const itemById = new Map(itemRows.map(i => [i.id, i]));
  const csv: string[][] = [['periode', 'opname_id', 'status', 'barang', 'stok_lama_live', 'stok_awal', 'masuk', 'koreksi', 'terjual', 'stok_sistem', 'stok_sistem_tercatat_SO', 'stok_fisik', 'selisih', 'stok_akhir', 'avg_lama_live', 'avg_akhir', 'hpp_lama', 'hpp_baru', 'untung_lama', 'untung_baru']];
  let pending = 0;
  data.periods.forEach((period, index) => {
    const label = periods.find(p => p.opnameId === period.opnameId)?.label ?? 'Sebelum transaksi pertama';
    const status = period.snapshot ? `terkunci ${period.snapshot.closedAt} (dilewati)` : 'akan disimpan';
    if (!period.snapshot) pending += 1;
    const rows = [...data.closed[index]].filter(([, r]) => r.inQuantity || r.soldQuantity || r.difference || r.correctionQuantity || r.openingStock);
    console.log(`\n=== ${label} · SO-${period.opnameId} · s/d ${new Date(period.end).toISOString()} · ${status}`);
    const table = rows.map(([itemId, r]) => {
      const item = itemById.get(itemId)!;
      // The old page: live Inventory stock and average for every period.
      const liveAverage = Number(item.avgPurchasePrice || 0);
      const oldCogs = r.soldQuantity * liveAverage;
      const recordedSystem = counts.find(c => c.stockOpnameId === period.opnameId && c.itemId === itemId)?.systemStock ?? null;
      csv.push([label, String(period.opnameId), period.snapshot ? 'locked' : 'pending', item.itemName, String(item.currentStock), String(r.openingStock), String(r.inQuantity), String(r.correctionQuantity), String(r.soldQuantity), String(r.systemStock), String(recordedSystem ?? ''), String(r.physicalStock ?? ''), String(r.difference ?? ''), String(r.closingStock), String(liveAverage), r.closingAverage ?? '', String(oldCogs), r.cogs ?? '', String(Number(r.sales) - oldCogs), r.profit ?? '']);
      return {
        Barang: item.itemName,
        'Stok lama': item.currentStock, 'Awal': r.openingStock, 'Masuk': r.inQuantity, 'Terjual': r.soldQuantity,
        'Sistem': r.systemStock + (recordedSystem !== null && recordedSystem !== r.systemStock ? ` (SO: ${recordedSystem})` : ''),
        'Fisik': r.physicalStock ?? '—', 'Selisih': r.difference ?? '—', 'Akhir': r.closingStock,
        'Avg lama': avg(liveAverage), 'Avg baru': avg(r.closingAverage),
        'HPP lama': rp(oldCogs), 'HPP baru': rp(r.cogs),
        'Untung lama': rp(Number(r.sales) - oldCogs), 'Untung baru': rp(r.profit),
      };
    });
    if (table.length) console.table(table); else console.log('(tidak ada pergerakan)');
  });
  if (csvPath) { writeFileSync(csvPath, csv.map(r => r.map(v => `"${v.replaceAll('"', '""')}"`).join(',')).join('\n')); console.log(`\nCSV: ${csvPath}`); }
  console.log(`\n"Sistem (SO: x)" = stok sistem yang tercatat saat opname berbeda dari hasil hitung ulang.`);

  if (!apply) console.log(`\n${pending} periode belum punya snapshot. Tidak ada yang disimpan; jalankan dengan --apply setelah angka di atas diperiksa.`);
  else {
    const saved = await db.transaction(async (tx) => {
      await tx.select({ id: items.id }).from(items).for('update'); // no receipt/sale/opname while saving
      const locked = await loadLedger(tx);
      let count = 0;
      for (const period of locked.periods) if (!period.snapshot && await saveSnapshot(tx, locked, period.opnameId, 'REBUILD', 'Rebuild script')) count += 1;
      return count;
    });
    console.log(`\n${saved} snapshot periode disimpan.`);
  }
} finally {
  await pool.end();
}
