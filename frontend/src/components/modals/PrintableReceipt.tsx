import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bluetooth, Printer, X, Receipt } from 'lucide-react';
import { formatRupiah, formatDateIndo } from '../../lib/format.ts';
import { DEFAULT_DELIVERY_ORDER_TEMPLATE, useDeliveryOrderTemplate, type DeliveryOrderTemplate } from '../../lib/printTemplate.ts';
import { receiptEscPos, receiptLines, receiptTotal } from '../../lib/escpos.ts';
import { ReceiptPrinterError, forgetPrinter, isAndroid, isIos, printViaBluetooth, printViaRawbt, printViaSerial, savedPrinterKind, savedPrinterName, supportsBluetooth, supportsSerial } from '../../lib/receiptPrinter.ts';

// Shop-style receipt (struk) of an approved outlet request, for 58 mm or 80 mm
// thermal printers. The wording comes from the "Struk belanja" part of the
// print template; the lines, quantities and prices from the request itself.

interface PrintableReceiptProps {
  isOpen: boolean;
  onClose: () => void;
  data: any;
  // Prints with this template instead of the saved one (admin "Coba cetak struk").
  template?: DeliveryOrderTemplate;
}

// Printable width of the paper: the printer leaves about 5 mm unprinted on
// each side of a 58 mm roll and 4 mm on an 80 mm roll.
export const receiptContentWidth = (paperWidth: number) => (paperWidth === 80 ? 72 : 48);

// Same approach as the A4 dialog: everything else in <body> leaves the layout,
// and the page is as wide as the roll with no margins for the browser's header.
const printCss = (paperWidth: number) => `
  @media print {
    @page { size: ${paperWidth}mm auto; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
    body > *:not(.hd-print-root) { display: none !important; }
    .hd-print-root .no-print { display: none !important; }
    .hd-print-root, .hd-print-root .hd-print-backdrop, .hd-print-root .hd-print-dialog, .hd-print-root .hd-print-scroll {
      position: static !important; inset: auto !important; display: block !important;
      width: auto !important; max-width: none !important; height: auto !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; overflow: visible !important;
      background: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; backdrop-filter: none !important;
    }
    #printable-receipt {
      width: ${paperWidth}mm !important; padding: 3mm ${(paperWidth - receiptContentWidth(paperWidth)) / 2}mm !important;
      margin: 0 !important; box-shadow: none !important; border: 0 !important; color: #000 !important; background: #fff !important;
    }
  }
`;

const Divider = () => <div className="my-1.5 border-t border-dashed border-black" />;
const Row: React.FC<{ left: React.ReactNode; right: React.ReactNode; strong?: boolean }> = ({ left, right, strong }) => (
  <div className={`flex justify-between gap-2 ${strong ? 'font-bold' : ''}`}><span className="min-w-0 break-words">{left}</span><span className="shrink-0 text-right">{right}</span></div>
);

export const ReceiptDocument: React.FC<{ data: any; template: DeliveryOrderTemplate; printTimestamp?: string; preview?: boolean }> = ({ data, template, printTimestamp, preview }) => {
  const settings = template.receipt ?? DEFAULT_DELIVERY_ORDER_TEMPLATE.receipt;
  const { header } = template;
  const lines = receiptLines(data);
  const totalQty = lines.reduce((sum: number, line: { quantity: number }) => sum + line.quantity, 0);
  const total = receiptTotal(data, lines);
  const timestamp = printTimestamp || new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const width = receiptContentWidth(settings.paperWidth);
  const small = settings.paperWidth === 58;

  return (
    <div
      id={preview ? undefined : 'printable-receipt'}
      className={`bg-white font-mono leading-snug text-black ${small ? 'text-[10px]' : 'text-[11px]'}`}
      style={{ width: `${width}mm`, boxSizing: 'content-box', padding: '3mm' }}
      data-paper-width={settings.paperWidth}
    >
      <div className="text-center">
        {header.logoUrl
          ? <img src={header.logoUrl} alt={header.brandName} className="mx-auto mb-1 max-h-12 max-w-full object-contain" />
          : <div className={`font-bold ${small ? 'text-[13px]' : 'text-[15px]'}`}>{header.brandName}</div>}
        {header.address && <div>{header.address}</div>}
        {header.hotline && <div>Telp: {header.hotline}</div>}
      </div>
      <Divider />
      <dl className="grid grid-cols-[auto_1fr] gap-x-1">
        <dt>No</dt><dd className="break-words">: {data.requestCode}</dd>
        <dt>Tanggal</dt><dd>: {formatDateIndo(data.requestDate)}</dd>
        <dt>Outlet</dt><dd className="break-words">: {data.requesterName || data.outletName || '-'}</dd>
        {settings.showApprovedBy && <><dt>Disetujui</dt><dd className="break-words">: {data.approvalInfo || 'Staff Gudang'}</dd></>}
      </dl>
      <Divider />
      {lines.length ? lines.map((line: { name: string; quantity: number; price: number; subtotal: number }, index: number) => (
        <div key={index} className="mb-1">
          <div className="break-words">{line.name}</div>
          {settings.showPrices
            ? <Row left={<span className="pl-2">{line.quantity} x {formatRupiah(line.price)}</span>} right={formatRupiah(line.subtotal)} />
            : <Row left="" right={`${line.quantity} pcs`} />}
        </div>
      )) : <div className="text-center">Tidak ada barang.</div>}
      <Divider />
      <Row left={`Total qty (${lines.length} item)`} right={`${totalQty} pcs`} />
      {settings.showPrices && <Row strong left="TOTAL" right={formatRupiah(total)} />}
      <Divider />
      {settings.footer && <div className="text-center">{settings.footer}</div>}
      <div className="mt-1 text-center">Dicetak {timestamp}</div>
    </div>
  );
};

