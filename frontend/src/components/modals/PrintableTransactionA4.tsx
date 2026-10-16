import React from 'react';
import { Printer, X, FileText, CheckCircle2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatRupiah, formatDateIndo, terbilangRupiah } from '../../lib/format.ts';

interface PrintableTransactionA4Props {
  isOpen: boolean;
  onClose: () => void;
  type: 'incoming' | 'outgoing';
  data: any;
}

export const PrintableTransactionA4: React.FC<PrintableTransactionA4Props> = ({
  isOpen,
  onClose,
  type,
  data,
}) => {
  if (!isOpen || !data) return null;

  const isIncoming = type === 'incoming';
  const isOutgoing = type === 'outgoing';
  const docCode = isIncoming ? data.transactionCode : data.requestCode;
  const docDate = isIncoming ? data.transactionDate : data.requestDate;
  const printTimestamp = new Date().toLocaleString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Items processing
  const rawItems: any[] = data.items || data.approvedItems || [];
  const items = rawItems.map((it: any, idx: number) => {
    const isApproved = it.status === 'Approved';
    const quantity = isIncoming
      ? it.quantity
      : isApproved
        ? it.approvedQuantity
        : it.requestedQuantity || it.quantity || 0;
    const price = it.price || 0;
    const subtotal = it.subtotal || quantity * price;

    return {
      no: idx + 1,
      itemId: it.itemId,
      itemName: it.itemName || `Barang #${it.itemId}`,
      quantity,
      price,
      subtotal,
      status: it.status || 'Verified',
    };
  });

  const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalAmount = isIncoming
    ? data.totalAmount || items.reduce((sum, i) => sum + i.subtotal, 0)
    : data.printableRequest
      ? Number(data.totalApprovedAmount ?? 0)
      : data.totalApprovedAmount || data.totalAmount || items.reduce((sum, i) => sum + i.subtotal, 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      {/* Print CSS Specific Injection */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm 12mm 12mm 12mm;
          }
          body {
            background: #fff !important;
            color: #000 !important;
          }
          body * {
            visibility: hidden !important;
          }
          #printable-a4-sheet, #printable-a4-sheet * {
            visibility: visible !important;
          }
          #printable-a4-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border: none !important;
          }
          #printable-a4-sheet.incoming-receipt {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            overflow: visible !important;
            font-size: 10pt !important;
          }
          #printable-a4-sheet.incoming-receipt table {
            width: 100% !important;
            table-layout: fixed !important;
            font-size: 9pt !important;
          }
          #printable-a4-sheet.incoming-receipt thead { display: table-header-group !important; }
          #printable-a4-sheet.incoming-receipt tr { break-inside: avoid !important; page-break-inside: avoid !important; }
          #printable-a4-sheet.incoming-receipt th,
          #printable-a4-sheet.incoming-receipt td {
            padding: 2mm 1.5mm !important;
            overflow-wrap: anywhere !important;
          }
          #printable-a4-sheet.incoming-receipt .receipt-signature {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-top: 10mm !important;
            padding-top: 6mm !important;
          }
          #printable-a4-sheet.incoming-receipt .receipt-signature .signature-cell { height: 25mm !important; }
          #printable-a4-sheet.incoming-receipt .receipt-header { margin-bottom: 3mm !important; padding-bottom: 3mm !important; }
          #printable-a4-sheet.incoming-receipt .receipt-section { margin-top: 3mm !important; margin-bottom: 3mm !important; }
          #printable-a4-sheet.outgoing-request {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            overflow: visible !important;
            font-size: 10pt !important;
          }
          #printable-a4-sheet.outgoing-request table { width: 100% !important; table-layout: fixed !important; font-size: 9pt !important; }
          #printable-a4-sheet.outgoing-request thead { display: table-header-group !important; }
          #printable-a4-sheet.outgoing-request tr { break-inside: avoid !important; page-break-inside: avoid !important; }
          #printable-a4-sheet.outgoing-request th,
          #printable-a4-sheet.outgoing-request td { padding: 2mm 1.5mm !important; overflow-wrap: anywhere !important; }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Modal Container */}
      <div
        className="bg-white w-full max-w-4xl rounded-[20px] shadow-2xl overflow-hidden flex flex-col max-h-[96vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Control Bar (Hidden in Print) */}
        <div className="no-print flex items-center justify-between px-5 py-3.5 bg-[#17233D] text-white">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-[#FFB800]" />
            <span className="text-xs sm:text-sm font-bold tracking-wide">
              Preview Cetak Standar Kertas A4 • {docCode}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="btn-trigger-print"
              onClick={handlePrint}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs font-bold rounded-[14px] shadow-xs transition-all cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak Kertas A4 Sekarang</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-gray-300 hover:text-white rounded-[10px] hover:bg-white/10 transition-colors"
              title="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Document Preview Area */}
        <div className="overflow-y-auto p-4 sm:p-8 bg-[#E2E8F0]/50 flex justify-center">
          {/* Authentic A4 Document Layout */}
          <div
            id="printable-a4-sheet"
            className={`w-full max-w-[210mm] min-h-[297mm] bg-white p-8 sm:p-12 shadow-md border border-[#CBD5E1] text-[#0F172A] font-sans flex flex-col justify-between ${isIncoming ? 'incoming-receipt' : data.printableRequest ? 'outgoing-request' : ''}`}
            style={{ boxSizing: 'border-box' }}
          >
            <div>
              {/* Kop Surat / Header */}
              <div className={`border-b-2 border-[#0F172A] pb-3 mb-4 ${isIncoming ? 'receipt-header' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="text-xl sm:text-2xl font-black text-[#ED002B] tracking-tight">
                        HD FriedChicken
                      </span>
                      <span className="text-xs font-bold uppercase tracking-widest px-1.5 py-0.5 bg-[#17233D] text-white rounded-[4px]">
                        Supply Chain
                      </span>
                    </div>
                    <h2 className="text-xs sm:text-sm font-bold text-[#17233D] uppercase tracking-wider">
                      Divisi Logistik &amp; Pergudangan Pusat (Central Warehouse)
                    </h2>
                    <p className="text-[11px] text-[#475569]">
                      Kawasan Pergudangan Logistik Mandiri Blok C-12 • Hotline: (021) 555-0192 • Email: warehouse@hdresto.co.id
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-[#64748B] block font-mono">FORM: WMS-A4-{isIncoming ? 'IN' : 'OUT'}</span>
                    <span className="text-xs font-bold text-[#17233D] block mt-0.5 font-mono">
                      {docCode}
                    </span>
                    <span className="text-[10px] text-[#64748B] block">
                      Waktu Cetak: {printTimestamp}
                    </span>
                  </div>
                </div>
              </div>

              {/* Title Dokumen */}
              <div className="text-center my-4">
                <h1 className="text-base sm:text-lg font-black uppercase tracking-wider underline decoration-1 underline-offset-4 text-[#0F172A]">
                  {isIncoming
                    ? 'SURAT BUKTI PENERIMAAN BARANG (GOODS RECEIPT NOTE)'
                    : 'SURAT JALAN & PENGELUARAN BARANG (DELIVERY ORDER)'}
                </h1>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  {isIncoming
                    ? 'Bukti serah terima fisik barang masuk dari vendor/pemasok ke gudang resmi'
                    : 'Bukti serah terima dan mutasi barang keluar dari gudang ke pemohon / outlet'}
                </p>
              </div>

              {/* Metadata Info Grid */}
              <div className={`grid grid-cols-2 gap-4 p-3.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-[8px] my-4 text-xs ${isIncoming ? 'receipt-section' : ''}`}>
                {/* Kolom Kiri */}
                <div className="space-y-1.5">
                  <div className="flex">
                    <span className="w-32 text-[#64748B] font-medium">{isIncoming ? 'Nomor Penerimaan' : 'No. Transaksi'}</span>
                    <span className="font-bold text-[#0F172A]">: {docCode}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 text-[#64748B] font-medium">{isIncoming ? 'Tanggal Penerimaan' : data.printableRequest ? 'Tanggal Request' : 'Tanggal Transaksi'}</span>
                    <span className="font-semibold text-[#0F172A]">: {formatDateIndo(docDate)}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 text-[#64748B] font-medium">Metode Pembayaran</span>
                    <span className="font-semibold text-[#0F172A]">: {data.paymentMethod || 'Transfer'}</span>
                  </div>
                </div>

                {/* Kolom Kanan */}
                <div className="space-y-1.5">
                  {isIncoming ? (
                    <>
                      <div className="flex">
                        <span className="w-32 text-[#64748B] font-medium">Pemasok / Vendor</span>
                        <span className="font-bold text-[#0F172A]">: {data.vendorName || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="w-32 text-[#64748B] font-medium">Kode Vendor</span>
                        <span className="font-semibold text-[#0F172A] font-mono">: {data.vendorCode || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="w-32 text-[#64748B] font-medium">Petugas Penerima</span>
                        <span className="font-semibold text-[#0F172A]">: {data.createdBy || 'Staff Gudang'}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex">
                        <span className="w-32 text-[#64748B] font-medium">Pemohon / Outlet</span>
                        <span className="font-bold text-[#0F172A]">: {data.requesterName || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="w-32 text-[#64748B] font-medium">Status Persetujuan</span>
                        <span className="font-bold text-[#1B9357]">: {data.status || 'Approved'}</span>
                      </div>
                      <div className="flex">
                        <span className="w-32 text-[#64748B] font-medium">Pengeluaran Dari</span>
                        <span className="font-semibold text-[#0F172A]">: Gudang Utama HD</span>
                      </div>
                      {data.printableRequest && (
                        <>
                          <div className="flex">
                            <span className="w-32 text-[#64748B] font-medium">Disetujui Oleh</span>
                            <span className="font-semibold text-[#0F172A]">: {data.approvalInfo || 'Staff Gudang'}</span>
                          </div>
                          {data.approvalDate && (
                            <div className="flex">
                              <span className="w-32 text-[#64748B] font-medium">Tanggal Approval</span>
                              <span className="font-semibold text-[#0F172A]">: {data.approvalDate}</span>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Items Table */}
              <div className={`my-4 ${isIncoming ? 'receipt-section' : ''}`}>
                <table className="w-full border-collapse border border-[#0F172A] text-xs">
                  <thead>
                    <tr className="bg-[#0F172A] text-white">
                      <th className="border border-[#0F172A] py-2 px-2 text-center w-10 font-bold">No</th>
                      <th className="border border-[#0F172A] py-2 px-3 text-left font-bold">Deskripsi Barang</th>
                      <th className="border border-[#0F172A] py-2 px-3 text-center w-24 font-bold">Kuantitas</th>
                      <th className="border border-[#0F172A] py-2 px-3 text-right w-28 font-bold">
                        {isIncoming ? 'Harga Beli per Unit' : data.printableRequest ? 'Harga Katalog per Unit' : 'Harga Satuan'}
                      </th>
                      <th className="border border-[#0F172A] py-2 px-3 text-right w-28 font-bold">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length > 0 ? (
                      items.map((item) => (
                        <tr key={item.no} className="border-b border-[#CBD5E1]">
                          <td className="border border-[#CBD5E1] py-2 px-2 text-center font-mono">
                            {item.no}
                          </td>
                          <td className="border border-[#CBD5E1] py-2 px-3 font-semibold text-[#0F172A]">
                            {item.itemName}
                          </td>
                          <td className="border border-[#CBD5E1] py-2 px-3 text-center font-bold">
                            {item.quantity} pcs
                          </td>
                          <td className="border border-[#CBD5E1] py-2 px-3 text-right text-[#475569] font-mono">
                            {formatRupiah(item.price)}
                          </td>
                          <td className="border border-[#CBD5E1] py-2 px-3 text-right font-bold text-[#0F172A] font-mono">
                            {formatRupiah(item.subtotal)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-[#64748B] italic">
                          Tidak ada rincian barang.
                        </td>
                      </tr>
                    )}

                    {/* Total Summary Row */}
                    <tr className="bg-[#F1F5F9] font-bold border-t-2 border-[#0F172A]">
                      <td colSpan={2} className="border border-[#CBD5E1] py-2.5 px-3 text-right uppercase tracking-wider">
                        Total Rangkuman:
                      </td>
                      <td className="border border-[#CBD5E1] py-2.5 px-3 text-center font-black text-[#0F172A]">
                        {totalQty} pcs
                      </td>
                      <td className="border border-[#CBD5E1] py-2.5 px-3 text-right">
                        Grand Total:
                      </td>
                      <td className="border border-[#CBD5E1] py-2.5 px-3 text-right font-black text-sm text-[#0F172A] font-mono">
                        {formatRupiah(totalAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Terbilang Box */}
              <div className={`p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-[6px] my-3 text-xs ${isIncoming ? 'receipt-section' : ''}`}>
                <span className="font-semibold text-[#475569]">Terbilang: </span>
                <span className="font-bold italic text-[#0F172A]">
                  "{terbilangRupiah(totalAmount)}"
                </span>
              </div>

              {/* Catatan Standar */}
              <div className="text-[11px] text-[#64748B] space-y-0.5 mt-2">
                <p>• Catatan: Barang telah diverifikasi fisik dan kuantitasnya sesuai prosedur standar operasional gudang.</p>
                <p>• Segala bentuk retur atau klaim selisih wajib menyertakan lembar asli dokumen transaksi ini.</p>
              </div>
            </div>

            {/* Signature Block (Tanda Tangan 3 Kolom Standar Indonesia) */}
            <div className={`pt-8 border-t border-[#CBD5E1] mt-8 ${isIncoming ? 'receipt-signature' : ''}`}>
              <div className="grid grid-cols-3 gap-6 text-center text-xs">
                {/* Kolom 1 */}
                <div className={`flex flex-col justify-between h-28 ${isIncoming ? 'signature-cell' : ''}`}>
                  <span className="font-medium text-[#475569]">
                    {isIncoming ? 'Diserahkan Oleh (Pemasok / Driver)' : 'Diterima Oleh (Pemohon / Outlet)'}
                  </span>
                  <div className="mt-12">
                    <div className="border-b border-[#0F172A] w-4/5 mx-auto"></div>
                    <span className="text-[11px] text-[#475569] mt-1 block">
                      ( {isIncoming ? (data.vendorName || 'Pihak Vendor') : (data.requesterName || 'Pemohon')} )
                    </span>
                  </div>
                </div>

                {/* Kolom 2 */}
                <div className={`flex flex-col justify-between h-28 ${isIncoming ? 'signature-cell' : ''}`}>
                  <span className="font-medium text-[#475569]">
                    Diterima &amp; Diperiksa (Staff Gudang)
                  </span>
                  <div className="mt-12">
                    <div className="border-b border-[#0F172A] w-4/5 mx-auto"></div>
                    <span className="text-[11px] text-[#475569] mt-1 block">
                      ( {data.createdBy || 'Staff Gudang HD'} )
                    </span>
                  </div>
                </div>

                {/* Kolom 3 */}
                <div className={`flex flex-col justify-between h-28 ${isIncoming ? 'signature-cell' : ''}`}>
                  <span className="font-medium text-[#475569]">
                    Mengetahui &amp; Verifikasi (SPV / Manager)
                  </span>
                  <div className="mt-12">
                    <div className="border-b border-[#0F172A] w-4/5 mx-auto"></div>
                    <span className="text-[11px] text-[#475569] mt-1 block">
                      ( Kepala Logistik &amp; Gudang )
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Actions Footer (Hidden in print) */}
        <div className="no-print p-4 bg-[#F8FAFC] border-t border-[#DDE5F0] flex items-center justify-between">
          <div className="text-xs text-[#60708C]">
            *Format dokumen telah dioptimalkan secara otomatis untuk kertas ukuran <strong>A4 Portrait</strong>.
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-gray-100 text-[#17233D] font-bold text-xs rounded-[14px] border border-[#DDE5F0] transition-colors"
            >
              Tutup
            </button>
            <button
              id="btn-bottom-print"
              onClick={handlePrint}
              className="inline-flex items-center space-x-1.5 px-5 py-2 bg-[#ED002B] hover:bg-[#d60027] text-white text-xs font-bold rounded-[14px] shadow-sm transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak Kertas A4</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
