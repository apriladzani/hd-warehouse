import { sql, type SQL } from 'drizzle-orm';
import { pool } from './index.ts';

// A cancelled purchase (Barang Masuk entered by mistake) keeps its
// purchase_transactions and purchase_items rows; a row here marks it cancelled.
// Every reader that turns purchases into stock, cost or money filters with
// activePurchase(), so a cancelled purchase counts nowhere.
//
// The stock it brought in leaves through a PURCHASE_CANCEL movement: a positive
// quantity that takes stock OUT, the mirror of the IN movement of the receipt.
export const PURCHASE_CANCEL = 'PURCHASE_CANCEL';

export const PURCHASE_CANCELLATION_COLUMNS = `
      purchase_id INT NOT NULL PRIMARY KEY,
      transaction_code VARCHAR(100) NOT NULL,
      cancelled_by_user_id INT NULL,
      cancelled_by_name VARCHAR(255) NOT NULL,
      cancelled_by_role VARCHAR(50) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      removed_quantity INT NOT NULL DEFAULT 0,
      cancelled_amount BIGINT NOT NULL DEFAULT 0,
      cancelled_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_purchase_cancellations_at (cancelled_at)`;

let schemaReady: Promise<void> | null = null;
export async function ensurePurchaseCancellationSchema() {
  if (!schemaReady) schemaReady = (async () => {
    // Reach for the table first: CREATE TABLE IF NOT EXISTS would build a real
    // table beside a test's TEMPORARY one.
    try {
      await pool.query('SELECT 1 FROM purchase_cancellations LIMIT 0');
      return;
    } catch {
      // Not reachable yet, so create it.
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS purchase_cancellations (${PURCHASE_CANCELLATION_COLUMNS}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  })().catch((error) => { schemaReady = null; throw error; });
  await schemaReady;
}

// WHERE condition: the purchase with this id has not been cancelled.
export const activePurchase = (purchaseId: unknown): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM purchase_cancellations pc WHERE pc.purchase_id = ${purchaseId})`;

// How a stock movement changes stock: OUT and PURCHASE_CANCEL take stock out,
// every other kind is recorded with its own sign.
export const signedMovementQuantity = (kind: string, quantity: number) =>
  kind === 'OUT' || kind === PURCHASE_CANCEL ? -quantity : quantity;

export class PurchaseCancelError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) { super(message); }
}
