import assert from 'node:assert/strict';
import { after, test, mock } from 'node:test';
import { closePool, withTemporaryDatabase } from './helpers/temporaryDatabase.ts';
import { registerIncomingGoods, registerHDReceiving, recalculateItemAvgPurchasePrice, syncAllItemAveragePrices, getWarehouseDashboardStats, getFinancePeriods, getRequestDetail, updateRequestItemStatus, approveAllRequestItems, saveStockOpname, assertOpenPeriodDate } from '../src/db/repository.ts';
import { db } from '../src/db/index.ts';

// Runs against the configured MySQL server without touching its data: see
// tests/helpers/temporaryDatabase.ts.
after(closePool);

const jakartaDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const TODAY = jakartaDay(Date.now());
const daysAgo = (n: number) => jakartaDay(Date.now() - n * 86_400_000);
const noonOf = (day: string) => Date.parse(`${day}T12:00:00+07:00`);
const itemRow = (stats: any, itemId: number) => stats.itemProfitability.find((row: any) => row.itemId === itemId);

// A sale is an outlet request approved by the warehouse.
async function sell(connection: any, itemId: number, quantity: number, price: number, code: string) {
  const [request]: any = await connection.query("INSERT INTO requests (request_code, requester_name, payment_method, request_date, status, total_amount) VALUES (?, 'Outlet Test', 'Transfer', ?, 'Pending', ?)", [code, TODAY, quantity * price]);
  const [line]: any = await connection.query("INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, ?, 0, ?, 'Pending')", [request.insertId, itemId, quantity, price]);
  await updateRequestItemStatus(request.insertId, line.insertId, 'Approve', 'Tester', quantity);
  return { requestId: Number(request.insertId), requestItemId: Number(line.insertId) };
}

