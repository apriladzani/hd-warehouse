import React, { useState } from 'react';
import { X, Calendar, User, Building2, CreditCard, Printer } from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge.tsx';
import { formatRupiah, formatDateIndo } from '../../lib/format.ts';
import { PrintableTransactionA4 } from './PrintableTransactionA4.tsx';

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'incoming' | 'outgoing';
  data: any;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  isOpen,
  onClose,
  type,
  data,
}) => {
  const [showPrintA4, setShowPrintA4] = useState(false);

  if (!isOpen || !data) return null;

  const isIncoming = type === 'incoming';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-xs">
        <div
          className="bg-white w-full max-w-2xl rounded-[20px] sm:rounded-[22px] border border-[#DDE5F0] shadow-lg overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-3.5 sm:px-6 py-2.5 sm:py-4 border-b border-[#DDE5F0]">
            <div>
              <div className="flex items-center space-x-1.5 sm:space-x-3">
                <span className="text-sm sm:text-xl font-bold text-[#17233D] truncate">
                  {isIncoming ? data.transactionCode : data.requestCode}
                </span>
                <StatusBadge
                  status={isIncoming ? 'Incoming' : data.status || 'Pending'}
                />
              </div>
              <p className="text-[10px] sm:text-xs text-[#60708C] mt-0.5">
                {isIncoming ? 'Detail Transaksi Barang Masuk' : 'Detail Transaksi Permintaan Barang'}
              </p>
            </div>
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <button
                id="btn-print-a4-modal-header"
                onClick={() => setShowPrintA4(true)}
                className="inline-flex items-center space-x-1 px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[14px] shadow-xs transition-all"
                title="Cetak format kertas A4"
              >
                <Printer className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Cetak A4</span>
              </button>
              <button
                id="close-transaction-modal"
                onClick={onClose}
                className="p-1 sm:p-2 text-[#60708C] hover:text-[#17233D] rounded-full hover:bg-[#F8FAFC] transition-colors"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

        {/* Modal Body / Metadata Header */}
        <div className="p-3 sm:p-6 overflow-y-auto space-y-3 sm:space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 p-2.5 sm:p-4 rounded-[14px] sm:rounded-[18px] bg-[#F8FAFC] border border-[#DDE5F0]">
            <div>
              <span className="text-[9px] sm:text-[11px] text-[#60708C] block uppercase tracking-wider font-semibold">
                Tanggal
              </span>
              <div className="flex items-center space-x-1 sm:space-x-1.5 mt-0.5 sm:mt-1 text-[11px] sm:text-sm font-medium text-[#17233D]">
                <Calendar className="w-3.5 h-3.5 text-[#60708C] shrink-0" />
                <span className="truncate">{formatDateIndo(isIncoming ? data.transactionDate : data.requestDate)}</span>
              </div>
            </div>

            <div>
              <span className="text-[9px] sm:text-[11px] text-[#60708C] block uppercase tracking-wider font-semibold">
                {isIncoming ? 'Vendor' : 'Pemohon'}
              </span>
              <div className="flex items-center space-x-1 sm:space-x-1.5 mt-0.5 sm:mt-1 text-[11px] sm:text-sm font-medium text-[#17233D]">
                {isIncoming ? (
                  <>
                    <Building2 className="w-3.5 h-3.5 text-[#60708C] shrink-0" />
                    <span className="truncate">{data.vendorName || data.vendorCode}</span>
                  </>
                ) : (
                  <>
                    <User className="w-3.5 h-3.5 text-[#60708C] shrink-0" />
                    <span className="truncate">{data.requesterName}</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <span className="text-[9px] sm:text-[11px] text-[#60708C] block uppercase tracking-wider font-semibold">
                Pembayaran
              </span>
              <div className="flex items-center space-x-1 sm:space-x-1.5 mt-0.5 sm:mt-1 text-[11px] sm:text-sm font-medium text-[#17233D]">
                <CreditCard className="w-3.5 h-3.5 text-[#60708C] shrink-0" />
                <span>{data.paymentMethod || 'Transfer'}</span>
              </div>
            </div>

            <div>
              <span className="text-[9px] sm:text-[11px] text-[#60708C] block uppercase tracking-wider font-semibold">
                Total Nominal
              </span>
              <span className="mt-0.5 sm:mt-1 text-xs sm:text-sm font-bold text-[#ED002B] block truncate">
                {formatRupiah(isIncoming ? data.totalAmount : data.totalApprovedAmount || data.totalAmount)}
              </span>
            </div>
          </div>

          {/* Items Section */}
          <div>
            <h4 className="text-[11px] sm:text-sm font-bold text-[#17233D] mb-1.5 sm:mb-3">
              Daftar Barang ({data.items?.length || 0} Barang)
            </h4>

            <div className="border border-[#DDE5F0] rounded-[14px] sm:rounded-[18px] overflow-hidden overflow-x-auto">
              <table className="w-full text-left border-collapse text-[10px] sm:text-xs min-w-[280px]">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#DDE5F0] text-[#60708C] font-semibold">
                    <th className="py-2 px-2.5 sm:py-3 sm:px-4">Nama Barang &amp; Vendor</th>
                    {isIncoming ? (
                      <>
                        <th className="py-2 px-2 sm:py-3 sm:px-4 text-center">Qty</th>
                        <th className="py-2 px-2 sm:py-3 sm:px-4 text-right">Harga Beli / Item</th>
                        <th className="py-2 px-2.5 sm:py-3 sm:px-4 text-right">Subtotal</th>
                        <th className="py-2 px-2.5 sm:py-3 sm:px-4 text-right text-[#1B9357]">
                          Rata-Rata Setelah Transaksi
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="py-2 px-2 sm:py-3 sm:px-4 text-center">Diminta</th>
                        <th className="py-2 px-2 sm:py-3 sm:px-4 text-center">Disetujui</th>
                        <th className="py-2 px-2 sm:py-3 sm:px-4 text-right">Harga</th>
                        <th className="py-2 px-2 sm:py-3 sm:px-4 text-center">Status</th>
                        <th className="py-2 px-2.5 sm:py-3 sm:px-4 text-right">Subtotal</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE5F0]">
                  {data.items && data.items.length > 0 ? (
                    data.items.map((it: any, idx: number) => {
                      if (isIncoming) {
                        return (
                          <tr key={idx} className="hover:bg-[#F8FAFC]/60">
                            <td className="py-2.5 px-2.5 sm:py-3 sm:px-4">
                              <div className="font-semibold text-[#17233D]">{it.itemName}</div>
                              <div className="text-[10px] text-[#60708C]">
                                Vendor:{' '}
                                <span className="font-medium text-[#17233D]">
                                  {it.vendorName || data.vendorName || '-'}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 sm:py-3 sm:px-4 text-center font-mono font-bold text-[#17233D]">
                              {it.quantity} pcs
                            </td>
                            <td className="py-2.5 px-2 sm:py-3 sm:px-4 text-right font-mono text-[#60708C]">
                              {formatRupiah(it.price)}/item
                            </td>
                            <td className="py-2.5 px-2.5 sm:py-3 sm:px-4 text-right font-mono font-semibold text-[#17233D]">
                              {formatRupiah(it.subtotal || it.quantity * it.price)}
                            </td>
                            <td className="py-2.5 px-2.5 sm:py-3 sm:px-4 text-right font-mono font-bold text-[#1B9357] bg-emerald-50/40">
                              {it.avgCostAfter && it.avgCostAfter > 0
                                ? `${formatRupiah(it.avgCostAfter)}/item`
                                : formatRupiah(it.price)}
                            </td>
                          </tr>
                        );
                      }

                      // Outgoing / Request item
                      const isApproved = it.status === 'Approved';
                      const effectiveQty = isApproved ? it.approvedQuantity : it.requestedQuantity;
                      const subtotal = effectiveQty * it.price;

                      return (
                        <tr key={idx} className="hover:bg-[#F8FAFC]/60">
                          <td className="py-2 px-2.5 sm:py-3 sm:px-4 font-semibold text-[#17233D]">
                            {it.itemName}
                          </td>
                          <td className="py-2 px-2 sm:py-3 sm:px-4 text-center text-[#17233D]">
                            {it.requestedQuantity} pcs
                          </td>
                          <td className="py-2 px-2 sm:py-3 sm:px-4 text-center font-medium text-[#1B9357]">
                            {it.approvedQuantity || 0} pcs
                          </td>
                          <td className="py-2 px-2 sm:py-3 sm:px-4 text-right text-[#60708C]">
                            {formatRupiah(it.price)}
                          </td>
                          <td className="py-2 px-2 sm:py-3 sm:px-4 text-center">
                            <StatusBadge status={it.status} />
                          </td>
                          <td className="py-2 px-2.5 sm:py-3 sm:px-4 text-right font-semibold text-[#17233D]">
                            {formatRupiah(subtotal)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={isIncoming ? 5 : 6} className="py-6 text-center text-[#60708C]">
                        Tidak ada barang di dalam transaksi ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-3.5 sm:px-6 py-2.5 sm:py-4 bg-[#F8FAFC] border-t border-[#DDE5F0] flex items-center justify-between">
          <button
            id="btn-print-a4-modal-footer"
            onClick={() => setShowPrintA4(true)}
            className="inline-flex items-center space-x-1 sm:space-x-1.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-[#ED002B] hover:bg-[#d60027] text-white font-bold text-[10px] sm:text-xs rounded-[8px] sm:rounded-[14px] shadow-xs transition-all cursor-pointer"
          >
            <Printer className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Cetak Dokumen A4</span>
          </button>

          <button
            onClick={onClose}
            className="px-3.5 py-1.5 sm:px-5 sm:py-2 bg-white hover:bg-gray-50 text-[#17233D] font-medium text-[10px] sm:text-xs rounded-[8px] sm:rounded-[14px] border border-[#DDE5F0] transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>

    {showPrintA4 && (
      <PrintableTransactionA4
        isOpen={showPrintA4}
        onClose={() => setShowPrintA4(false)}
        type={type}
        data={data}
      />
    )}
  </>
  );
};
