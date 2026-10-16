
CREATE DATABASE IF NOT EXISTS `hd_warehouse`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `hd_warehouse`;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `stock_movements`;
DROP TABLE IF EXISTS `request_items`;
DROP TABLE IF EXISTS `requests`;
DROP TABLE IF EXISTS `purchase_items`;
DROP TABLE IF EXISTS `purchase_transactions`;
DROP TABLE IF EXISTS `items`;
DROP TABLE IF EXISTS `vendors`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `uid` VARCHAR(255) NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password` VARCHAR(255) NULL,
  `role` VARCHAR(50) NOT NULL DEFAULT 'USER', -- 'USER' | 'WAREHOUSE'
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `vendors` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `vendor_code` VARCHAR(100) NOT NULL UNIQUE,
  `vendor_name` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `item_name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(40) NOT NULL,
  `item_code` VARCHAR(20) NOT NULL,
  `price` INT NOT NULL,
  `avg_purchase_price` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `current_stock` INT NOT NULL DEFAULT 0,
  `vendor_id` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_items_item_code` (`item_code`),
  CONSTRAINT `fk_items_vendor` FOREIGN KEY (`vendor_id`) 
    REFERENCES `vendors` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `purchase_transactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `transaction_code` VARCHAR(100) NOT NULL UNIQUE,
  `vendor_id` INT NOT NULL,
  `payment_method` VARCHAR(50) NOT NULL DEFAULT 'Transfer',
  `transaction_date` VARCHAR(50) NOT NULL,
  `total_amount` INT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(100) NOT NULL DEFAULT 'Warehouse',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_purchase_vendor` FOREIGN KEY (`vendor_id`) 
    REFERENCES `vendors` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `purchase_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `purchase_id` INT NOT NULL,
  `item_id` INT NOT NULL,
  `quantity` INT NOT NULL,
  `price` INT NOT NULL,
  `subtotal` INT NOT NULL,
  `avg_cost_after` INT NULL,
  CONSTRAINT `fk_purchase_items_tx` FOREIGN KEY (`purchase_id`) 
    REFERENCES `purchase_transactions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_items_item` FOREIGN KEY (`item_id`) 
    REFERENCES `items` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `item_vendors` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `item_id` INT NOT NULL,
  `vendor_id` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_item_vendor` (`item_id`, `vendor_id`),
  CONSTRAINT `fk_iv_item` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_iv_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `request_code` VARCHAR(100) NOT NULL UNIQUE,
  `user_id` INT NULL,
  `requester_name` VARCHAR(255) NOT NULL,
  `payment_method` VARCHAR(50) NOT NULL DEFAULT 'Transfer',
  `request_date` VARCHAR(50) NOT NULL,
  `status` VARCHAR(50) NOT NULL DEFAULT 'Pending', -- 'Pending' | 'Partially Approved' | 'Approved' | 'Rejected'
  `total_amount` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_requests_user` FOREIGN KEY (`user_id`) 
    REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `request_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `request_id` INT NOT NULL,
  `item_id` INT NOT NULL,
  `requested_quantity` INT NOT NULL,
  `approved_quantity` INT NOT NULL DEFAULT 0,
  `price` INT NOT NULL,
  `status` VARCHAR(50) NOT NULL DEFAULT 'Pending', -- 'Pending' | 'Approved' | 'Rejected'
  `approved_by` VARCHAR(100) NULL,
  `approved_at` VARCHAR(100) NULL,
  CONSTRAINT `fk_request_items_req` FOREIGN KEY (`request_id`) 
    REFERENCES `requests` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_request_items_item` FOREIGN KEY (`item_id`) 
    REFERENCES `items` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_movements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `item_id` INT NOT NULL,
  `movement_type` VARCHAR(20) NOT NULL, -- 'IN' | 'OUT'
  `quantity` INT NOT NULL,
  `reference_id` VARCHAR(100) NOT NULL,
  `created_by` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_movements_item` FOREIGN KEY (`item_id`) 
    REFERENCES `items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_opnames` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `examination_date` VARCHAR(10) NOT NULL,
  `notes` LONGTEXT NULL,
  `created_by` VARCHAR(255) NOT NULL DEFAULT 'Warehouse',
  `items_json` LONGTEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `users` (`id`, `name`, `email`, `password`, `role`) VALUES
(1, 'Staff Gudang HD', 'warehouse@hd.com', 'warehouse123', 'WAREHOUSE'),
(2, 'April Adzania (User Outlet)', 'user@hd.com', 'user123', 'USER'),
(3, 'April Adzania', 'april.adzania@gmail.com', 'password123', 'USER')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `password`=VALUES(`password`), `role`=VALUES(`role`);

INSERT INTO `vendors` (`id`, `vendor_code`, `vendor_name`) VALUES
(1, 'VND-01', 'Supplier Unggas & Daging'),
(2, 'VND-02', 'Distributor Bahan Baku Sembako'),
(3, 'VND-03', 'Supplier Saus & Bumbu HD'),
(4, 'VND-04', 'Supplier Packaging & Plastik')
ON DUPLICATE KEY UPDATE `vendor_name`=VALUES(`vendor_name`);

INSERT INTO `items` (`id`, `item_name`, `category`, `item_code`, `price`, `current_stock`, `vendor_id`) VALUES
(1, 'Ayam Mentah (kg)', 'Raw Material', 'RM-001', 38000, 150, 1),
(2, 'Kulit mentah (kg)', 'Raw Material', 'RM-002', 28000, 80, 1),
(3, 'Kulit matang (pcs)', 'Raw Material', 'RM-003', 15000, 120, 1),
(4, 'Tepung (pcs)', 'Raw Material', 'RM-004', 18000, 200, 2),
(5, 'Beras (kg)', 'Raw Material', 'RM-005', 15500, 300, 2),
(6, 'Minyak (lt)', 'Support Material', 'SM-001', 17000, 250, 2),
(7, 'S.Pedas (pack/60)', 'Support Material', 'SM-002', 45000, 100, 3),
(8, 'S.Tomat (pack/60)', 'Support Material', 'SM-003', 42000, 90, 3),
(9, 'S.BBQ', 'Support Material', 'SM-004', 48000, 75, 3),
(10, 'S.Geprek (pack/10)', 'Support Material', 'SM-005', 35000, 110, 3),
(11, 'S.Chili (pack/10)', 'Support Material', 'SM-006', 32000, 85, 3),
(12, 'K.Ayam (pack/100)', 'Packaging', 'PKG-001', 30000, 150, 4),
(13, 'K.Nasi (pack/50)', 'Packaging', 'PKG-002', 24000, 180, 4),
(14, 'Box Nasi (pack/10)', 'Packaging', 'PKG-003', 28000, 200, 4),
(15, 'Tray Nasi (pack/10)', 'Packaging', 'PKG-004', 22000, 160, 4),
(16, 'Plastic 15 (pack/100)', 'Packaging', 'PKG-005', 18000, 140, 4),
(17, 'Plastic 24 (pack/100)', 'Packaging', 'PKG-006', 25000, 130, 4),
(18, 'H.glove (pack/100)', 'Packaging', 'PKG-007', 35000, 100, 4),
(19, 'Cup mika (pack/25)', 'Packaging', 'PKG-008', 16000, 120, 4)
ON DUPLICATE KEY UPDATE `price`=VALUES(`price`), `current_stock`=VALUES(`current_stock`), `vendor_id`=VALUES(`vendor_id`);
