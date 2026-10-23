export type Role = 'ADMIN' | 'OUTLET' | 'WAREHOUSE' | 'FINANCE';

export interface User {
  id: number;
  name: string;
  username?: string;
  email: string;
  role: Role;
  outletId?: number | null;
  outletName?: string | null;
  isActive?: boolean;
}

export interface Outlet {
  id: number;
  code: string;
  name: string;
  address?: string | null;
  isActive?: boolean;
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
  outletId?: number | null;
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
  averageSellingPrice: number;
  totalProfit: number | null;
  missingCostQuantity?: number;
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
    movementType: 'IN' | 'OUT' | 'STOCK_OPNAME_ADJUSTMENT';
    typeLabel: string;
    date: string;
    referenceId: string;
  }>;
  totalPurchaseAmount?: number;
  totalSellingAmount?: number;
  totalIncomeReceived?: number | null;
  totalProfit?: number | null;
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
  financePeriods?: FinancePeriod[];
  financePeriod?: FinancePeriod | null;
  inventoryAdjustmentAmount?: number;
  missingCostQuantity?: number;
  hasMissingCostData?: boolean;
  otherIncome?: number;
  shrinkageAmount?: number | null;
  contributionMargin?: number | null;
  contributionIncome?: number | null;
  directCosts?: number;
  depreciationAmortization?: number;
  ebitda?: number | null;
  ebit?: number | null;
  manualEntries?: Array<{ id: number; accountCode: string; entryType: 'INCOME' | 'EXPENSE'; outletId: number | null; outletName?: string | null; transactionDate: string; amount: number; description: string }>;
  manualByCode?: Record<string, number>;
  shrinkageDataAvailable?: boolean;
  hasMissingShrinkageData?: boolean;
  shrinkageUnavailableReason?: string;
  cogsByCategory?: Array<{ category: string; code: string; amount: number; missingCostQuantity: number }>;
}

export interface FinancePeriod {
  id: string;
  label: string;
  status: 'Open' | 'Closed' | 'All';
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
}
