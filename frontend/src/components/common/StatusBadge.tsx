import React from 'react';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  let bg = 'bg-[#F8FAFC]';
  let text = 'text-[#60708C]';
  let border = 'border-[#DDE5F0]';

  switch (status) {
    case 'Approved':
    case 'Available':
      bg = 'bg-[#EAF8F1]';
      text = 'text-[#1B9357]';
      border = 'border-[#A7E4C4]';
      break;
    case 'Pending':
    case 'Low Stock':
      bg = 'bg-[#FFF8E6]';
      text = 'text-[#B27B00]';
      border = 'border-[#FFE699]';
      break;
    case 'Partially Approved':
      bg = 'bg-[#EFF6FF]';
      text = 'text-[#2563EB]';
      border = 'border-[#BFDBFE]';
      break;
    case 'Rejected':
    case 'Out of Stock':
      bg = 'bg-[#FDE8EC]';
      text = 'text-[#ED002B]';
      border = 'border-[#F8B6C2]';
      break;
    default:
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full border ${bg} ${text} ${border} whitespace-nowrap ${className}`}
    >
      {status}
    </span>
  );
};
