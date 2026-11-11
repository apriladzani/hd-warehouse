// A cancelled sale must leave the moving average exactly as if the sale had
// never happened: the units come back before the later purchase, so that
// purchase is averaged over the larger balance. Needs the database from
// backend/.env (connection-local TEMPORARY tables); run with `npm run test:db`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const dbTest = { skip: !process.env.DB_TESTS };
after(async () => { if (process.env.DB_TESTS) await (await import('./helpers/temporaryDatabase.ts')).closePool(); });
// Same sequence twice: with the sale cancelled, and with no sale at all.
async function run(withSale: boolean) {
  let result: any;
  const { withTemporaryDatabase } = await import('./helpers/temporaryDatabase.ts');
  await withTemporaryDatabase(async (c) => {
    const repo = await import('../src/db/repository.ts');
    await c.query("INSERT INTO vendors (id, vendor_code, vendor_name) VALUES (1, 'V', 'V')");
    await c.query("INSERT INTO outlets (id, outlet_code, outlet_name, is_active) VALUES (1, 'o', 'O', 1)");
    await c.query("INSERT INTO users (id, name, username, email, password, role, outlet_id, is_active) VALUES (1, 'O', 'o', 'o@t', 'x', 'OUTLET', 1, 1)");
    await c.query("INSERT INTO items (id, item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES (1, 'A', 'Raw Material', 'RM-801', 45000, 0, 0)");
    for (let i = 2; i <= 10; i++) await c.query(`INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('F${i}', 'Raw Material', 'RM-9${i}', 1, 0, 0)`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    await repo.registerIncomingGoods({ vendorCode: 'V', vendorName: 'V', paymentMethod: 'Transfer', transactionDate: today, items: [{ itemId: 1, itemName: 'A', quantity: 100, price: 20000 }] });
    let reqId = 0;
    if (withSale) {
      const req = await repo.createRequest({ userId: 1, outletId: 1, requesterName: 'O', paymentMethod: 'Transfer', requestDate: today, items: [{ itemId: 1, quantity: 50, price: 45000 }] });
      reqId = req.id;
      const [[line]]: any = await c.query('SELECT id FROM request_items WHERE request_id = ?', [reqId]);
      await repo.updateRequestItemStatus(reqId, line.id, 'Approve', 'G');
    }
    await repo.registerIncomingGoods({ vendorCode: 'V', vendorName: 'V', paymentMethod: 'Transfer', transactionDate: today, items: [{ itemId: 1, itemName: 'A', quantity: 50, price: 30000 }] });
    const [[mid]]: any = await c.query('SELECT avg_purchase_price a FROM items WHERE id = 1');
    if (withSale) await repo.cancelRequest(reqId, { id: 1, name: 'O', role: 'OUTLET' }, null);
    const [[end]]: any = await c.query('SELECT avg_purchase_price a, current_stock s FROM items WHERE id = 1');
    const [pi]: any = await c.query('SELECT quantity, avg_cost_after FROM purchase_items ORDER BY id');
    result = { midAvg: Number(mid.a), avg: Number(end.a), stock: Number(end.s), purchases: pi.map((p: any) => [p.quantity, Number(p.avg_cost_after)]) };
  });
  return result;
}
test('cancelling a sale reprices the open period as if it never happened', dbTest, async () => {
  const cancelled = await run(true);
  const never = await run(false);
  // Before the cancellation: 50 left at 20.000 plus 50 bought at 30.000.
  assert.equal(cancelled.midAvg, 25000);
  // After it: 100 at 20.000 plus 50 at 30.000, the same as no sale at all.
  assert.equal(cancelled.avg, 23333.333333);
  assert.deepEqual(cancelled, { ...never, midAvg: 25000 });
  assert.equal(cancelled.stock, 150);
});
