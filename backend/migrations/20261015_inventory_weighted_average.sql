-- Retain the existing Inventory field, with cents for weighted averages.
ALTER TABLE items MODIFY COLUMN avg_purchase_price DECIMAL(18,2) NOT NULL DEFAULT 0;

UPDATE items i
LEFT JOIN (
  SELECT item_id, SUM(quantity * price) / NULLIF(SUM(quantity), 0) AS average_price
  FROM purchase_items
  WHERE quantity > 0 AND price >= 0
  GROUP BY item_id
) p ON p.item_id = i.id
SET i.avg_purchase_price = COALESCE(p.average_price, 0);
