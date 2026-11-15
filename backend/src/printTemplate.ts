// Editable text of the printed "Surat Jalan & Pengeluaran Barang (Delivery
// Order)". Stored as JSON in system_settings under PRINT_TEMPLATE_KEY. Only the
// fixed wording lives here: transaction data (number, date, outlet, lines,
// quantities, prices) always comes from the transaction itself.
//
// Keep DEFAULT_DELIVERY_ORDER_TEMPLATE in step with
// frontend/src/lib/printTemplate.ts, which uses the same values as its fallback.

export const PRINT_TEMPLATE_KEY = 'print_template_delivery_order';
export const MAX_NOTES = 10;
export const MAX_SIGNATURES = 4;
export const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_PATTERN = /^\/uploads\/branding\/[\w-]+\.(?:png|jpg)$/;

export type SignatureColumn = { label: string; name: string; useOutletName: boolean };
export type DeliveryOrderTemplate = {
  header: { brandName: string; subLabel: string; divisionName: string; address: string; hotline: string; email: string; logoUrl: string; formCode: string };
  title: { title: string; subtitle: string };
  info: { issuedFrom: string; showPaymentMethod: boolean; showApprovedBy: boolean; showApprovalDate: boolean };
  table: { showPrices: boolean; showTerbilang: boolean };
  notes: string[];
  signatures: SignatureColumn[];
};

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

export class PrintTemplateError extends Error {}

const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown, label: string, max: number, required = false) => {
  if (value != null && typeof value !== 'string') throw new PrintTemplateError(`${label} harus berupa teks`);
  const result = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && !result) throw new PrintTemplateError(`${label} wajib diisi`);
  if (result.length > max) throw new PrintTemplateError(`${label} maksimal ${max} karakter`);
  return result;
};
const flag = (value: unknown, label: string) => {
  if (typeof value !== 'boolean') throw new PrintTemplateError(`${label} harus bernilai ya/tidak`);
  return value;
};

// Validates a complete template sent by the admin page and returns it with
// unknown fields dropped. Throws PrintTemplateError with a message for the admin.
export function validateDeliveryOrderTemplate(input: unknown): DeliveryOrderTemplate {
  const body = object(input);
  const header = object(body.header), title = object(body.title), info = object(body.info), table = object(body.table);
  const logoUrl = text(header.logoUrl, 'Logo', 200);
  if (logoUrl && !LOGO_PATTERN.test(logoUrl)) throw new PrintTemplateError('Referensi file logo tidak valid');

  if (!Array.isArray(body.notes)) throw new PrintTemplateError('Catatan kaki harus berupa daftar');
  const notes = body.notes.map((note, index) => text(note, `Catatan ${index + 1}`, 300)).filter(Boolean);
  if (notes.length > MAX_NOTES) throw new PrintTemplateError(`Catatan kaki maksimal ${MAX_NOTES} baris`);

  if (!Array.isArray(body.signatures)) throw new PrintTemplateError('Kolom tanda tangan harus berupa daftar');
  if (body.signatures.length < 1 || body.signatures.length > MAX_SIGNATURES) throw new PrintTemplateError(`Kolom tanda tangan harus 1 sampai ${MAX_SIGNATURES}`);
  const signatures = body.signatures.map((raw, index) => {
    const column = object(raw);
    const useOutletName = flag(column.useOutletName, `Nama otomatis kolom tanda tangan ${index + 1}`);
    return {
      label: text(column.label, `Label tanda tangan ${index + 1}`, 80, true),
      name: useOutletName ? '' : text(column.name, `Nama tanda tangan ${index + 1}`, 80, true),
      useOutletName,
    };
  });

  const showPrices = flag(table.showPrices, 'Tampilkan kolom harga');
  return {
    header: {
      brandName: text(header.brandName, 'Nama brand', 80, true),
      subLabel: text(header.subLabel, 'Sub-label', 40),
      divisionName: text(header.divisionName, 'Nama divisi', 160),
      address: text(header.address, 'Alamat', 200),
      hotline: text(header.hotline, 'Hotline', 40),
      email: text(header.email, 'Email', 120),
      logoUrl,
      formCode: text(header.formCode, 'Kode form', 40, true),
    },
    title: { title: text(title.title, 'Judul dokumen', 120, true), subtitle: text(title.subtitle, 'Sub-judul', 200) },
    info: {
      issuedFrom: text(info.issuedFrom, 'Pengeluaran Dari', 80, true),
      showPaymentMethod: flag(info.showPaymentMethod, 'Tampilkan Metode Pembayaran'),
      showApprovedBy: flag(info.showApprovedBy, 'Tampilkan Disetujui Oleh'),
      showApprovalDate: flag(info.showApprovalDate, 'Tampilkan Tanggal Approval'),
    },
    // "Terbilang" spells out the grand total, so it cannot stay when prices are hidden.
    table: { showPrices, showTerbilang: showPrices && flag(table.showTerbilang, 'Tampilkan Terbilang') },
    notes,
    signatures,
  };
}

// Reads what is stored, filling anything missing (an older or damaged row)
// from the defaults. A row that no longer validates falls back to the defaults
// entirely, so printing never breaks on a bad setting.
export function resolveDeliveryOrderTemplate(stored: unknown): DeliveryOrderTemplate {
  if (stored == null) return structuredClone(DEFAULT_DELIVERY_ORDER_TEMPLATE);
  const value = object(stored);
  const merged = {
    header: { ...DEFAULT_DELIVERY_ORDER_TEMPLATE.header, ...object(value.header) },
    title: { ...DEFAULT_DELIVERY_ORDER_TEMPLATE.title, ...object(value.title) },
    info: { ...DEFAULT_DELIVERY_ORDER_TEMPLATE.info, ...object(value.info) },
    table: { ...DEFAULT_DELIVERY_ORDER_TEMPLATE.table, ...object(value.table) },
    notes: Array.isArray(value.notes) ? value.notes : DEFAULT_DELIVERY_ORDER_TEMPLATE.notes,
    signatures: Array.isArray(value.signatures) ? value.signatures : DEFAULT_DELIVERY_ORDER_TEMPLATE.signatures,
  };
  try { return validateDeliveryOrderTemplate(merged); }
  catch { return structuredClone(DEFAULT_DELIVERY_ORDER_TEMPLATE); }
}

// Field-by-field changes for the activity log, e.g. { field: 'header.address', from, to }.
export function diffTemplates(before: DeliveryOrderTemplate, after: DeliveryOrderTemplate) {
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  const walk = (a: any, b: any, path: string) => {
    if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field: path, from: a, to: b });
      return;
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], path ? `${path}.${key}` : key);
  };
  walk(before, after, '');
  return changes;
}
