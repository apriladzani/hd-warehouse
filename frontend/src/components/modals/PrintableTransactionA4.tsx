import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, FileText } from 'lucide-react';
import { formatRupiah, formatDateIndo, terbilangRupiah } from '../../lib/format.ts';
import { DEFAULT_DELIVERY_ORDER_TEMPLATE, contactLine, signatureName, useDeliveryOrderTemplate, type DeliveryOrderTemplate } from '../../lib/printTemplate.ts';

interface PrintableTransactionA4Props {
  isOpen: boolean;
  onClose: () => void;
  type: 'incoming' | 'outgoing';
  data: any;
  // Prints with this template instead of the saved one (admin "Coba cetak").
  template?: DeliveryOrderTemplate;
}

// Print rules. The dialog is rendered straight into <body> (a portal), so for
// printing everything else in <body> is removed from the layout, not merely made
// invisible: invisible content still takes up room and produced a second page.
// The wrappers lose their fixed position, scrolling and height limits for the
// same reason; Chrome repeats a position:fixed element on every printed page.
//
// @page has no margin so the browser has no room for its own header and footer
// (date, page title, URL); the sheet itself carries the 12 mm margin instead.
const PRINT_CSS = `
  @media print {
    @page { size: A4; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
    body > *:not(.hd-print-root) { display: none !important; }
    .hd-print-root .no-print { display: none !important; }
    .hd-print-root, .hd-print-root .hd-print-backdrop, .hd-print-root .hd-print-dialog, .hd-print-root .hd-print-scroll {
      position: static !important; inset: auto !important; display: block !important;
      width: auto !important; max-width: none !important; height: auto !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; overflow: visible !important;
      background: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; backdrop-filter: none !important;
    }
    #printable-a4-sheet {
      width: 210mm !important; max-width: none !important; min-height: 0 !important; height: auto !important;
      margin: 0 !important; padding: 12mm !important; box-sizing: border-box !important;
      border: 0 !important; box-shadow: none !important; background: #fff !important; color: #000 !important;
      display: block !important; position: relative !important; font-size: 10pt !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    #printable-a4-sheet table { width: 100% !important; table-layout: fixed !important; font-size: 9pt !important; }
    #printable-a4-sheet thead { display: table-header-group !important; }
    #printable-a4-sheet tr { break-inside: avoid !important; }
    #printable-a4-sheet th, #printable-a4-sheet td { padding: 1.6mm 1.5mm !important; overflow-wrap: anywhere !important; }
    #printable-a4-sheet .doc-signature { break-inside: avoid !important; margin-top: 8mm !important; padding-top: 5mm !important; }
  }
`;

const prepareItems = (data: any, isIncoming: boolean) => {
  const rawItems: any[] = data.items || data.approvedItems || [];
  return rawItems.map((it: any, idx: number) => {
    const quantity = isIncoming ? it.quantity : it.status === 'Approved' ? it.approvedQuantity : it.requestedQuantity || it.quantity || 0;
    const price = it.price || 0;
    return { no: idx + 1, itemName: it.itemName || `Barang #${it.itemId}`, quantity, price, subtotal: it.subtotal || quantity * price };
  });
};

const InfoRow: React.FC<{ label: string; children: React.ReactNode; strong?: boolean; className?: string }> = ({ label, children, strong, className }) => (
  <div className="flex">
    <span className="w-32 shrink-0 text-[#64748B] font-medium">{label}</span>
    <span className={`${strong ? 'font-bold' : 'font-semibold'} ${className || 'text-[#0F172A]'}`}>: {children}</span>
  </div>
);

