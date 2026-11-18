import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Printer, Receipt } from 'lucide-react';

export type PrintFormat = 'a4' | 'receipt';

// One "Cetak" button that opens a choice between the A4 document and the
// receipt (struk). Clicks never reach the card or row around it.
export const PrintMenu: React.FC<{ id?: string; onSelect: (format: PrintFormat) => void; className?: string; buttonClassName?: string }> = ({ id, onSelect, className, buttonClassName }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const choose = (format: PrintFormat) => (event: React.MouseEvent) => { event.stopPropagation(); setOpen(false); onSelect(format); };

  return (
    <div ref={root} className={`relative inline-block ${className || ''}`} onClick={(event) => event.stopPropagation()}>
      <button id={id} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}
        className={buttonClassName || 'hd-button hd-button--secondary !min-h-[30px] !px-2.5 !py-1 !text-[11px]'}>
        <Printer className="h-3.5 w-3.5" />
        <span>Cetak</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white py-1 text-left shadow-lg">
          <button type="button" role="menuitem" onClick={choose('a4')} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#1E293B] hover:bg-[#F8FAFC]">
            <FileText className="h-3.5 w-3.5 text-[#64748B]" /> Cetak A4
          </button>
          <button type="button" role="menuitem" onClick={choose('receipt')} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#1E293B] hover:bg-[#F8FAFC]">
            <Receipt className="h-3.5 w-3.5 text-[#64748B]" /> Cetak Struk
          </button>
        </div>
      )}
    </div>
  );
};
