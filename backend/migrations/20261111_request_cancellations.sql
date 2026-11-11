-- Request cancellation history (2026-11-11).
-- The app creates this table on first use (ensureRequestCancellationSchema in
-- backend/src/db/repository.ts); this file documents it and lets a DBA create
-- it ahead of time. It only adds a table: no existing column changes.
--
-- Existing columns already cover the rest:
--   requests.status       VARCHAR(50)  gains the value 'Cancelled'
--   request_items.status  VARCHAR(50)  approved lines become 'Cancelled'
--                                      (approved_quantity is kept as history)
--   stock_movements       movement_type 'CANCEL_RETURN' records the stock that
--                                      came back, with who, when and why
CREATE TABLE IF NOT EXISTS request_cancellations (
  request_id INT NOT NULL PRIMARY KEY,
  cancelled_by_user_id INT NULL,
  cancelled_by_name VARCHAR(255) NOT NULL,
  cancelled_by_role VARCHAR(50) NOT NULL,
  reason VARCHAR(500) NULL,
  returned_quantity INT NOT NULL DEFAULT 0,
  cancelled_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_request_cancellations_at (cancelled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
