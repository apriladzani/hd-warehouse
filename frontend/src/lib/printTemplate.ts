import { useEffect, useState } from 'react';

// Editable wording of the printed Surat Jalan / Delivery Order. The server is
// the source of truth (GET /api/print-templates/delivery-order); these defaults
// are only the fallback while it loads or when it cannot be reached, and must
// stay equal to DEFAULT_DELIVERY_ORDER_TEMPLATE in backend/src/printTemplate.ts.

export type SignatureColumn = { label: string; name: string; useOutletName: boolean };
export type DeliveryOrderTemplate = {
  header: { brandName: string; subLabel: string; divisionName: string; address: string; hotline: string; email: string; logoUrl: string; formCode: string };
  title: { title: string; subtitle: string };
  info: { issuedFrom: string; showPaymentMethod: boolean; showApprovedBy: boolean; showApprovalDate: boolean };
  table: { showPrices: boolean; showTerbilang: boolean };
  notes: string[];
  signatures: SignatureColumn[];
};

export const MAX_NOTES = 10;
export const MAX_SIGNATURES = 4;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const PRINT_TEMPLATE_UPDATED_EVENT = 'hd-print-template-updated';

export const DEFAULT_DELIVERY_ORDER_TEMPLATE: DeliveryOrderTemplate = {
  header: {
    brandName: 'HD FriedChicken',
    subLabel: 'SUPPLY CHAIN',
    divisionName: 'DIVISI LOGISTIK & PERGUDANGAN PUSAT (CENTRAL WAREHOUSE)',
    address: 'Kawasan Pergudangan Logistik Mandiri Blok C-12',
    hotline: '(021) 555-0192',
    email: 'warehouse@hdresto.co.id',
    logoUrl: '',
    formCode: 'WMS-A4-OUT',
  },
  title: {
    title: 'SURAT JALAN & PENGELUARAN BARANG (DELIVERY ORDER)',
    subtitle: 'Bukti serah terima dan mutasi barang keluar dari gudang ke pemohon / outlet',
  },
  info: { issuedFrom: 'Gudang Utama HD', showPaymentMethod: true, showApprovedBy: true, showApprovalDate: true },
  table: { showPrices: true, showTerbilang: true },
  notes: [
    'Barang telah diverifikasi fisik dan kuantitasnya sesuai prosedur standar operasional gudang.',
    'Segala bentuk retur atau klaim selisih wajib menyertakan lembar asli dokumen transaksi ini.',
  ],
  signatures: [
    { label: 'Diterima Oleh (Pemohon / Outlet)', name: '', useOutletName: true },
    { label: 'Diterima & Diperiksa (Staff Gudang)', name: 'Staff Gudang HD', useOutletName: false },
    { label: 'Mengetahui & Verifikasi (SPV / Manager)', name: 'Kepala Logistik & Gudang', useOutletName: false },
  ],
};

export const cloneTemplate = (template: DeliveryOrderTemplate): DeliveryOrderTemplate => JSON.parse(JSON.stringify(template));

// The name printed under a signature line: the outlet's name for an automatic
// column, the configured name otherwise.
export const signatureName = (column: SignatureColumn, outletName?: string | null) =>
  column.useOutletName ? (outletName || 'Pemohon') : column.name;

// Header contact line, leaving out the parts the admin cleared.
export const contactLine = (header: DeliveryOrderTemplate['header']) => [
  header.address,
  header.hotline && `Hotline: ${header.hotline}`,
  header.email && `Email: ${header.email}`,
].filter(Boolean).join(' • ');

// Example transaction for the admin preview and "Coba cetak". Its shape is what
// buildApprovedRequestPrintData() produces for a real approved request.
export const SAMPLE_DELIVERY_ORDER = {
  requestCode: 'REQ-CONTOH-0001',
  requestDate: new Date().toISOString().slice(0, 10),
  requesterName: 'Outlet Contoh Sudirman',
  outletName: 'Outlet Contoh Sudirman',
  paymentMethod: 'Transfer',
  status: 'Approved',
  printableRequest: true,
  approvalInfo: 'Staff Gudang HD',
  approvalDate: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
  items: [
    { itemId: 1, itemName: 'Ayam Mentah (kg)', requestedQuantity: 20, approvedQuantity: 20, quantity: 20, price: 38000, subtotal: 760000, status: 'Approved' },
    { itemId: 4, itemName: 'Tepung (pcs)', requestedQuantity: 10, approvedQuantity: 10, quantity: 10, price: 18000, subtotal: 180000, status: 'Approved' },
    { itemId: 14, itemName: 'Box Nasi (pack/10)', requestedQuantity: 5, approvedQuantity: 5, quantity: 5, price: 28000, subtotal: 140000, status: 'Approved' },
  ],
  totalApprovedAmount: 1080000,
  totalAmount: 1080000,
};

// One request per page load, shared by every print dialog; the admin page
// clears it after saving so the next print uses the new wording.
let cached: Promise<DeliveryOrderTemplate> | null = null;
const fetchTemplate = () => {
  if (!cached) cached = fetch('/api/print-templates/delivery-order')
    .then(async (response) => {
      if (!response.ok) throw new Error('unavailable');
      return (await response.json()).template as DeliveryOrderTemplate;
    })
    .catch(() => { cached = null; return cloneTemplate(DEFAULT_DELIVERY_ORDER_TEMPLATE); });
  return cached;
};

export const announceTemplateUpdated = () => {
  cached = null;
  window.dispatchEvent(new Event(PRINT_TEMPLATE_UPDATED_EVENT));
};

export function useDeliveryOrderTemplate(enabled = true) {
  const [template, setTemplate] = useState<DeliveryOrderTemplate | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => void fetchTemplate().then((next) => { if (active) setTemplate(next); });
    load();
    window.addEventListener(PRINT_TEMPLATE_UPDATED_EVENT, load);
    return () => { active = false; window.removeEventListener(PRINT_TEMPLATE_UPDATED_EVENT, load); };
  }, [enabled]);
  return template;
}
