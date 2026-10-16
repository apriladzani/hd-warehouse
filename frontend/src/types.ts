export type Role = 'OUTLET' | 'WAREHOUSE';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Vendor {
  id: number;
  vendorCode: string;
  vendorName: string;
}

export interface InventoryItem {
  id: number;
  itemName: string;
  category: 'Raw Material' | 'Support Material' | 'Packaging';
  itemCode: string;
  price: number; // Harga Katalog (digunakan untuk Request Outlet)
  avgPurchasePrice?: number; // Harga Rata-Rata Pembelian (Weighted Average dari Transaksi Masuk)
  currentStock: number;
  vendorId?: number;
  vendorName?: string;
  vendorCode?: string;
  vendorsSupplied?: string[];
  activeVendors?: Array<{ id: number; vendorCode: string; vendorName: string }>;
  vendorIds?: number[];
  status: 'Available' | 'Low Stock' | 'Out of Stock';
}

export type RequestStatus = 'Pending' | 'Partially Approved' | 'Approved' | 'Rejected';
export type ItemApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface RequestItem {
  id: number;
  requestId: number;
  itemId: number;
  itemName?: string;
  requestedQuantity: number;
  approvedQuantity: number;
  price: number;
  status: ItemApprovalStatus;
  currentStock?: number;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export interface RequestTransaction {
  id: number;
  requestCode: string;
  userId?: number;
  requesterName: string;
  paymentMethod: string;
  requestDate: string;
  status: RequestStatus;
  totalAmount: number;
  itemCount?: number;
  itemSummary?: string;
  items?: RequestItem[];
}

export interface PurchaseItem {
  id: number;
  purchaseId: number;
  itemId: number;
  itemName?: string;
  vendorName?: string;
  quantity: number;
  price: number;
  subtotal: number;
  avgCostAfter?: number;
}

export interface PurchaseTransaction {
  id: number;
  transactionCode: string;
  vendorId: number;
  vendorName?: string;
  vendorCode?: string;
  paymentMethod: string;
  transactionDate: string;
  totalAmount: number;
  createdBy: string;
  itemCount?: number;
  itemSummary?: string;
  items?: PurchaseItem[];
}

export interface OutgoingHistoryTransaction extends RequestTransaction {
  totalApprovedAmount?: number;
  approvedItems?: RequestItem[];
}

export interface UserStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  recentRequests: RequestTransaction[];
}

export interface WarehouseItemProfitability {
  purchaseQuantity: number;
  totalCogsAmount: number;
  itemId: number;
  itemName: string;
  category: 'Raw Material' | 'Support Material' | 'Packaging';
  itemCode: string;
  currentStock: number;
  quantity: number;
  avgPurchasePrice: number;
  totalPurchaseAmount: number;
  catalogPrice: number;
  totalSellingAmount: number;
  totalProfit: number;
}

export interface WarehouseStats {
  totalStock: number;
  barangMasukPcs: number;
  barangKeluarPcs: number;
  requestPending: number;
  recentTransactions: Array<{
    id: number;
    itemName: string;
    quantity: number;
    movementType: 'IN' | 'OUT';
    typeLabel: string;
    date: string;
    referenceId: string;
  }>;
  totalPurchaseAmount?: number;
  totalSellingAmount?: number;
  totalProfit?: number;
  totalQuantity?: number;
  totalIncomingAmount?: number;
  totalCogsAmount?: number;
  itemProfitability?: WarehouseItemProfitability[];
  itemList?: Array<{ id: number; itemName: string }>;
  categoryPurchaseTotals?: Array<{
    category: 'Raw Material' | 'Support Material' | 'Packaging';
    code: 'RM' | 'SM' | 'PKG';
    totalAmount: number;
  }>;
}
