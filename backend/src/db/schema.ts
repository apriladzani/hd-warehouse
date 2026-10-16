import { relations } from 'drizzle-orm';
import { decimal, int, longtext, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  uid: varchar('uid', { length: 255 }).unique(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }),
  role: varchar('role', { length: 50 }).notNull().default('OUTLET'), // 'OUTLET' | 'WAREHOUSE'
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
  avgPurchasePrice: decimal('avg_purchase_price', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
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
  avgCostAfter: int('avg_cost_after'),
});

export const requests = mysqlTable('requests', {
  id: int('id').autoincrement().primaryKey(),
  requestCode: varchar('request_code', { length: 100 }).notNull().unique(),
  userId: int('user_id').references(() => users.id),
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
});

export const stockMovements = mysqlTable('stock_movements', {
  id: int('id').autoincrement().primaryKey(),
  itemId: int('item_id').references(() => items.id).notNull(),
  movementType: varchar('movement_type', { length: 20 }).notNull(), // 'IN' | 'OUT'
  quantity: int('quantity').notNull(),
  referenceId: varchar('reference_id', { length: 100 }).notNull(),
  createdBy: varchar('created_by', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const stockOpnames = mysqlTable('stock_opnames', {
  id: int('id').autoincrement().primaryKey(),
  examinationDate: varchar('examination_date', { length: 10 }).notNull(),
  notes: longtext('notes'),
  createdBy: varchar('created_by', { length: 255 }).notNull().default('Warehouse'),
  itemsJson: longtext('items_json').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  requests: many(requests),
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
