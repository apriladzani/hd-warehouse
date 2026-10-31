// Tables whose created_at orders transactions against stock opname cut-offs.
// Second precision is not enough: a transaction recorded in the same second as,
// but after, a cut-off would otherwise fall into the period that was just closed.
export const MILLISECOND_TIMESTAMP_TABLES = ['stock_movements', 'purchase_transactions', 'requests', 'stock_opnames', 'manual_finance_entries'] as const;
export const MILLISECOND_COLUMN_DEFINITION = 'TIMESTAMP(3) NULL DEFAULT CURRENT_TIMESTAMP(3)';
export const needsMillisecondPrecision = (columnType: string) => !/\(3\)/.test(columnType);
