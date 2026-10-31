// Fills requests.outlet_id for old requests that have none. The outlet is taken
// from what the request itself recorded when it was made: requester_name is
// "<outlet name> (<user name>)". The user's current placement is shown only as a
// hint and never applied, because the user may have moved since.
//   npm run finance:backfill-outlets             # comparison only
//   npm run finance:backfill-outlets -- --apply  # store the resolved outlets
import { and, eq, isNull } from 'drizzle-orm';
import { db, pool } from '../src/db/index.ts';
import { outlets, requests, users } from '../src/db/schema.ts';
import { outletFromRequesterName } from '../src/finance/requestOutlet.ts';

const apply = process.argv.includes('--apply');
try {
  const master = (await db.select({ id: outlets.id, name: outlets.outletName, code: outlets.outletCode }).from(outlets));
  const missing = await db.select({ id: requests.id, code: requests.requestCode, requesterName: requests.requesterName, userId: requests.userId, userOutlet: users.outletId, status: requests.status })
    .from(requests).leftJoin(users, eq(users.id, requests.userId)).where(isNull(requests.outletId)).orderBy(requests.id);
  const resolved = missing.map(r => ({ ...r, outlet: outletFromRequesterName(r.requesterName, master) }));
  const unknown = resolved.filter(r => !r.outlet);
  console.log(`${missing.length} request tanpa outlet_id; ${missing.length - unknown.length} dapat ditentukan, ${unknown.length} tidak.`);
  if (resolved.length) console.table(resolved.map(r => ({
    Request: r.code, Status: r.status, 'Nama pemohon': r.requesterName,
    'Outlet dari transaksi': r.outlet?.name ?? 'TIDAK DAPAT DITENTUKAN',
    'Outlet user sekarang (petunjuk)': master.find(o => o.id === r.userOutlet)?.name ?? '—',
  })));
  if (unknown.length) console.log('Request yang tidak dapat ditentukan perlu diisi manual oleh Admin; outlet user saat ini tidak dipakai otomatis.');
  if (!apply) console.log('Tidak ada yang disimpan. Jalankan dengan --apply untuk menyimpan outlet yang dapat ditentukan.');
  else {
    let saved = 0;
    await db.transaction(async (tx) => {
      for (const r of resolved) if (r.outlet) {
        const [result] = await tx.update(requests).set({ outletId: r.outlet.id }).where(and(eq(requests.id, r.id), isNull(requests.outletId)));
        saved += Number(result.affectedRows ?? 0);
      }
    });
    console.log(`${saved} request diperbarui.`);
  }
} finally {
  await pool.end();
}