export const PrintableReceipt: React.FC<PrintableReceiptProps> = ({ isOpen, onClose, data, template }) => {
  const savedTemplate = useDeliveryOrderTemplate(isOpen && !template);
  const activeTemplate = template || savedTemplate;
  const ready = Boolean(activeTemplate);
  const paperWidth = (activeTemplate?.receipt ?? DEFAULT_DELIVERY_ORDER_TEMPLATE.receipt).paperWidth;
  const docCode = data?.requestCode || '';

  useEffect(() => {
    if (!isOpen) return;
    const original = document.title;
    const before = () => { document.title = docCode ? `Struk ${docCode}` : original; };
    const after = () => { document.title = original; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); document.title = original; };
  }, [isOpen, docCode]);

  if (!isOpen || !data) return null;
  const handlePrint = () => { if (ready) window.print(); };
  const bytes = () => receiptEscPos(data, activeTemplate || DEFAULT_DELIVERY_ORDER_TEMPLATE);

  return createPortal(
    <div className="hd-print-root">
      <style>{printCss(paperWidth)}</style>
      <div className="hd-modal-backdrop hd-print-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
        <div className="hd-print-dialog bg-white w-full max-w-md rounded-xl overflow-hidden flex flex-col max-h-[96vh]" onClick={(e) => e.stopPropagation()}>
          <div className="no-print flex items-center justify-between gap-2 px-4 py-3 border-b border-[#E2E8F0] text-[#1E293B]">
            <div className="flex min-w-0 items-center gap-2">
              <Receipt className="w-4 h-4 shrink-0 text-[#FFB800]" />
              <span className="truncate text-xs sm:text-sm font-bold">Preview Struk {paperWidth} mm • {docCode}</span>
            </div>
            <button onClick={onClose} className="hd-button hd-button--ghost hd-icon-button" title="Tutup" aria-label="Tutup"><X className="w-4 h-4" /></button>
          </div>
          <div className="hd-print-scroll overflow-y-auto p-4 bg-[#E2E8F0]/50 flex justify-center">
            <div className="shadow-md">
              <ReceiptDocument data={data} template={activeTemplate || DEFAULT_DELIVERY_ORDER_TEMPLATE} />
            </div>
          </div>
          <DirectPrint ready={ready} bytes={bytes} />
          <div className="no-print p-3 bg-[#F8FAFC] border-t border-[#DDE5F0] flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[#60708C]">Cetak lewat dialog browser: pilih printer struk dan kertas {paperWidth} mm.</p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="hd-button hd-button--secondary">Tutup</button>
              <button id="btn-print-receipt" onClick={handlePrint} disabled={!ready} className="hd-button hd-button--secondary">
                <Printer className="w-3.5 h-3.5" />
                <span>{ready ? 'Cetak via dialog' : 'Memuat pengaturan…'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// Straight to a thermal printer: Bluetooth LE, a COM port on a computer, or the
// RawBT app on Android. The first print asks which printer; later prints reuse it.
const DirectPrint: React.FC<{ ready: boolean; bytes: () => Uint8Array }> = ({ ready, bytes }) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [printer, setPrinter] = useState<string | null>(() => savedPrinterName());
  const bluetooth = supportsBluetooth(), serial = supportsSerial() && !isAndroid(), android = isAndroid();

  const send = async (how: 'bluetooth' | 'serial', choose = false) => {
    setBusy(true); setMessage(null);
    try {
      const name = how === 'bluetooth' ? await printViaBluetooth(bytes(), choose) : await printViaSerial(bytes(), choose);
      setPrinter(name); setMessage({ tone: 'ok', text: `Struk terkirim ke ${name}.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof ReceiptPrinterError ? error.message : 'Struk gagal dikirim ke printer. Coba lagi.' });
    } finally { setBusy(false); }
  };
  const change = () => { forgetPrinter(); setPrinter(null); setMessage(null); };

  return (
    <div className="no-print border-t border-[#DDE5F0] bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button id="btn-print-receipt-bluetooth" type="button" onClick={() => void send(serial && savedPrinterKind() === 'serial' ? 'serial' : 'bluetooth')} disabled={!ready || busy || (!bluetooth && !(serial && savedPrinterKind() === 'serial'))} className="hd-button hd-button--primary">
          <Bluetooth className="w-3.5 h-3.5" />
          <span>{busy ? 'Mengirim…' : 'Cetak langsung'}{!busy && <span className="hidden sm:inline"> (Bluetooth)</span>}</span>
        </button>
        {serial && <button type="button" onClick={() => void send('serial')} disabled={!ready || busy} className="hd-button hd-button--secondary">Lewat port COM (PC)</button>}
        {android && <button type="button" onClick={() => printViaRawbt(bytes())} disabled={!ready || busy} className="hd-button hd-button--secondary">Lewat aplikasi RawBT</button>}
      </div>
      <p className="text-[11px] text-[#60708C]">
        {printer ? <>Printer: <strong>{printer}</strong> · <button type="button" className="underline" onClick={change}>Ganti printer</button></>
          : bluetooth ? 'Pertama kali: nyalakan printer dan Bluetooth, lalu pilih printernya dari daftar.'
          : isIos() ? 'iPhone/iPad: buka hdhub di browser Bluefy untuk cetak langsung lewat Bluetooth.'
          : 'Browser ini tidak mendukung Bluetooth. Pakai Chrome atau Edge.'}
      </p>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-rose-700' : 'text-[#1B9357]'}`}>{message.text}</p>}
    </div>
  );
};
