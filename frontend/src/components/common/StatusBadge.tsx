import React from 'react';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusTones: Record<string, string> = {
  Approved: 'success', Available: 'success',
  Pending: 'warning', 'Low Stock': 'warning',
  'Partially Approved': 'info',
  Rejected: 'danger', 'Out of Stock': 'danger',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => (
  <span className={`hd-badge hd-badge--${statusTones[status] || 'neutral'} ${className}`}>{status}</span>
);
