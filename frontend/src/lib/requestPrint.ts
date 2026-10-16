import { RequestTransaction } from '../types.ts';
import { OUTLETS } from '../constants/outlets.ts';

type RequestPrintLine = {
  itemId: number;
  itemName: string;
  requestedQuantity: number;
  approvedQuantity: number;
  quantity: number;
  price: number;
  subtotal: number;
  status: 'Approved';
  approvedBy?: string | null;
  approvedAt?: string | null;
};

export const canPrintApprovedRequest = (request: RequestTransaction | null | undefined) => {
  if (!request || !['Approved', 'Partially Approved'].includes(request.status)) return false;
  const lines = request.items || [];
  return lines.length > 0 && !lines.some((line) => line.status === 'Pending') &&
    lines.some((line) => line.status === 'Approved' && Number(line.approvedQuantity) > 0);
};

export const buildApprovedRequestPrintData = (request: any) => {
  const approvedItems: RequestPrintLine[] = (request.items || request.approvedItems || [])
    .filter((line: any) => line.status === 'Approved' && Number(line.approvedQuantity) > 0)
    .map((line: any) => {
      const quantity = Number(line.approvedQuantity);
      const price = Number(line.price || 0);
      return {
        ...line,
        itemName: line.itemName || `Barang #${line.itemId}`,
        requestedQuantity: Number(line.requestedQuantity || quantity),
        approvedQuantity: quantity,
        quantity,
        price,
        subtotal: quantity * price,
        status: 'Approved' as const,
      };
    });
  const totalApprovedAmount = approvedItems.reduce((sum, line) => sum + line.subtotal, 0);
  const approvers = [...new Set(approvedItems.map((line) => line.approvedBy).filter(Boolean))];
  const approvalDates = [...new Set(approvedItems.map((line) => line.approvedAt).filter(Boolean))];

  const requesterName = String(request.requesterName || '');
  const outletName = OUTLETS.find((outlet) => requesterName === outlet || requesterName.startsWith(`${outlet} (`)) || requesterName;

  return {
    ...request,
    requesterName: outletName || '-',
    status: 'Approved',
    printableRequest: true,
    items: approvedItems,
    approvedItems,
    totalApprovedAmount,
    totalAmount: totalApprovedAmount,
    approvalInfo: approvers.length ? approvers.join(', ') : 'Staff Gudang',
    approvalDate: approvalDates.join(', '),
  };
};