// The A4 sheet itself, without any dialog around it. Outgoing documents (Surat
// Jalan / Delivery Order) take their wording from `template`; the incoming
// Goods Receipt Note keeps its fixed wording.
// `preview` drops the print id, so an on-screen preview is never what gets printed.
export const TransactionDocument: React.FC<{ type: 'incoming' | 'outgoing'; data: any; template: DeliveryOrderTemplate; printTimestamp?: string; preview?: boolean }> = ({ type, data, template, printTimestamp, preview }) => {
  const isIncoming = type === 'incoming';
  const t = template;
  const docCode = isIncoming ? data.transactionCode : data.requestCode;
  const docDate = isIncoming ? data.transactionDate : data.requestDate;
  const timestamp = printTimestamp || new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const items = prepareItems(data, isIncoming);
  const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalAmount = isIncoming
    ? data.totalAmount || items.reduce((sum, i) => sum + i.subtotal, 0)
    : data.printableRequest
      ? Number(data.totalApprovedAmount ?? 0)
      : data.totalApprovedAmount || data.totalAmount || items.reduce((sum, i) => sum + i.subtotal, 0);

  const showPrices = isIncoming || t.table.showPrices;
  const showTerbilang = isIncoming || (t.table.showPrices && t.table.showTerbilang);
  const showPayment = isIncoming || t.info.showPaymentMethod;
  const columnCount = showPrices ? 5 : 3;
  const notes = isIncoming ? DEFAULT_DELIVERY_ORDER_TEMPLATE.notes : t.notes;
  const header = isIncoming ? DEFAULT_DELIVERY_ORDER_TEMPLATE.header : t.header;
  const signatures = isIncoming
    ? [
      { label: 'Diserahkan Oleh (Pemasok / Driver)', name: data.vendorName || 'Pihak Vendor' },
      { label: 'Diterima & Diperiksa (Staff Gudang)', name: data.createdBy || 'Staff Gudang HD' },
      { label: 'Mengetahui & Verifikasi (SPV / Manager)', name: 'Kepala Logistik & Gudang' },
    ]
    : t.signatures.map((column) => ({ label: column.label, name: signatureName(column, data.requesterName) }));
  // A cancelled purchase can still be printed, for the archive, but never passes
  // for a valid receipt: watermark plus who cancelled it and why.
  const cancelled = isIncoming && data.status === 'cancelled';

  return (
    <div
      id={preview ? undefined : 'printable-a4-sheet'}
      className="relative w-full max-w-[210mm] min-h-[297mm] bg-white p-8 sm:p-12 shadow-md border border-[#CBD5E1] text-[#0F172A] font-sans flex flex-col justify-between"
      style={{ boxSizing: 'border-box' }}
    >
      {cancelled && (
        <div aria-hidden="true" className="doc-watermark pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="-rotate-[30deg] select-none whitespace-nowrap rounded-xl border-[6px] border-[#DC2626]/40 px-8 py-2 text-[96px] font-black tracking-[0.15em] text-[#DC2626]/25">DIBATALKAN</span>
        </div>
      )}
      <div>
        {/* Kop Surat / Header */}
        <div className="border-b-2 border-[#0F172A] pb-3 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                {header.logoUrl
                  ? <img src={header.logoUrl} alt={header.brandName} className="h-10 max-w-[180px] object-contain" />
                  : <span className="text-xl sm:text-2xl font-black text-[#ED002B] tracking-tight">{header.brandName}</span>}
                {header.subLabel && (
                  <span className="text-xs font-bold uppercase tracking-widest px-1.5 py-0.5 bg-[#17233D] text-white rounded-[4px]">{header.subLabel}</span>
                )}
              </div>
              {header.divisionName && <h2 className="text-xs sm:text-sm font-bold text-[#17233D] uppercase tracking-wider">{header.divisionName}</h2>}
              {contactLine(header) && <p className="text-[11px] text-[#475569]">{contactLine(header)}</p>}
            </div>

            <div className="shrink-0 text-right">
              <span className="text-[10px] text-[#64748B] block font-mono">FORM: {isIncoming ? 'WMS-A4-IN' : t.header.formCode}</span>
              <span className="text-xs font-bold text-[#17233D] block mt-0.5 font-mono">{docCode}</span>
              <span className="text-[10px] text-[#64748B] block">Waktu Cetak: {timestamp}</span>
            </div>
          </div>
        </div>

        {/* Title Dokumen */}
        <div className="text-center my-4">
          <h1 className="text-base sm:text-lg font-black uppercase tracking-wider underline decoration-1 underline-offset-4 text-[#0F172A]">
            {isIncoming ? 'SURAT BUKTI PENERIMAAN BARANG (GOODS RECEIPT NOTE)' : t.title.title}
          </h1>
          {(isIncoming || t.title.subtitle) && (
            <p className="text-[11px] text-[#64748B] mt-0.5">
              {isIncoming ? 'Bukti serah terima fisik barang masuk dari vendor/pemasok ke gudang resmi' : t.title.subtitle}
            </p>
          )}
        </div>

        {cancelled && (
          <div role="note" className="my-3 rounded-[6px] border-2 border-[#DC2626] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
            <strong className="block uppercase tracking-wider">Transaksi ini DIBATALKAN — tidak berlaku sebagai bukti penerimaan</strong>
            <span className="block">Alasan: {data.cancelReason || '-'}</span>
            {(data.cancelledByName || data.cancelledAt) && (
              <span className="block text-[11px]">
                Dibatalkan{data.cancelledByName ? ` oleh ${data.cancelledByName}` : ''}{data.cancelledAt ? ` pada ${new Date(data.cancelledAt).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' })}` : ''}
              </span>
            )}
          </div>
        )}

        {/* Metadata Info Grid */}
        <div className="grid grid-cols-2 gap-4 p-3.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-[8px] my-4 text-xs">
          <div className="space-y-1.5">
            <InfoRow label={isIncoming ? 'Nomor Penerimaan' : 'No. Transaksi'} strong>{docCode}</InfoRow>
            <InfoRow label={isIncoming ? 'Tanggal Penerimaan' : data.printableRequest ? 'Tanggal Request' : 'Tanggal Transaksi'}>{formatDateIndo(docDate)}</InfoRow>
            {showPayment && <InfoRow label="Metode Pembayaran">{data.paymentMethod || 'Transfer'}</InfoRow>}
          </div>

          <div className="space-y-1.5">
            {isIncoming ? (
              <>
                <InfoRow label="Pemasok / Vendor" strong>{data.vendorName || '-'}</InfoRow>
                <InfoRow label="Kode Vendor" className="text-[#0F172A] font-mono">{data.vendorCode || '-'}</InfoRow>
                <InfoRow label="Petugas Penerima">{data.createdBy || 'Staff Gudang'}</InfoRow>
              </>
            ) : (
              <>
                <InfoRow label="Pemohon / Outlet" strong>{data.requesterName || '-'}</InfoRow>
                <InfoRow label="Status Persetujuan" strong className="text-[#1B9357]">{data.status || 'Approved'}</InfoRow>
                <InfoRow label="Pengeluaran Dari">{t.info.issuedFrom}</InfoRow>
                {data.printableRequest && t.info.showApprovedBy && <InfoRow label="Disetujui Oleh">{data.approvalInfo || 'Staff Gudang'}</InfoRow>}
                {data.printableRequest && t.info.showApprovalDate && data.approvalDate && <InfoRow label="Tanggal Approval">{data.approvalDate}</InfoRow>}
              </>
            )}
          </div>
        </div>

        {/* Items Table */}
        <div className="my-4">
          <table className="w-full border-collapse border border-[#0F172A] text-xs">
            <thead>
              <tr className="bg-[#0F172A] text-white">
                <th className="border border-[#0F172A] py-2 px-2 text-center w-10 font-bold">No</th>
                <th className="border border-[#0F172A] py-2 px-3 text-left font-bold">Deskripsi Barang</th>
                <th className="border border-[#0F172A] py-2 px-3 text-center w-24 font-bold">Kuantitas</th>
                {showPrices && (
                  <>
                    <th className="border border-[#0F172A] py-2 px-3 text-right w-28 font-bold">
                      {isIncoming ? 'Harga Beli per Unit' : data.printableRequest ? 'Harga Katalog per Unit' : 'Harga Satuan'}
                    </th>
                    <th className="border border-[#0F172A] py-2 px-3 text-right w-28 font-bold">Subtotal</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? items.map((item) => (
                <tr key={item.no} className="border-b border-[#CBD5E1]">
                  <td className="border border-[#CBD5E1] py-2 px-2 text-center font-mono">{item.no}</td>
                  <td className="border border-[#CBD5E1] py-2 px-3 font-semibold text-[#0F172A]">{item.itemName}</td>
                  <td className="border border-[#CBD5E1] py-2 px-3 text-center font-bold">{item.quantity} pcs</td>
                  {showPrices && (
                    <>
                      <td className="border border-[#CBD5E1] py-2 px-3 text-right text-[#475569] font-mono">{formatRupiah(item.price)}</td>
                      <td className="border border-[#CBD5E1] py-2 px-3 text-right font-bold text-[#0F172A] font-mono">{formatRupiah(item.subtotal)}</td>
                    </>
                  )}
                </tr>
              )) : (
                <tr><td colSpan={columnCount} className="py-6 text-center text-[#64748B] italic">Tidak ada rincian barang.</td></tr>
              )}

              <tr className="bg-[#F1F5F9] font-bold border-t-2 border-[#0F172A]">
                <td colSpan={2} className="border border-[#CBD5E1] py-2.5 px-3 text-right uppercase tracking-wider">Total Rangkuman:</td>
                <td className="border border-[#CBD5E1] py-2.5 px-3 text-center font-black text-[#0F172A]">{totalQty} pcs</td>
                {showPrices && (
                  <>
                    <td className="border border-[#CBD5E1] py-2.5 px-3 text-right">Grand Total:</td>
                    <td className="border border-[#CBD5E1] py-2.5 px-3 text-right font-black text-sm text-[#0F172A] font-mono">{formatRupiah(totalAmount)}</td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
        </div>

        {showTerbilang && (
          <div className="p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-[6px] my-3 text-xs">
            <span className="font-semibold text-[#475569]">Terbilang: </span>
            <span className="font-bold italic text-[#0F172A]">"{terbilangRupiah(totalAmount)}"</span>
          </div>
        )}

        {notes.length > 0 && (
          <div className="text-[11px] text-[#64748B] space-y-0.5 mt-2">
            {notes.map((note, index) => <p key={index}>• {note}</p>)}
          </div>
        )}
      </div>

      {/* Tanda tangan */}
      <div className="doc-signature pt-8 border-t border-[#CBD5E1] mt-8">
        <div className="grid gap-6 text-center text-xs" style={{ gridTemplateColumns: `repeat(${signatures.length}, minmax(0, 1fr))` }}>
          {signatures.map((column, index) => (
            <div key={index} className="signature-cell">
              {/* Room for two lines of label, so every signature line sits at the same height. */}
              <span className="block min-h-[2.6em] font-medium text-[#475569]">{column.label}</span>
              <div className="mt-12">
                <div className="border-b border-[#0F172A] w-4/5 mx-auto"></div>
                <span className="text-[11px] text-[#475569] mt-1 block">( {column.name} )</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const PrintableTransactionA4: React.FC<PrintableTransactionA4Props> = ({ isOpen, onClose, type, data, template }) => {
  const isOutgoing = type === 'outgoing';
  // Outgoing documents wait for the saved template so the wording that is
  // printed is the one the admin configured, not the built-in default.
  const savedTemplate = useDeliveryOrderTemplate(isOpen && isOutgoing && !template);
  const activeTemplate = template || savedTemplate;
  const ready = !isOutgoing || Boolean(activeTemplate);
  const docCode = data ? (type === 'incoming' ? data.transactionCode : data.requestCode) : '';

  // The page title appears in the browser's own print header when the user has
  // turned it on; name the document instead of the application while printing.
  useEffect(() => {
    if (!isOpen) return;
    const original = document.title;
    const before = () => { document.title = docCode || original; };
    const after = () => { document.title = original; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); document.title = original; };
  }, [isOpen, docCode]);

  if (!isOpen || !data) return null;
  const handlePrint = () => { if (ready) window.print(); };

  return createPortal(
    <div className="hd-print-root">
      <style>{PRINT_CSS}</style>
      <div className="hd-modal-backdrop hd-print-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
        <div className="hd-print-dialog bg-white w-full max-w-4xl rounded-xl overflow-hidden flex flex-col max-h-[96vh]" onClick={(e) => e.stopPropagation()}>
          <div className="no-print hd-print-toolbar flex items-center justify-between px-4 py-3 bg-white text-[#1E293B] border-b border-[#E2E8F0]">
            <div className="flex items-center space-x-2">
              <FileText className="w-4 h-4 text-[#FFB800]" />
              <span className="text-xs sm:text-sm font-bold tracking-wide">Preview Cetak Standar Kertas A4 • {docCode}</span>
            </div>
            <div className="flex items-center space-x-2">
              <button id="btn-trigger-print" onClick={handlePrint} disabled={!ready} className="hd-button hd-button--primary">
                <Printer className="w-3.5 h-3.5" />
                <span>{ready ? 'Cetak Kertas A4 Sekarang' : 'Memuat pengaturan cetak…'}</span>
              </button>
              <button onClick={onClose} className="hd-button hd-button--ghost hd-icon-button" title="Tutup"><X className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="hd-print-scroll overflow-y-auto p-4 sm:p-8 bg-[#E2E8F0]/50 flex justify-center">
            <TransactionDocument type={type} data={data} template={activeTemplate || DEFAULT_DELIVERY_ORDER_TEMPLATE} />
          </div>

          <div className="no-print p-4 bg-[#F8FAFC] border-t border-[#DDE5F0] flex items-center justify-between">
            <div className="text-xs text-[#60708C]">
              *Format dokumen telah dioptimalkan untuk kertas <strong>A4 Portrait</strong>, 1 halaman per transaksi.
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={onClose} className="hd-button hd-button--secondary">Tutup</button>
              <button id="btn-bottom-print" onClick={handlePrint} disabled={!ready} className="hd-button hd-button--primary">
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak Kertas A4</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
