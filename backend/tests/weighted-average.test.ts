import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createPool } from '../src/db/index.ts';
import { registerIncomingGoods, registerHDReceiving, recalculateItemAvgPurchasePrice, syncAllItemAveragePrices, getWarehouseDashboardStats } from '../src/db/repository.ts';

// Run explicitly against a configured MySQL connection. All writes use connection-local
// temporary tables that shadow production tables and disappear when the connection closes.
test('Inventory weighted average across vendors, dates, repeated lines, and stock changes', async () => {
  const pool = createPool();
  const connection = await pool.getConnection();
  const tables = ['vendors', 'items', 'item_vendors', 'purchase_transactions', 'purchase_items', 'stock_movements', 'requests', 'request_items'];
  try {
    for (const table of tables) {
      const [definition]: any = await connection.query(`SHOW CREATE TABLE ${table}`);
      const ddl = definition[0]['Create Table'].replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
        .split('\n').filter((line: string) => !line.trimStart().startsWith('CONSTRAINT')).join('\n')
        .replace(/,\n\)/g, '\n)');
      await connection.query(ddl);
    }
    await connection.query('ALTER TABLE items MODIFY avg_purchase_price DECIMAL(18,2) NOT NULL DEFAULT 0');
    mock.method(pool, 'query', connection.query.bind(connection));
    mock.method(pool, 'getConnection', async () => connection);
    mock.method(connection, 'release', () => {});
    await connection.query("INSERT INTO items (item_name, price, current_stock) VALUES ('Ayam', 30000, 500), ('Beras', 25000, 0)");
    const [initial]: any = await connection.query('SELECT id FROM items ORDER BY id');
    const [ayam, beras] = initial.map((r: any) => r.id);
    const receive = (vendorCode: string, date: string, quantity: number, price: number) => registerIncomingGoods({
      vendorCode, vendorName: vendorCode, paymentMethod: 'Transfer', transactionDate: date,
      items: [{ itemId: ayam, itemName: 'Ayam', quantity, price }],
    });
    const inventory = async () => {
      const [rows]: any = await connection.query('SELECT * FROM items WHERE id = ?', [ayam]);
      return rows[0];
    };
    await receive('A', '2026-10-10', 30, 20000);
    assert.equal(Number((await inventory()).avg_purchase_price), 20000);
    await receive('A', '2026-10-11', 40, 10000);
    assert.equal(Number((await inventory()).avg_purchase_price), 14285.71);
    await receive('B', '2026-09-01', 20, 20000);
    let row = await inventory();
    assert.equal(Number(row.avg_purchase_price), 15555.56);
    assert.equal(row.price, 30000);
    assert.equal(row.current_stock, 590);
    const [totals]: any = await connection.query('SELECT SUM(quantity) qty, SUM(quantity * price) value FROM purchase_items WHERE item_id = ?', [ayam]);
    assert.equal(Number(totals[0].qty), 90);
    assert.equal(Number(totals[0].value), 1400000);
    await connection.query('UPDATE items SET current_stock = 0 WHERE id = ?', [ayam]);
    await receive('B', '2026-10-15', 10, 20000);
    assert.equal(Number((await inventory()).avg_purchase_price), 16000);
    await registerHDReceiving({ items: [
      { itemId: ayam, itemName: 'Ayam', vendorCode: 'A', vendorName: 'A', quantity: 10, price: 10000 },
      { itemName: ' ayam ', vendorCode: 'B', vendorName: 'B', quantity: 10, price: 20000 },
      { itemId: beras, itemName: 'Beras', vendorCode: 'B', vendorName: 'B', quantity: 5, price: 5000 },
    ] });
    assert.equal(Number((await inventory()).avg_purchase_price), 15833.33);
    assert.equal(await recalculateItemAvgPurchasePrice(beras), 5000);
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-15', items: [
      { itemId: ayam, itemName: 'Ayam', quantity: 10, price: 10000 },
      { itemId: ayam, itemName: 'Ayam', quantity: 10, price: 20000 },
    ] });
    assert.equal(Number((await inventory()).avg_purchase_price), 15714.29);
    const before = await inventory();
    const counts = async () => {
      const [rows]: any = await connection.query('SELECT (SELECT COUNT(*) FROM purchase_transactions) purchases, (SELECT COUNT(*) FROM purchase_items) purchase_lines, (SELECT COUNT(*) FROM stock_movements) movements');
      return rows[0];
    };
    const beforeCounts = await counts();
    const quiet = mock.method(console, 'error', () => {});
    for (const quantity of [0, -1, NaN, 1.5]) await assert.rejects(receive('A', '2026-10-15', quantity, 20000));
    await assert.rejects(receive('A', '2026-10-15', 10, -1));
    await assert.rejects(registerHDReceiving({ items: [
      { itemName: 'Ayam', quantity: 10, price: 10000 },
      { itemName: 'Beras', quantity: -1, price: 10000 },
    ] }));
    assert.deepEqual(await inventory(), before);
    // A failure after the purchase header has been inserted must roll back every write.
    await assert.rejects(registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-15', items: [
      { itemId: ayam, itemName: 'Ayam', quantity: 10, price: 10000 },
      { itemName: 'x'.repeat(300), quantity: 1, price: 10000 },
    ] }));
    assert.deepEqual(await inventory(), before);
    assert.deepEqual(await counts(), beforeCounts);
    quiet.mock.restore();
    await connection.query('UPDATE items SET avg_purchase_price = 1');
    await syncAllItemAveragePrices();
    assert.equal(Number((await inventory()).avg_purchase_price), 15714.29);
    const dashboard = await getWarehouseDashboardStats('2026-10-15', '2026-10-15');
    assert.equal(dashboard.itemProfitability.find((i) => i.itemId === ayam)?.avgPurchasePrice, 15714.29);
    // Dashboard purchases use receiving quantities and original prices, independently of sales.
    const ayamPurchases = dashboard.itemProfitability.find((i) => i.itemId === ayam)!;
    assert.equal(ayamPurchases.purchaseQuantity, 50);
    assert.equal(ayamPurchases.totalPurchaseAmount, 800000);
    assert.equal(ayamPurchases.quantity, 0);
    assert.equal(ayamPurchases.totalSellingAmount, 0);
    const [request]: any = await connection.query(
      "INSERT INTO requests (request_code, requester_name, request_date, status) VALUES ('TEST-OUTLET', 'Outlet', '2026-10-15', 'Partially Approved')"
    );
    for (const [status, requested, approved] of [['Approved', 9, 7], ['Pending', 99, 99], ['Rejected', 10, 10], ['Approved', 2, 0]]) {
      await connection.query('INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, ?, ?, ?, ?)',
        [request.insertId, ayam, requested, approved, 123, status]);
    }
    const [oldRequest]: any = await connection.query(
      "INSERT INTO requests (request_code, requester_name, request_date, status) VALUES ('TEST-OLD', 'Outlet', '2026-09-01', 'Approved')"
    );
    await connection.query("INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 3, 3, 123, 'Approved')", [oldRequest.insertId, ayam]);
    const filtered = await getWarehouseDashboardStats('2026-10-15', '2026-10-15', ayam);
    assert.equal(filtered.itemProfitability.length, 1);
    const sale = filtered.itemProfitability[0];
    assert.equal(sale.itemId, ayam);
    assert.equal(sale.itemName, 'Ayam');
    assert.equal(sale.quantity, 7);
    assert.equal(sale.catalogPrice, 30000);
    assert.equal(sale.totalSellingAmount, 210000);
    assert.equal(sale.purchaseQuantity, 50);
    assert.equal(sale.totalPurchaseAmount, 800000);
    assert.equal(sale.avgPurchasePrice, Number((await inventory()).avg_purchase_price));
    assert.equal(filtered.totalPurchaseAmount, 800000);
    assert.ok(Math.abs(filtered.totalProfit - (210000 - 7 * sale.avgPurchasePrice)) < 0.001);
    const allDates = await getWarehouseDashboardStats(undefined, undefined, ayam);
    assert.equal(allDates.itemProfitability[0].purchaseQuantity, 140);
    assert.equal(allDates.totalPurchaseAmount, 2200000);
    assert.equal(allDates.totalQuantity, 10);
    // Both transaction dates are inclusive; a receiving-only item remains visible.
    const september = await getWarehouseDashboardStats('2026-09-01', '2026-09-01', ayam);
    assert.equal(september.itemProfitability[0].purchaseQuantity, 20);
    assert.equal(september.totalPurchaseAmount, 400000);
    assert.equal(september.totalQuantity, 3);
    const berasOnly = await getWarehouseDashboardStats('2026-10-15', '2026-10-15', beras);
    assert.equal(berasOnly.itemProfitability[0].purchaseQuantity, 5);
    assert.equal(berasOnly.totalPurchaseAmount, 25000);
    assert.equal(berasOnly.totalQuantity, 0);
    const emptyPeriod = await getWarehouseDashboardStats('2000-01-01', '2000-01-02', ayam);
    assert.equal(emptyPeriod.totalPurchaseAmount, 0);
    assert.equal(emptyPeriod.totalSellingAmount, 0);
    assert.equal(emptyPeriod.itemProfitability[0].avgPurchasePrice, sale.avgPurchasePrice);
    // A catalog change is reflected immediately without altering receiving totals.
    await connection.query('UPDATE items SET price = 35000 WHERE id = ?', [ayam]);
    const updatedCatalog = await getWarehouseDashboardStats('2026-10-15', '2026-10-15', ayam);
    assert.equal(updatedCatalog.itemProfitability[0].catalogPrice, 35000);
    assert.equal(updatedCatalog.totalSellingAmount, 245000);
    assert.equal(updatedCatalog.totalPurchaseAmount, 800000);
    // Zero-cost receipts contribute quantity and never fall back to catalog selling price.
    await connection.query("INSERT INTO items (item_name, price, current_stock) VALUES ('Gratis', 90000, 0)");
    const [free]: any = await connection.query("SELECT id FROM items WHERE item_name = 'Gratis'");
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-15', items: [
      { itemId: free[0].id, itemName: 'Gratis', quantity: 5, price: 0 },
    ] });
    const result = await getWarehouseDashboardStats();
    assert.equal(result.itemProfitability.find((i) => i.itemId === free[0].id)?.avgPurchasePrice, 0);
  } finally {
    mock.restoreAll();
    connection.destroy();
    await pool.end();
  }
});
