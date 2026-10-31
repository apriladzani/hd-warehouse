// Needs the database from backend/.env; run with `npm run test:db`. Everything
// happens inside one transaction that is always rolled back.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

after(async () => { if (process.env.DB_TESTS) await (await import('../src/db/index.ts')).pool.end(); });

test('a/b. a request keeps the outlet of its creation even after the user moves', { skip: !process.env.DB_TESTS }, async () => {
  const { db } = await import('../src/db/index.ts');
  const { items, outlets, requestItems, requests, users } = await import('../src/db/schema.ts');
  const { createRequest } = await import('../src/db/repository.ts');
  const { loadLedger } = await import('../src/db/periodClosing.ts');
  const ROLLBACK = new Error('rollback');
  try {
    await db.transaction(async (tx) => {
      const [bantar] = await tx.select().from(outlets).where(eq(outlets.outletName, 'Bantar Malam'));
      const [other] = await tx.select().from(outlets).where(eq(outlets.outletName, 'Cisalak'));
      const [item] = await tx.select().from(items).limit(1);
      assert.ok(bantar && other && item, 'needs outlets Bantar Malam and Cisalak and one item');
      const [userInsert] = await tx.insert(users).values({ name: 'Test Outlet', username: `t-outlet-${Date.now()}`, email: `t-outlet-${Date.now()}@example.test`, role: 'OUTLET', outletId: bantar.id });
      const userId = Number(userInsert.insertId);

      // a. The request route passes the requester's placement at creation time.
      const [placement] = await tx.select({ outletId: users.outletId }).from(users).where(eq(users.id, userId));
      const request = await createRequest({ userId, outletId: Number(placement.outletId), requesterName: `${bantar.outletName} (Test Outlet)`, paymentMethod: 'Transfer', requestDate: '2026-10-31', items: [{ itemId: item.id, quantity: 1, price: 1000 }] }, tx);
      assert.equal(request.outletId, bantar.id);
      await assert.rejects(createRequest({ userId, outletId: 0, requesterName: 'x', paymentMethod: 'Transfer', requestDate: '2026-10-31', items: [] }, tx), /wajib memiliki outlet/);

      // b. The user moves; the stored request and the report keep Bantar Malam.
      await tx.update(users).set({ outletId: other.id }).where(eq(users.id, userId));
      await tx.update(requestItems).set({ status: 'Approved', approvedQuantity: 1 }).where(eq(requestItems.requestId, request.id));
      const [stored] = await tx.select({ outletId: requests.outletId }).from(requests).where(eq(requests.id, request.id));
      assert.equal(stored.outletId, bantar.id);
      const ledger = await loadLedger(tx);
      const outletsOfItem = ledger.open.get(item.id)!.outlets;
      assert.ok(outletsOfItem.some(o => o.outletId === bantar.id && o.soldQuantity >= 1));
      throw ROLLBACK;
    });
  } catch (error) { if (error !== ROLLBACK) throw error; }
});

test('i. a request dated in a closed period is refused', { skip: !process.env.DB_TESTS }, async () => {
  const { db } = await import('../src/db/index.ts');
  const { items, outlets } = await import('../src/db/schema.ts');
  const { createRequest, getFinancePeriods } = await import('../src/db/repository.ts');
  const ROLLBACK = new Error('rollback');
  try {
    const closed = (await getFinancePeriods()).filter((period) => period.status === 'Closed').at(-1);
    if (!closed?.endDate) return; // no closed period in this database
    const inside = new Date(Date.parse(`${closed.endDate}T12:00:00+07:00`) - 86_400_000).toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      const [outlet] = await tx.select().from(outlets).limit(1);
      const [item] = await tx.select().from(items).limit(1);
      const request = (requestDate: string) => createRequest({ outletId: outlet.id, requesterName: `${outlet.outletName} (Test)`, paymentMethod: 'Transfer', requestDate, items: [{ itemId: item.id, quantity: 1, price: 1000 }] }, tx);
      await assert.rejects(request(inside), (error: Error) => /^Periode \d+ sudah ditutup\. Gunakan form koreksi\.$/.test(error.message));
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
      assert.ok((await request(today)).id);
      throw ROLLBACK;
    });
  } catch (error) { if (error !== ROLLBACK) throw error; }
});
