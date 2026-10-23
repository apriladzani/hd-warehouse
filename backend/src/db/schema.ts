import { relations } from 'drizzle-orm';
import { boolean, decimal, int, longtext, mysqlTable, timestamp, uniqueIndex, varchar, index } from 'drizzle-orm/mysql-core';

export const outlets = mysqlTable('outlets', {
  id: int('id').autoincrement().primaryKey(),
  outletCode: varchar('outlet_code', { length: 100 }).notNull().unique(),
  outletName: varchar('outlet_name', { length: 255 }).notNull().unique(),
  address: varchar('address', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  uid: varchar('uid', { length: 255 }).unique(),
  name: varchar('name', { length: 255 }).notNull(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }),
  role: varchar('role', { length: 50 }).notNull().default('OUTLET'),
  outletId: int('outlet_id').references(() => outlets.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const vendors = mysqlTable('vendors', {
  id: int('id').autoincrement().primaryKey(),
  vendorCode: varchar('vendor_code', { length: 100 }).notNull().unique(),
  vendorName: varchar('vendor_name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const items = mysqlTable('items', {
  id: int('id').autoincrement().primaryKey(),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  category: varchar('category', { length: 40 }).notNull(),
  itemCode: varchar('item_code', { length: 20 }).notNull(),
  price: int('price').notNull(),
  avgPurchasePrice: decimal('avg_purchase_price', { precision: 18, scale: 6, mode: 'number' }).notNull().default(0),
  currentStock: int('current_stock').notNull().default(0),
  vendorId: int('vendor_id').references(() => vendors.id),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [uniqueIndex('uq_items_item_code').on(table.itemCode)]);

export const itemVendors = mysqlTable('item_vendors', {
  id: int('id').autoincrement().primaryKey(),
  itemId: int('item_id').references(() => items.id, { onDelete: 'cascade' }).notNull(),
  vendorId: int('vendor_id').references(() => vendors.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const purchaseTransactions = mysqlTable('purchase_transactions', {
  id: int('id').autoincrement().primaryKey(),
  transactionCode: varchar('transaction_code', { length: 100 }).notNull().unique(),
  vendorId: int('vendor_id').references(() => vendors.id).notNull(),
  paymentMethod: varchar('payment_method', { length: 50 }).notNull().default('Transfer'),
  transactionDate: varchar('transaction_date', { length: 50 }).notNull(),
  totalAmount: int('total_amount').notNull().default(0),
  createdBy: varchar('created_by', { length: 100 }).notNull().default('Warehouse'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const purchaseItems = mysqlTable('purchase_items', {
  id: int('id').autoincrement().primaryKey(),
  purchaseId: int('purchase_id').references(() => purchaseTransactions.id).notNull(),
  itemId: int('item_id').references(() => items.id).notNull(),
  quantity: int('quantity').notNull(),
  price: int('price').notNull(),
  subtotal: int('subtotal').notNull(),
  avgCostAfter: decimal('avg_cost_after', { precision: 18, scale: 6, mode: 'number' }),
});

export const requests = mysqlTable('requests', {
  id: int('id').autoincrement().primaryKey(),
  requestCode: varchar('request_code', { length: 100 }).notNull().unique(),
  userId: int('user_id').references(() => users.id),
  outletId: int('outlet_id').references(() => outlets.id, { onDelete: 'set null' }),
  requesterName: varchar('requester_name', { length: 255 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 50 }).notNull().default('Transfer'),
  requestDate: varchar('request_date', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('Pending'), // 'Pending' | 'Partially Approved' | 'Approved' | 'Rejected'
  totalAmount: int('total_amount').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const requestItems = mysqlTable('request_items', {
  id: int('id').autoincrement().primaryKey(),
  requestId: int('request_id').references(() => requests.id).notNull(),
  itemId: int('item_id').references(() => items.id).notNull(),
  requestedQuantity: int('requested_quantity').notNull(),
  approvedQuantity: int('approved_quantity').notNull().default(0),
  price: int('price').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('Pending'), // 'Pending' | 'Approved' | 'Rejected'
  approvedBy: varchar('approved_by', { length: 100 }),
  approvedAt: varchar('approved_at', { length: 100 }),
  unitCostSnapshot: decimal('unit_cost_snapshot', { precision: 18, scale: 6, mode: 'number' }),
});

export const stockMovements = mysqlTable('stock_movements', {
  id: int('id').autoincrement().primaryKey(),
  itemId: int('item_id').references(() => items.id).notNull(),
  movementType: varchar('movement_type', { length: 40 }).notNull(), // 'IN' | 'OUT' | 'STOCK_OPNAME_ADJUSTMENT'
  quantity: int('quantity').notNull(),
  stockBefore: int('stock_before'),
  stockAfter: int('stock_after'),
  unitCost: decimal('unit_cost', { precision: 18, scale: 6, mode: 'number' }),
  adjustmentValue: decimal('adjustment_value', { precision: 18, scale: 6, mode: 'number' }),
  notes: longtext('notes'),
  createdByUserId: int('created_by_user_id'),
  referenceId: varchar('reference_id', { length: 100 }).notNull(),
  createdBy: varchar('created_by', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const stockOpnames = mysqlTable('stock_opnames', {
  id: int('id').autoincrement().primaryKey(),
  examinationDate: varchar('examination_date', { length: 10 }).notNull(),
  notes: longtext('notes'),
  createdBy: varchar('created_by', { length: 255 }).notNull().default('Warehouse'),
  createdByUserId: int('created_by_user_id'),
  submissionKey: varchar('submission_key', { length: 64 }),
  itemsJson: longtext('items_json').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [uniqueIndex('uq_stock_opnames_submission_key').on(table.submissionKey)]);

export const inventoryCostPeriods = mysqlTable('inventory_cost_periods', {
  id: int('id').autoincrement().primaryKey(),
  stockOpnameId: int('stock_opname_id').notNull(),
  itemId: int('item_id').notNull(),
  cutoffAt: timestamp('cutoff_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  systemStock: int('system_stock').notNull(),
  physicalStock: int('physical_stock').notNull(),
  difference: int('difference').notNull(),
  avgCostBefore: decimal('avg_cost_before', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  avgCostAfter: decimal('avg_cost_after', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  inventoryValueAfter: decimal('inventory_value_after', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  adjustmentValue: decimal('adjustment_value', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('Closed'),
  performedByUserId: int('performed_by_user_id'),
  performedBy: varchar('performed_by', { length: 255 }).notNull(),
  notes: longtext('notes'),
}, (table) => [
  uniqueIndex('uq_inventory_cost_period_opname_item').on(table.stockOpnameId, table.itemId),
  index('idx_inventory_cost_period_item_cutoff').on(table.itemId, table.cutoffAt),
]);

export const inventoryCostSnapshots = mysqlTable('inventory_cost_snapshots', {
  id: int('id').autoincrement().primaryKey(),
  requestItemId: int('request_item_id').notNull(),
  itemId: int('item_id').notNull(),
  cutoffPeriodId: int('cutoff_period_id'),
  approvedQuantity: int('approved_quantity').notNull(),
  unitCost: decimal('unit_cost', { precision: 18, scale: 6, mode: 'number' }),
  salesAmount: decimal('sales_amount', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  cogsAmount: decimal('cogs_amount', { precision: 18, scale: 6, mode: 'number' }),
  profitAmount: decimal('profit_amount', { precision: 18, scale: 6, mode: 'number' }),
  source: varchar('source', { length: 32 }).notNull(),
  snapshotAt: timestamp('snapshot_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_inventory_cost_snapshot_request_item').on(table.requestItemId),
  index('idx_inventory_cost_snapshot_item').on(table.itemId),
  index('idx_inventory_cost_snapshot_cutoff').on(table.cutoffPeriodId),
]);

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  requests: many(requests),
  outlet: one(outlets, { fields: [users.outletId], references: [outlets.id] }),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  items: many(items),
  purchases: many(purchaseTransactions),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [items.vendorId],
    references: [vendors.id],
  }),
  requestItems: many(requestItems),
  purchaseItems: many(purchaseItems),
  movements: many(stockMovements),
}));

export const purchaseTransactionsRelations = relations(purchaseTransactions, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [purchaseTransactions.vendorId],
    references: [vendors.id],
  }),
  items: many(purchaseItems),
}));

export const purchaseItemsRelations = relations(purchaseItems, ({ one }) => ({
  purchase: one(purchaseTransactions, {
    fields: [purchaseItems.purchaseId],
    references: [purchaseTransactions.id],
  }),
  item: one(items, {
    fields: [purchaseItems.itemId],
    references: [items.id],
  }),
}));

export const requestsRelations = relations(requests, ({ one, many }) => ({
  user: one(users, {
    fields: [requests.userId],
    references: [users.id],
  }),
  outlet: one(outlets, { fields: [requests.outletId], references: [outlets.id] }),
  items: many(requestItems),
}));

export const requestItemsRelations = relations(requestItems, ({ one }) => ({
  request: one(requests, {
    fields: [requestItems.requestId],
    references: [requests.id],
  }),
  item: one(items, {
    fields: [requestItems.itemId],
    references: [items.id],
  }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  item: one(items, {
    fields: [stockMovements.itemId],
    references: [items.id],
  }),
}));