test('Inventory weighted average, approvals and the period report', async () => {
  await withTemporaryDatabase(async (connection) => {
    await connection.query("INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('Ayam', 'Raw Material', 'RM-901', 30000, 20000, 500), ('Beras', 'Raw Material', 'RM-902', 25000, 0, 0)");
    const [initial]: any = await connection.query('SELECT id FROM items ORDER BY id');
    const [ayam, beras] = initial.map((r: any) => r.id);
    const receive = (vendorCode: string, quantity: number, price: number) => registerIncomingGoods({
      vendorCode, vendorName: vendorCode, paymentMethod: 'Transfer', transactionDate: TODAY,
      items: [{ itemId: ayam, itemName: 'Ayam', quantity, price }],
    });
    const inventory = async () => {
      const [rows]: any = await connection.query('SELECT * FROM items WHERE id = ?', [ayam]);
      return rows[0];
    };
    await receive('A', 30, 20000);
    assert.equal(Number((await inventory()).avg_purchase_price), 20000);
    // Entered after the first transaction, i.e. inside the open period.
    await connection.query("INSERT INTO manual_finance_entries (account_code, entry_type, outlet_id, transaction_date, amount, description) VALUES ('OI', 'INCOME', NULL, ?, 4200, 'test other income')", [TODAY]);

    await receive('A', 40, 10000);
    assert.equal(Number((await inventory()).avg_purchase_price), 19298.245614);
    await receive('B', 20, 20000);
    let row = await inventory();
    assert.equal(Number(row.avg_purchase_price), 19322.033898);
    assert.equal(row.price, 30000);
    assert.equal(row.current_stock, 590);
    const [totals]: any = await connection.query('SELECT SUM(quantity) qty, SUM(quantity * price) value FROM purchase_items WHERE item_id = ?', [ayam]);
    assert.equal(Number(totals[0].qty), 90);
    assert.equal(Number(totals[0].value), 1400000);

    // Selling the whole stock fixes HPP at the current average; the next receipt starts a new average.
    const sellAll = await sell(connection, ayam, 590, 123, 'TEST-ALL');
    assert.equal(Number((await inventory()).current_stock), 0);
    await receive('B', 10, 20000);
    assert.equal(Number((await inventory()).avg_purchase_price), 20000);
    await registerHDReceiving({ transactionDate: TODAY, items: [
      { itemId: ayam, itemName: 'Ayam', vendorCode: 'A', vendorName: 'A', quantity: 10, price: 10000 },
      { itemName: ' ayam ', vendorCode: 'B', vendorName: 'B', quantity: 10, price: 20000 },
      { itemId: beras, itemName: 'Beras', vendorCode: 'B', vendorName: 'B', quantity: 5, price: 5000 },
    ] });
    assert.equal(Number((await inventory()).avg_purchase_price), 16666.666667);
    assert.equal(await recalculateItemAvgPurchasePrice(beras), 5000);
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: TODAY, items: [
      { itemId: ayam, itemName: 'Ayam', quantity: 10, price: 10000 },
      { itemId: ayam, itemName: 'Ayam', quantity: 10, price: 20000 },
    ] });
    assert.equal(Number((await inventory()).avg_purchase_price), 16000);

    const before = await inventory();
    const counts = async () => {
      const [rows]: any = await connection.query('SELECT (SELECT COUNT(*) FROM purchase_transactions) purchases, (SELECT COUNT(*) FROM purchase_items) purchase_lines, (SELECT COUNT(*) FROM stock_movements) movements');
      return rows[0];
    };
    const beforeCounts = await counts();
    const quiet = mock.method(console, 'error', () => {});
    for (const quantity of [0, -1, NaN, 1.5]) await assert.rejects(receive('A', quantity, 20000));
    await assert.rejects(receive('A', 10, -1));
    await assert.rejects(registerHDReceiving({ items: [
      { itemName: 'Ayam', quantity: 10, price: 10000 },
      { itemName: 'Beras', quantity: -1, price: 10000 },
    ] }));
    assert.deepEqual(await inventory(), before);
    // A failure after the purchase header has been inserted must roll back every write.
    await assert.rejects(registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: TODAY, items: [
      { itemId: ayam, itemName: 'Ayam', quantity: 10, price: 10000 },
      { itemName: 'x'.repeat(300), quantity: 1, price: 10000 },
    ] }));
    assert.deepEqual(await inventory(), before);
    assert.deepEqual(await counts(), beforeCounts);
    quiet.mock.restore();
    await syncAllItemAveragePrices();
    assert.equal(Number((await inventory()).avg_purchase_price), 16000);

    // Period report. Without a stock opname everything belongs to the open period.
    let periods = await getFinancePeriods();
    assert.deepEqual(periods.map((p) => p.id), ['running', 'all']);
    const report = await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: periods[0] });
    const ayamRow = itemRow(report, ayam);
    assert.equal(report.itemProfitability.length, 1);
    assert.equal(ayamRow.openingStock, 500);
    assert.equal(ayamRow.purchaseQuantity, 140);
    assert.equal(ayamRow.totalPurchaseAmount, 2200000);
    assert.equal(ayamRow.quantity, 590);
    assert.equal(ayamRow.closingStock, Number((await inventory()).current_stock));
    assert.equal(ayamRow.periodAverage, '16000.000000');
    assert.equal(ayamRow.catalogPrice, 30000);
    assert.equal(ayamRow.totalSellingAmount, 590 * 123);
    assert.equal(ayamRow.averageSellingPrice, 123);
    // HPP is the average at the moment of sale (19.322,03), not today's 16.000.
    assert.equal(ayamRow.totalCogsAmountExact, '11399999.999820');
    assert.equal(report.hasMissingCostData, false);
    assert.equal(report.otherIncome, 4200);
    assert.equal(report.totalIncomeReceived, null);
    assert.equal(report.hasMissingShrinkageData, true);
    assert.equal(report.contributionMargin, null);
    const berasReport = await getWarehouseDashboardStats({ itemIds: [beras], financePeriod: periods[0] });
    assert.equal(itemRow(berasReport, beras).purchaseQuantity, 5);
    assert.equal(berasReport.totalPurchaseAmount, 25000);
    assert.equal(berasReport.totalQuantity, 0);
    // A catalog change is reflected immediately without altering recorded sales.
    await connection.query('UPDATE items SET price = 35000 WHERE id = ?', [ayam]);
    const updatedCatalog = await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: periods[0] });
    assert.equal(itemRow(updatedCatalog, ayam).catalogPrice, 35000);
    assert.equal(updatedCatalog.totalSellingAmount, 590 * 123);

    // An approval stores its HPP once; a later receipt does not change it.
    const approval = await sell(connection, ayam, 3, 500, 'TEST-APPROVAL');
    await assert.rejects(updateRequestItemStatus(approval.requestId, approval.requestItemId, 'Approve'), /sudah diproses/);
    await assert.rejects(approveAllRequestItems(approval.requestId), /sudah diproses/);
    const [approvalCost]: any = await connection.query('SELECT unit_cost, cogs_amount FROM inventory_cost_snapshots WHERE request_item_id = ?', [approval.requestItemId]);
    assert.equal(Number(approvalCost[0].unit_cost), 16000);
    assert.equal(Number(approvalCost[0].cogs_amount), 48000);
    await receive('A', 10, 35000);
    const afterReceipt = itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: periods[0] }), ayam);
    assert.equal(afterReceipt.totalCogsAmountExact, '11447999.999820');
    assert.equal(afterReceipt.totalSellingAmount, 590 * 123 + 1500);
    const [allSale]: any = await connection.query('SELECT unit_cost_snapshot FROM request_items WHERE id = ?', [sellAll.requestItemId]);
    assert.equal(Number(allSale[0].unit_cost_snapshot), 19322.033898);

    const [partialRequest]: any = await connection.query("INSERT INTO requests (request_code, requester_name, request_date, status) VALUES ('TEST-PARTIAL', 'Outlet Test', ?, 'Pending')", [TODAY]);
    const [partialApprovedItem]: any = await connection.query("INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 5, 0, 500, 'Pending')", [partialRequest.insertId, ayam]);
    const [autoClosedItem]: any = await connection.query("INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 2, 0, 500, 'Pending')", [partialRequest.insertId, beras]);
    await updateRequestItemStatus(partialRequest.insertId, partialApprovedItem.insertId, 'Approve', 'Tester', 4);
    const partialDetail = await getRequestDetail(partialRequest.insertId);
    assert.equal(partialDetail.status, 'Partially Approved');
    assert.equal(partialDetail.items.find((item: any) => item.id === autoClosedItem.insertId).status, 'Rejected');
    await assert.rejects(updateRequestItemStatus(partialRequest.insertId, autoClosedItem.insertId, 'Approve'), /sudah diproses/);

    // Zero-cost receipts contribute quantity and never fall back to catalog selling price.
    await connection.query("INSERT INTO items (item_name, category, item_code, price, current_stock) VALUES ('Gratis', 'Support Material', 'SM-901', 90000, 0)");
    const [free]: any = await connection.query("SELECT id FROM items WHERE item_name = 'Gratis'");
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: TODAY, items: [
      { itemId: free[0].id, itemName: 'Gratis', quantity: 5, price: 0 },
    ] });
    const all = await getWarehouseDashboardStats();
    assert.equal(itemRow(all, free[0].id).avgPurchasePrice, 0);

    // A sale without a stored approval cost gets the replayed average of its moment.
    await connection.query("INSERT INTO items (item_name, category, item_code, price, current_stock) VALUES ('Legacy Cost', 'Raw Material', 'RM-903', 30000, 0)");
    const [legacy]: any = await connection.query("SELECT id FROM items WHERE item_code = 'RM-903'");
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: TODAY, items: [
      { itemId: legacy[0].id, itemName: 'Legacy Cost', quantity: 6, price: 12000 },
    ] });
    await connection.query('UPDATE purchase_items SET avg_cost_after = NULL WHERE item_id = ?', [legacy[0].id]);
    const [legacyRequest]: any = await connection.query("INSERT INTO requests (request_code, requester_name, payment_method, request_date, status, total_amount) VALUES ('TEST-LEGACY-COST', 'Outlet Test', 'Transfer', ?, 'Approved', 40000)", [TODAY]);
    await connection.query("INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 2, 2, 20000, 'Approved')", [legacyRequest.insertId, legacy[0].id]);
    const legacyRow = itemRow(await getWarehouseDashboardStats({ itemIds: [Number(legacy[0].id)] }), Number(legacy[0].id));
    assert.equal(legacyRow.avgPurchasePrice, 12000);
    assert.equal(legacyRow.totalCogsAmount, 24000);
    assert.equal(legacyRow.totalProfit, 16000);

    // Stock Opname closes the period: adjusts inventory atomically, keeps the
    // average until stock reaches zero, and locks the period's numbers.
    await connection.query("INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('Opname Test', 'Support Material', 'SM-902', 40000, 25000, 100)");
    const [opnameItem]: any = await connection.query("SELECT id FROM items WHERE item_code = 'SM-902'");
    const opnameItemId = Number(opnameItem[0].id);
    const makeOpname = async (physicalStock: number, submissionKey: string) => {
      const [ayamStock]: any = await connection.query('SELECT current_stock FROM items WHERE id = ?', [ayam]);
      return saveStockOpname({
        examinationDate: TODAY,
        createdBy: 'Warehouse Tester',
        createdByUserId: 9,
        submissionKey,
        physicalStocks: [
          { itemId: opnameItemId, physicalStock, notes: 'Hitung fisik' },
          { itemId: ayam, physicalStock: Number(ayamStock[0].current_stock), notes: 'Tetap sesuai' },
        ],
      });
    };
    const closedBefore = itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: periods[0] }), ayam);
    const down = await makeOpname(90, 'test-opname-down');
    periods = await getFinancePeriods();
    const closed = periods.find((period) => period.id === 'period-1')!;
    assert.equal(closed.status, 'Closed');
    assert.equal(closed.opnameId, down.id);
    assert.equal(closed.locked, true);
    assert.equal(closed.endDate, TODAY);
    const closedRow = itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: closed }), ayam);
    for (const key of ['quantity', 'purchaseQuantity', 'totalCogsAmountExact', 'totalSellingAmountExact', 'periodAverage']) assert.deepEqual(closedRow[key], closedBefore[key], key);
    assert.equal(closedRow.physicalStock, closedRow.systemStock);
    const [snapshotCount]: any = await connection.query('SELECT COUNT(*) AS n FROM finance_period_snapshots WHERE stock_opname_id = ?', [down.id]);
    assert.ok(Number(snapshotCount[0].n) > 0);
    // A sale after the cut-off belongs to the new period only.
    await sell(connection, ayam, 2, 500, 'TEST-AFTER-CUTOFF');
    const running = periods.find((period) => period.id === 'running')!;
    const runningRow = itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: running }), ayam);
    assert.equal(runningRow.quantity, 2);
    assert.equal(runningRow.openingStock, closedRow.closingStock);
    assert.deepEqual(itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: closed }), ayam), closedRow);

    assert.equal(down.items.find((line) => line.itemId === opnameItemId)?.difference, -10);
    let [opnameStock]: any = await connection.query('SELECT current_stock, avg_purchase_price FROM items WHERE id = ?', [opnameItemId]);
    assert.equal(Number(opnameStock[0].current_stock), 90);
    assert.equal(Number(opnameStock[0].avg_purchase_price), 25000);
    const [downMovement]: any = await connection.query("SELECT movement_type, quantity, stock_before, stock_after, unit_cost, adjustment_value, created_by_user_id FROM stock_movements WHERE reference_id = ?", [`SO-${down.id}`]);
    assert.equal(downMovement[0].movement_type, 'STOCK_OPNAME_ADJUSTMENT');
    assert.equal(Number(downMovement[0].quantity), -10);
    assert.equal(Number(downMovement[0].stock_before), 100);
    assert.equal(Number(downMovement[0].stock_after), 90);
    assert.equal(Number(downMovement[0].unit_cost), 25000);
    assert.equal(Number(downMovement[0].adjustment_value), -250000);
    assert.equal(Number(downMovement[0].created_by_user_id), 9);
    const ayamCutoffId = down.items.find((line) => line.itemId === ayam)?.cutoffPeriodId;
    const [closedPeriod]: any = await connection.query('SELECT status, difference FROM inventory_cost_periods WHERE id = ?', [ayamCutoffId]);
    assert.equal(closedPeriod[0].status, 'Closed');
    assert.equal(Number(closedPeriod[0].difference), 0);

    await connection.query('UPDATE items SET current_stock = 100, avg_purchase_price = 25000 WHERE id = ?', [opnameItemId]);
    const up = await makeOpname(110, 'test-opname-up');
    assert.equal(up.items.find((line) => line.itemId === opnameItemId)?.difference, 10);
    [opnameStock] = await connection.query('SELECT current_stock, avg_purchase_price FROM items WHERE id = ?', [opnameItemId]);
    assert.equal(Number(opnameStock[0].current_stock), 110);
    assert.equal(Number(opnameStock[0].avg_purchase_price), 25000);

    await connection.query('UPDATE items SET current_stock = 100, avg_purchase_price = 25000 WHERE id = ?', [opnameItemId]);
    const unchanged = await makeOpname(100, 'test-opname-same');
    assert.equal(unchanged.items.find((line) => line.itemId === opnameItemId)?.difference, 0);
    const [unchangedMovements]: any = await connection.query('SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = ?', [`SO-${unchanged.id}`]);
    assert.equal(Number(unchangedMovements[0].n), 0);

    await connection.query('UPDATE items SET current_stock = 100, avg_purchase_price = 25000 WHERE id = ?', [opnameItemId]);
    const zero = await makeOpname(0, 'test-opname-zero');
    const zeroLine = zero.items.find((line) => line.itemId === opnameItemId)!;
    assert.equal(zeroLine.adjustmentValue, -2500000);
    assert.equal(zeroLine.avgPurchasePriceBefore, 25000);
    assert.equal(zeroLine.avgPurchasePriceAfter, 0);
    [opnameStock] = await connection.query('SELECT current_stock, avg_purchase_price FROM items WHERE id = ?', [opnameItemId]);
    assert.equal(Number(opnameStock[0].current_stock), 0);
    assert.equal(Number(opnameStock[0].avg_purchase_price), 0);
    const retried = await makeOpname(0, 'test-opname-zero');
    assert.equal(retried.id, zero.id);
    const [zeroMovements]: any = await connection.query('SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = ?', [`SO-${zero.id}`]);
    assert.equal(Number(zeroMovements[0].n), 1);

    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: TODAY, items: [
      { itemId: opnameItemId, itemName: 'Opname Test', quantity: 10, price: 30000 },
    ] });
    [opnameStock] = await connection.query('SELECT current_stock, avg_purchase_price FROM items WHERE id = ?', [opnameItemId]);
    assert.equal(Number(opnameStock[0].current_stock), 10);
    assert.equal(Number(opnameStock[0].avg_purchase_price), 30000);

    await connection.query("INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('Weighted Mix', 'Support Material', 'SM-903', 40000, 25000, 5)");
    const [mixItem]: any = await connection.query("SELECT id FROM items WHERE item_code = 'SM-903'");
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: TODAY, items: [
      { itemId: Number(mixItem[0].id), itemName: 'Weighted Mix', quantity: 10, price: 30000 },
    ] });
    const [mixStock]: any = await connection.query('SELECT current_stock, avg_purchase_price FROM items WHERE id = ?', [mixItem[0].id]);
    assert.equal(Number(mixStock[0].current_stock), 15);
    assert.equal(Number(mixStock[0].avg_purchase_price), 28333.333333);
  });
});

