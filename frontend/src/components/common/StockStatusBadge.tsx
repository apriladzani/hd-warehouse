import React from 'react';
import { TriangleAlert } from 'lucide-react';

export type StockStatus = 'Available' | 'Low Stock' | 'Out of Stock';

export function getStockStatus(currentStock: number): StockStatus {
  const stock = Number(currentStock) || 0;
  if (stock <= 0) return 'Out of Stock';
  if (stock < 10) return 'Low Stock';
  return 'Available';
}

export const StockStatusBadge: React.FC<{ currentStock: number }> = ({ currentStock }) => {
  const status = getStockStatus(currentStock);
  const tone = status === 'Available' ? 'available' : status === 'Low Stock' ? 'low' : 'empty';

  return (
    <span className={`hd-stock-badge hd-stock-badge--${tone}`}>
      {status === 'Low Stock' && <TriangleAlert size={13} aria-hidden="true" />}
      {status}
    </span>
  );
};
