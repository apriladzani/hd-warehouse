-- DC/DA TRANSACTION STORAGE PROPOSAL — REVIEW ONLY, DO NOT EXECUTE.
-- Target proposed: hd_warehouse, but no USE statement or automatic runner.
-- finance_audit_logs is required for atomic lifecycle audit; not optional.
-- Requires explicit database-owner approval, FK/type/index/collation review,
-- dedicated narrowly scoped writer design, backup and deployment plan.
-- No INSERT/account seed included. Existing manifest must be approved separately.
-- Never grant write privileges to finance_reader; its SELECT-only guard remains.
-- REVIEW ONLY. NOT EXECUTED. No automatic startup hook, seed or data backfill.
-- Verify actual schema/FK types, MySQL >= 8.0.16 CHECK enforcement and backup
-- before separately authorizing execution. DDL is not transactionally rollbackable.
-- Existing tables including manual_finance_entries remain unchanged.
CREATE TABLE finance_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  classification ENUM('OI','SH','DC','DA') NOT NULL,
  metric_group ENUM('OI','SH','LC','UC','MC','TC','AC','LP','TX','DA01','DA02') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK ((classification = 'OI' AND metric_group = 'OI') OR
    (classification = 'SH' AND metric_group = 'SH') OR
    (classification = 'DC' AND metric_group IN ('LC','UC','MC','TC','AC','LP','TX')) OR
    (classification = 'DA' AND metric_group IN ('DA01','DA02')))
) ENGINE=InnoDB;

CREATE TABLE finance_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  unit_type ENUM('WAREHOUSE','OUTLET') NOT NULL,
  outlet_id INT NULL,
  transaction_date DATE NOT NULL,
  amount DECIMAL(24,6) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  notes VARCHAR(500) NOT NULL,
  evidence_reference VARCHAR(255) NOT NULL,
  status ENUM('draft','posted','void') NOT NULL DEFAULT 'draft',
  nature ENUM('INTERNAL','EXTERNAL') NOT NULL,
  counterparty_unit_type ENUM('WAREHOUSE','OUTLET') NULL,
  counterparty_outlet_id INT NULL,
  source_system VARCHAR(50) NOT NULL DEFAULT 'FINANCE',
  source_type VARCHAR(50) NULL,
  source_id VARCHAR(100) NULL,
  source_line_id VARCHAR(100) NULL,
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  -- Only one owner for a legacy record, including a void owner. A replacement
  -- points to the prior owner and retains the same ownership through policy.
  legacy_entry_id BIGINT NULL UNIQUE,
  replaces_id BIGINT UNSIGNED NULL UNIQUE,
  version INT NOT NULL DEFAULT 1,
  created_by INT NOT NULL,
  updated_by INT NOT NULL,
  posted_by INT NULL,
  voided_by INT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  posted_at TIMESTAMP(3) NULL,
  voided_at TIMESTAMP(3) NULL,
  void_reason VARCHAR(500) NULL,
  FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE RESTRICT,
  FOREIGN KEY (counterparty_outlet_id) REFERENCES outlets(id) ON DELETE RESTRICT,
  FOREIGN KEY (replaces_id) REFERENCES finance_transactions(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (amount > 0), CHECK (currency = 'IDR'), CHECK (version > 0),
  CHECK ((unit_type = 'WAREHOUSE' AND outlet_id IS NULL) OR (unit_type = 'OUTLET' AND outlet_id IS NOT NULL)),
  CHECK (nature = 'EXTERNAL' OR counterparty_unit_type IS NOT NULL),
  CHECK ((counterparty_unit_type IS NULL AND counterparty_outlet_id IS NULL) OR
    (counterparty_unit_type IS NOT NULL AND ((counterparty_unit_type = 'WAREHOUSE' AND counterparty_outlet_id IS NULL) OR
    (counterparty_unit_type = 'OUTLET' AND counterparty_outlet_id IS NOT NULL)))),
  CHECK (status <> 'posted' OR (posted_at IS NOT NULL AND posted_by IS NOT NULL)),
  CHECK (status <> 'void' OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)),
  INDEX idx_finance_transactions_unit_date (unit_type, outlet_id, transaction_date, status),
  INDEX idx_finance_transactions_account_date (account_id, transaction_date)
) ENGINE=InnoDB;

CREATE TABLE finance_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('account','transaction','outlet_mapping') NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  actor_id INT NOT NULL,
  occurred_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  before_state JSON NULL,
  after_state JSON NULL,
  reason VARCHAR(500) NOT NULL,
  correlation_id VARCHAR(100) NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_finance_audit_entity (entity_type, entity_id, occurred_at)
  -- Append-only privileges must be configured separately. Mutation and audit
  -- insert must commit atomically before write endpoints can be enabled.
) ENGINE=InnoDB;
