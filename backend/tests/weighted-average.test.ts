import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createPool } from '../src/db/index.ts';
import { registerIncomingGoods, registerHDReceiving, recalculateItemAvgPurchasePrice, syncAllItemAveragePrices, getWarehouseDashboardStats, getFinancePeriods, getIncomingHistory, getOutgoingHistory, getRequestDetail, updateRequestItemStatus, approveAllRequestItems, saveStockOpname } from '../src/db/repository.ts';

// Run explicitly against a configured MySQL connection. All writes use connection-local
// temporary tables that shadow production tables and disappear when the connection closes.
test('Inventory weighted average across vendors, dates, repeated lines, and stock changes', async () => {
  const pool = createPool();
  const connection = await pool.getConnection();
    const tables = ['users', 'vendors', 'items', 'item_vendors', 'purchase_transactions', 'purchase_items', 'stock_movements', 'stock_opnames', 'requests', 'request_items', 'manual_finance_entries'];
  try {
    for (const table of tables) {
      const [definition]: any = await connection.query(`SHOW CREATE TABLE ${table}`);
      const ddl = definition[0]['Create Table'].replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
        .split('\n').filter((line: string) => !line.trimStart().startsWith('CONSTRAINT')).join('\n')
        .replace(/,\n\)/g, '\n)');
      await connection.query(ddl);
    }
    await connection.query(`CREATE TEMPORARY TABLE inventory_cost_periods (
      id INT AUTO_INCREMENT PRIMARY KEY, stock_opname_id INT NOT NULL, item_id INT NOT NULL,
      cutoff_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), system_stock INT NOT NULL,
      physical_stock INT NOT NULL, difference INT NOT NULL, avg_cost_before DECIMAL(18,6) NOT NULL,
      avg_cost_after DECIMAL(18,6) NOT NULL, inventory_value_after DECIMAL(18,6) NOT NULL,
      adjustment_value DECIMAL(18,6) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'Closed',
      performed_by_user_id INT NULL, performed_by VARCHAR(255) NOT NULL, notes LONGTEXT NULL,
      UNIQUE KEY uq_inventory_cost_period_opname_item (stock_opname_id, item_id),
      INDEX idx_inventory_cost_period_item_cutoff (item_id, cutoff_at)
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TEMPORARY TABLE inventory_cost_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY, request_item_id INT NOT NULL, item_id INT NOT NULL,
      cutoff_period_id INT NULL, approved_quantity INT NOT NULL, unit_cost DECIMAL(18,6) NULL,
      sales_amount DECIMAL(18,6) NOT NULL, cogs_amount DECIMAL(18,6) NULL,
      profit_amount DECIMAL(18,6) NULL, source VARCHAR(32) NOT NULL,
      snapshot_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_inventory_cost_snapshot_request_item (request_item_id),
      INDEX idx_inventory_cost_snapshot_item (item_id), INDEX idx_inventory_cost_snapshot_cutoff (cutoff_period_id)
    ) ENGINE=InnoDB`);
    await connection.query('ALTER TABLE items MODIFY avg_purchase_price DECIMAL(18,6) NOT NULL DEFAULT 0');
    await connection.query('ALTER TABLE stock_movements MODIFY movement_type VARCHAR(40) NOT NULL');
    mock.method(pool, 'query', connection.query.bind(connection));
    mock.method(pool, 'getConnection', async () => connection);
    mock.method(connection, 'release', () => {});
    await connection.query("INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('Ayam', 'Raw Material', 'RM-901', 30000, 20000, 500), ('Beras', 'Raw Material', 'RM-902', 25000, 0, 0)");
    const [initial]: any = await connection.query('SELECT id FROM items ORDER BY id');
    const [ayam, beras] = initial.map((r: any) => r.id);
    await connection.query("INSERT INTO manual_finance_entries (account_code, entry_type, outlet_id, transaction_date, amount, description) VALUES ('OI', 'INCOME', NULL, '2026-10-15', 4200, 'test other income')");
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
    assert.equal(Number((await inventory()).avg_purchase_price), 19298.245614);
    await receive('B', '2026-09-01', 20, 20000);
    let row = await inventory();
    assert.equal(Number(row.avg_purchase_price), 19322.033898);
    assert.equal(row.price, 30000);
    assert.equal(row.current_stock, 590);
    const [totals]: any = await connection.query('SELECT SUM(quantity) qty, SUM(quantity * price) value FROM purchase_items WHERE item_id = ?', [ayam]);
    assert.equal(Number(totals[0].qty), 90);
    assert.equal(Number(totals[0].value), 1400000);
    await connection.query('UPDATE items SET current_stock = 0 WHERE id = ?', [ayam]);
    await receive('B', '2026-10-15', 10, 20000);
    assert.equal(Number((await inventory()).avg_purchase_price), 20000);
    await registerHDReceiving({ transactionDate: '2026-10-15', items: [
      { itemId: ayam, itemName: 'Ayam', vendorCode: 'A', vendorName: 'A', quantity: 10, price: 10000 },
      { itemName: ' ayam ', vendorCode: 'B', vendorName: 'B', quantity: 10, price: 20000 },
      { itemId: beras, itemName: 'Beras', vendorCode: 'B', vendorName: 'B', quantity: 5, price: 5000 },
    ] });
    assert.equal(Number((await inventory()).avg_purchase_price), 16666.666667);
    assert.equal(await recalculateItemAvgPurchasePrice(beras), 5000);
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-15', items: [
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
    await syncAllItemAveragePrices();
    assert.equal(Number((await inventory()).avg_purchase_price), 16000);
    const dashboard = await getWarehouseDashboardStats('2026-10-15', '2026-10-15');
    assert.equal(dashboard.itemProfitability.find((i) => i.itemId === ayam)?.avgPurchasePrice, 16000);
    // Dashboard purchases use receiving quantities and original prices, independently of sales.
    const ayamPurchases = dashboard.itemProfitability.find((i) => i.itemId === ayam)!;
    assert.equal(ayamPurchases.purchaseQuantity, 50);
    assert.equal(ayamPurchases.totalPurchaseAmount, 800000);
    assert.equal(ayamPurchases.quantity, 0);
    assert.equal(ayamPurchases.totalSellingAmount, 0);
    const [recipient]: any = await connection.query(
      "INSERT INTO users (name, username, email, password, role) VALUES ('Recipient', 'test-recipient', 'test-recipient@example.test', 'unused', 'OUTLET')"
    );
    const [request]: any = await connection.query(
      "INSERT INTO requests (request_code, user_id, requester_name, request_date, status) VALUES ('TEST-OUTLET', ?, 'Outlet', '2026-10-15', 'Partially Approved')",
      [recipient.insertId]
    );
    for (const [status, requested, approved] of [['Approved', 9, 7], ['Pending', 99, 99], ['Rejected', 10, 10], ['Approved', 2, 0]]) {
      await connection.query('INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, ?, ?, ?, ?)',
        [request.insertId, ayam, requested, approved, 123, status]);
    }
    // User removal detaches the optional identity reference but keeps the sale line.
    await connection.query('UPDATE requests SET user_id = NULL WHERE id = ?', [request.insertId]);
    await connection.query('DELETE FROM users WHERE id = ?', [recipient.insertId]);
    const [oldRequest]: any = await connection.query(
      "INSERT INTO requests (request_code, requester_name, request_date, status) VALUES ('TEST-OLD', 'Outlet', '2026-09-01', 'Approved')"
    );
    await connection.query("INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 3, 3, 123, 'Approved')", [oldRequest.insertId, ayam]);
    const filtered = await getWarehouseDashboardStats('2026-10-15', '2026-10-15', [ayam]);
    assert.equal(filtered.itemProfitability.length, 1);
    const sale = filtered.itemProfitability[0];
    assert.equal(sale.itemId, ayam);
    assert.equal(sale.itemName, 'Ayam');
    assert.equal(sale.quantity, 7);
    assert.equal(sale.catalogPrice, 30000);
    assert.equal(sale.totalSellingAmount, 861);
    assert.equal(sale.averageSellingPrice, 123);
    assert.equal(sale.purchaseQuantity, 50);
    assert.equal(sale.totalPurchaseAmount, 800000);
    assert.equal(sale.avgPurchasePrice, 16000);
    assert.equal(filtered.totalPurchaseAmount, 800000);
    assert.equal(filtered.hasMissingCostData, false);
    assert.equal(filtered.missingCostQuantity, 0);
    assert.equal(sale.totalCogsAmount, 112000);
    assert.equal(sale.totalProfit, -111139);
    assert.equal(filtered.totalProfit, -111139);
    const warehouseIncoming = await getIncomingHistory('2026-10-15', '2026-10-15');
    const warehouseIncomingAyam = warehouseIncoming.flatMap((tx: any) => tx.items || [])
      .filter((line: any) => line.itemId === ayam && Number(line.quantity) > 0 && Number(line.price) >= 0)
      .reduce((sum: number, line: any) => sum + Number(line.quantity), 0);
    assert.equal(warehouseIncomingAyam, sale.purchaseQuantity);
    const warehouseOutgoing = await getOutgoingHistory('2026-10-15', '2026-10-15');
    const warehouseOutgoingAyam = warehouseOutgoing.flatMap((tx: any) => tx.items || [])
      .filter((line: any) => line.itemId === ayam && line.status === 'Approved' && Number(line.approvedQuantity) > 0)
      .reduce((sum: number, line: any) => sum + Number(line.approvedQuantity), 0);
    assert.equal(warehouseOutgoingAyam, sale.quantity);
    assert.equal(filtered.totalIncomeReceived, null);
    assert.equal(filtered.otherIncome, 4200);
    assert.equal(filtered.manualEntries.length, 1);
    assert.equal(filtered.hasMissingShrinkageData, true);
    assert.equal(filtered.contributionMargin, null);
    assert.equal(filtered.contributionIncome, null);
    const allDates = await getWarehouseDashboardStats(undefined, undefined, [ayam]);
    assert.equal(allDates.itemProfitability[0].purchaseQuantity, 140);
    assert.equal(allDates.totalPurchaseAmount, 2200000);
    assert.equal(allDates.totalQuantity, 10);
    // Both transaction dates are inclusive; a receiving-only item remains visible.
    const september = await getWarehouseDashboardStats('2026-09-01', '2026-09-01', [ayam]);
    assert.equal(september.itemProfitability[0].purchaseQuantity, 20);
    assert.equal(september.totalPurchaseAmount, 400000);
    assert.equal(september.totalQuantity, 3);
    const berasOnly = await getWarehouseDashboardStats('2026-10-15', '2026-10-15', [beras]);
    assert.equal(berasOnly.itemProfitability[0].purchaseQuantity, 5);
    assert.equal(berasOnly.totalPurchaseAmount, 25000);
    assert.equal(berasOnly.totalQuantity, 0);
    const emptyPeriod = await getWarehouseDashboardStats('2000-01-01', '2000-01-02', [ayam]);
    assert.equal(emptyPeriod.totalPurchaseAmount, 0);
    assert.equal(emptyPeriod.totalSellingAmount, 0);
    assert.equal(emptyPeriod.itemProfitability[0].avgPurchasePrice, 16000);
    // A catalog change is reflected immediately without altering receiving totals.
    await connection.query('UPDATE items SET price = 35000 WHERE id = ?', [ayam]);
    const updatedCatalog = await getWarehouseDashboardStats('2026-10-15', '2026-10-15', [ayam]);
    assert.equal(updatedCatalog.itemProfitability[0].catalogPrice, 35000);
    assert.equal(updatedCatalog.totalSellingAmount, 861);
    assert.equal(updatedCatalog.totalPurchaseAmount, 800000);
    const [approvalRequest]: any = await connection.query(
      "INSERT INTO requests (request_code, requester_name, payment_method, request_date, status, total_amount) VALUES ('TEST-APPROVAL', 'Outlet Test', 'Transfer', '2026-10-16', 'Pending', 1500)"
    );
    const [approvalItem]: any = await connection.query(
      "INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 3, 0, 500, 'Pending')",
      [approvalRequest.insertId, ayam]
    );
    const stockBeforeApproval = Number((await inventory()).current_stock);
    await updateRequestItemStatus(approvalRequest.insertId, approvalItem.insertId, 'Approve');
    await assert.rejects(updateRequestItemStatus(approvalRequest.insertId, approvalItem.insertId, 'Approve'), /sudah diproses/);
    await assert.rejects(approveAllRequestItems(approvalRequest.insertId), /sudah diproses/);
    assert.equal(Number((await inventory()).current_stock), stockBeforeApproval - 3);
    const approvedSales = await getWarehouseDashboardStats('2026-10-16', '2026-10-16', [ayam]);
    assert.equal(approvedSales.totalSellingAmount, 1500);
    assert.equal(approvedSales.totalQuantity, 3);
    assert.equal(approvedSales.hasMissingCostData, false);
    assert.equal(approvedSales.totalCogsAmount, 3 * Number((await inventory()).avg_purchase_price));
    const approvedCostSnapshot = approvedSales.totalCogsAmount;
    const [approvalCostSnapshot]: any = await connection.query('SELECT unit_cost, cogs_amount, profit_amount FROM inventory_cost_snapshots WHERE request_item_id = ?', [approvalItem.insertId]);
    assert.equal(Number(approvalCostSnapshot[0].cogs_amount), approvedCostSnapshot);
    await receive('A', '2026-10-17', 10, 35000);
    const historicalSalesAfterReceipt = await getWarehouseDashboardStats('2026-10-16', '2026-10-16', [ayam]);
    assert.equal(historicalSalesAfterReceipt.totalCogsAmount, approvedCostSnapshot);
    assert.equal(historicalSalesAfterReceipt.totalProfit, historicalSalesAfterReceipt.totalSellingAmount - approvedCostSnapshot);
    const [partialRequest]: any = await connection.query(
      "INSERT INTO requests (request_code, requester_name, request_date, status) VALUES ('TEST-PARTIAL', 'Outlet Test', '2026-10-17', 'Pending')"
    );
    const [partialApprovedItem]: any = await connection.query(
      "INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 5, 0, 500, 'Pending')",
      [partialRequest.insertId, ayam]
    );
    const [autoClosedItem]: any = await connection.query(
      "INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 2, 0, 500, 'Pending')",
      [partialRequest.insertId, beras]
    );
    await updateRequestItemStatus(partialRequest.insertId, partialApprovedItem.insertId, 'Approve', 'Tester', 4);
    const partialDetail = await getRequestDetail(partialRequest.insertId);
    assert.equal(partialDetail.status, 'Partially Approved');
    assert.equal(partialDetail.items.find((item: any) => item.id === autoClosedItem.insertId).status, 'Rejected');
    await assert.rejects(updateRequestItemStatus(partialRequest.insertId, autoClosedItem.insertId, 'Approve'), /sudah diproses/);
    // Zero-cost receipts contribute quantity and never fall back to catalog selling price.
    await connection.query("INSERT INTO items (item_name, category, item_code, price, current_stock) VALUES ('Gratis', 'Support Material', 'SM-901', 90000, 0)");
    const [free]: any = await connection.query("SELECT id FROM items WHERE item_name = 'Gratis'");
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-15', items: [
      { itemId: free[0].id, itemName: 'Gratis', quantity: 5, price: 0 },
    ] });
    const result = await getWarehouseDashboardStats();
    assert.equal(result.itemProfitability.find((i) => i.itemId === free[0].id)?.avgPurchasePrice, 0);

    // Legacy receipts can be missing avg_cost_after even when their purchase
    // price is recorded. Finance should rebuild a dated cost from the receipt.
    await connection.query("INSERT INTO items (item_name, category, item_code, price, current_stock) VALUES ('Legacy Cost', 'Raw Material', 'RM-903', 30000, 0)");
    const [legacy]: any = await connection.query("SELECT id FROM items WHERE item_code = 'RM-903'");
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-18', items: [
      { itemId: legacy[0].id, itemName: 'Legacy Cost', quantity: 6, price: 12000 },
    ] });
    await connection.query('UPDATE purchase_items SET avg_cost_after = NULL WHERE item_id = ?', [legacy[0].id]);
    const [legacyRequest]: any = await connection.query(
      "INSERT INTO requests (request_code, requester_name, payment_method, request_date, status, total_amount) VALUES ('TEST-LEGACY-COST', 'Outlet Test', 'Transfer', '2026-10-19', 'Approved', 40000)"
    );
    await connection.query(
      "INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 2, 2, 20000, 'Approved')",
      [legacyRequest.insertId, legacy[0].id]
    );
    const legacyFinance = await getWarehouseDashboardStats('2026-10-18', '2026-10-19', [Number(legacy[0].id)]);
    assert.equal(legacyFinance.itemProfitability[0].avgPurchasePrice, 12000);
    assert.equal(legacyFinance.itemProfitability[0].totalCogsAmount, 24000);
    assert.equal(legacyFinance.itemProfitability[0].totalProfit, 16000);

    // Stock Opname adjusts inventory atomically while preserving the active WAC
    // until stock reaches zero. Retrying the same submission key is idempotent.
    await connection.query("INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('Opname Test', 'Support Material', 'SM-902', 40000, 25000, 100)");
    const [opnameItem]: any = await connection.query("SELECT id FROM items WHERE item_code = 'SM-902'");
    const opnameItemId = Number(opnameItem[0].id);
    const makeOpname = async (physicalStock: number, submissionKey: string) => {
      const [ayamStock]: any = await connection.query('SELECT current_stock FROM items WHERE id = ?', [ayam]);
      return saveStockOpname({
        examinationDate: '2026-10-22',
        createdBy: 'Warehouse Tester',
        createdByUserId: 9,
        submissionKey,
        physicalStocks: [
          { itemId: opnameItemId, physicalStock, notes: 'Hitung fisik' },
          { itemId: ayam, physicalStock: Number(ayamStock[0].current_stock), notes: 'Tetap sesuai' },
        ],
      });
    };
    const down = await makeOpname(90, 'test-opname-down');
    await connection.query("UPDATE purchase_transactions SET created_at = '2026-10-21 12:00:00'");
    await connection.query("UPDATE requests SET created_at = '2026-10-21 12:00:00'");
    await connection.query("UPDATE inventory_cost_periods SET cutoff_at = '2026-10-22 12:00:00.000' WHERE stock_opname_id = ?", [down.id]);
    const financePeriods = await getFinancePeriods();
    const closedFinancePeriod = financePeriods.find((period) => period.id === 'period-1');
    const runningFinancePeriod = financePeriods.find((period) => period.id === 'running');
    assert.equal(closedFinancePeriod?.status, 'Closed');
    assert.equal(closedFinancePeriod?.endDate, '2026-10-22');
    const financeBeforeCutoff = await getWarehouseDashboardStats(undefined, undefined, [ayam], undefined, undefined, undefined, closedFinancePeriod);
    const [expectedClosedFinance]: any = await connection.query("SELECT COALESCE(SUM(ri.approved_quantity), 0) AS quantity, COALESCE(SUM(ri.approved_quantity * ri.price), 0) AS amount FROM request_items ri JOIN requests r ON r.id = ri.request_id WHERE ri.item_id = ? AND ri.status = 'Approved' AND r.created_at < '2026-10-22 12:00:00.000'", [ayam]);
    assert.equal(financeBeforeCutoff.totalQuantity, Number(expectedClosedFinance[0].quantity));
    assert.equal(financeBeforeCutoff.totalSellingAmount, Number(expectedClosedFinance[0].amount));
    const [postCutoffRequest]: any = await connection.query(
      "INSERT INTO requests (request_code, requester_name, payment_method, request_date, status, total_amount) VALUES ('TEST-AFTER-CUTOFF', 'Outlet Test', 'Transfer', '2026-10-23', 'Pending', 1000)"
    );
    const [postCutoffItem]: any = await connection.query(
      "INSERT INTO request_items (request_id, item_id, requested_quantity, approved_quantity, price, status) VALUES (?, ?, 2, 0, 500, 'Pending')",
      [postCutoffRequest.insertId, ayam]
    );
    await updateRequestItemStatus(postCutoffRequest.insertId, postCutoffItem.insertId, 'Approve', 'Tester', 2);
    const financeAfterCutoff = await getWarehouseDashboardStats(undefined, undefined, [ayam], undefined, undefined, undefined, runningFinancePeriod);
    const [expectedRunningFinance]: any = await connection.query("SELECT COALESCE(SUM(ri.approved_quantity), 0) AS quantity, COALESCE(SUM(ri.approved_quantity * ri.price), 0) AS amount FROM request_items ri JOIN requests r ON r.id = ri.request_id WHERE ri.item_id = ? AND ri.status = 'Approved' AND r.created_at >= '2026-10-22 12:00:00.000'", [ayam]);
    assert.equal(financeAfterCutoff.totalQuantity, Number(expectedRunningFinance[0].quantity));
    assert.equal(financeAfterCutoff.totalSellingAmount, Number(expectedRunningFinance[0].amount));
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
    const [linkedSnapshot]: any = await connection.query('SELECT cutoff_period_id FROM inventory_cost_snapshots WHERE request_item_id = ?', [approvalItem.insertId]);
    assert.equal(Number(linkedSnapshot[0].cutoff_period_id), Number(ayamCutoffId));
    const [closedPeriod]: any = await connection.query('SELECT status, system_stock, physical_stock, difference, avg_cost_before, inventory_value_after FROM inventory_cost_periods WHERE id = ?', [ayamCutoffId]);
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

    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-22', items: [
      { itemId: opnameItemId, itemName: 'Opname Test', quantity: 10, price: 30000 },
    ] });
    [opnameStock] = await connection.query('SELECT current_stock, avg_purchase_price FROM items WHERE id = ?', [opnameItemId]);
    assert.equal(Number(opnameStock[0].current_stock), 10);
    assert.equal(Number(opnameStock[0].avg_purchase_price), 30000);

    await connection.query("INSERT INTO items (item_name, category, item_code, price, avg_purchase_price, current_stock) VALUES ('Weighted Mix', 'Support Material', 'SM-903', 40000, 25000, 5)");
    const [mixItem]: any = await connection.query("SELECT id FROM items WHERE item_code = 'SM-903'");
    await registerIncomingGoods({ vendorCode: 'A', vendorName: 'A', paymentMethod: 'Transfer', transactionDate: '2026-10-22', items: [
      { itemId: Number(mixItem[0].id), itemName: 'Weighted Mix', quantity: 10, price: 30000 },
    ] });
    const [mixStock]: any = await connection.query('SELECT current_stock, avg_purchase_price FROM items WHERE id = ?', [mixItem[0].id]);
    assert.equal(Number(mixStock[0].current_stock), 15);
    assert.equal(Number(mixStock[0].avg_purchase_price), 28333.333333);
  } finally {
    mock.restoreAll();
    connection.destroy();
    await pool.end();
  }
});