test('Backdated transactions: closed periods refuse them, the open period is repriced', async () => {
  await withTemporaryDatabase(async (connection) => {
    await connection.query("INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('Ayam', 'Raw Material', 'RM-911', 15000, 0, 0)");
    const [[{ id: ayam }]]: any = await connection.query("SELECT id FROM items WHERE item_code = 'RM-911'");
    const receive = (date: string, quantity: number, price: number) => registerIncomingGoods({
      vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: date, items: [{ itemId: ayam, itemName: 'Ayam', quantity, price }],
    });
    const average = async () => Number((await connection.query('SELECT avg_purchase_price FROM items WHERE id = ?', [ayam]))[0][0].avg_purchase_price);

    // Period 1: a receipt five days ago, closed by an opname whose cut-off is three days ago.
    await receive(daysAgo(5), 10, 10000);
    const opname = await saveStockOpname({ examinationDate: TODAY, createdBy: 'Tester', physicalStocks: [{ itemId: ayam, physicalStock: 10 }] });
    const cutoff = noonOf(daysAgo(3));
    await connection.query('UPDATE inventory_cost_periods SET cutoff_at = FROM_UNIXTIME(?) WHERE stock_opname_id = ?', [cutoff / 1000, opname.id]);
    await connection.query('UPDATE stock_opnames SET created_at = FROM_UNIXTIME(?) WHERE id = ?', [cutoff / 1000, opname.id]);
    const closed = (await getFinancePeriods()).find((period) => period.status === 'Closed')!;
    assert.equal(closed.label, 'Periode 1');
    assert.equal(closed.endDate, daysAgo(3));
    const snapshots = async () => (await connection.query('SELECT * FROM finance_period_snapshots ORDER BY id'))[0].concat((await connection.query('SELECT * FROM finance_period_outlet_snapshots ORDER BY id'))[0]);
    const lockedRows = await snapshots();
    const closedReport = itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: closed }), ayam);
    assert.equal(closedReport.purchaseQuantity, 10);
    assert.equal(closedReport.closingStock, 10);

    // i. Nothing can be dated into the closed period.
    const quiet = mock.method(console, 'error', () => {});
    const closedMessage = (error: Error) => error.message === 'Periode 1 sudah ditutup. Gunakan form koreksi.';
    await assert.rejects(receive(daysAgo(4), 5, 9000), closedMessage);
    await assert.rejects(saveStockOpname({ examinationDate: daysAgo(4), createdBy: 'Tester', physicalStocks: [{ itemId: ayam, physicalStock: 10 }] }), closedMessage);
    await assert.rejects(assertOpenPeriodDate(db, daysAgo(4)), closedMessage); // request date, see createRequest
    await assertOpenPeriodDate(db, daysAgo(2));
    await assertOpenPeriodDate(db, TODAY);
    quiet.mock.restore();
    const [[{ n: purchaseCount }]]: any = await connection.query('SELECT COUNT(*) AS n FROM purchase_items');
    assert.equal(Number(purchaseCount), 1);

    // ii. Today's sale takes the current average (10.000). A receipt backdated to
    // two days ago, inside the open period, comes before it and reprices it.
    const sale = await sell(connection, ayam, 4, 15000, 'TEST-SALE');
    const cost = async () => (await connection.query('SELECT ri.unit_cost_snapshot, s.cogs_amount, s.profit_amount, s.source FROM request_items ri JOIN inventory_cost_snapshots s ON s.request_item_id = ri.id WHERE ri.id = ?', [sale.requestItemId]))[0][0];
    assert.equal(Number((await cost()).unit_cost_snapshot), 10000);
    await receive(daysAgo(2), 10, 20000);
    const repriced = await cost();
    assert.equal(Number(repriced.unit_cost_snapshot), 15000);
    assert.equal(Number(repriced.cogs_amount), 60000);
    assert.equal(Number(repriced.profit_amount), 0);
    assert.equal(repriced.source, 'SALE_APPROVAL');
    assert.equal(await average(), 15000); // not 16.250 from appending the receipt after the sale
    const [[backdated]]: any = await connection.query('SELECT avg_cost_after FROM purchase_items ORDER BY id DESC LIMIT 1');
    assert.equal(Number(backdated.avg_cost_after), 15000);
    const running = (await getFinancePeriods()).find((period) => period.id === 'running')!;
    const runningRow = itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: running }), ayam);
    assert.equal(runningRow.totalCogsAmountExact, '60000.000000');
    assert.equal(runningRow.openingStock, 10);
    assert.equal(runningRow.closingStock, 16);

    // iii. The closed period is untouched.
    assert.deepEqual(await snapshots(), lockedRows);
    assert.deepEqual(itemRow(await getWarehouseDashboardStats({ itemIds: [ayam], financePeriod: closed }), ayam), closedReport);
  });
});
