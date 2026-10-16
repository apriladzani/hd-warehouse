import React, { useState, useEffect } from 'react';
import { Calendar, RotateCcw } from 'lucide-react';

interface DateFilterProps {
  startDate: string;
  endDate: string;
  onFilter: (start: string, end: string) => void;
  onReset: () => void;
  className?: string;
}

export const DateFilter: React.FC<DateFilterProps> = ({
  startDate: initialStart,
  endDate: initialEnd,
  onFilter,
  onReset,
  className = '',
}) => {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);

  useEffect(() => {
    setStart(initialStart);
  }, [initialStart]);

  useEffect(() => {
    setEnd(initialEnd);
  }, [initialEnd]);

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    onFilter(start, end);
  };

  const handleReset = () => {
    setStart('');
    setEnd('');
    onReset();
  };

  return (
    <form
      onSubmit={handleApply}
      className={`flex items-center gap-1 sm:gap-2 text-xs w-full sm:w-auto ${className}`}
    >
      <div className="flex items-center space-x-1 sm:space-x-1.5 bg-white px-1.5 py-0.5 sm:px-3 sm:py-1.5 rounded-[10px] sm:rounded-[18px] border border-[#DDE5F0] shadow-2xs flex-1 sm:flex-initial min-h-[28px] sm:min-h-[36px]">
        <Calendar className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-[#60708C] shrink-0" />
        <input
          id="date-filter-start"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="Dari"
          className="text-[9px] sm:text-xs text-[#17233D] bg-transparent outline-none cursor-pointer flex-1 sm:flex-none max-w-[95px] sm:max-w-[125px] p-0"
        />
        <span className="text-[#60708C] text-[9px] sm:text-xs shrink-0">—</span>
        <input
          id="date-filter-end"
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          placeholder="Sampai"
          className="text-[9px] sm:text-xs text-[#17233D] bg-transparent outline-none cursor-pointer flex-1 sm:flex-none max-w-[95px] sm:max-w-[125px] p-0"
        />
      </div>

      <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
        <button
          id="btn-apply-filter"
          type="submit"
          className="px-2 sm:px-3.5 py-0.5 sm:py-1.5 bg-[#ED002B] hover:bg-[#d60027] text-white text-[10px] sm:text-xs font-bold rounded-[8px] sm:rounded-[16px] transition-colors shadow-2xs min-h-[28px] sm:min-h-[36px] cursor-pointer text-center"
        >
          Filter
        </button>

        {(start || end) && (
          <button
            id="btn-reset-filter"
            type="button"
            onClick={handleReset}
            className="inline-flex items-center justify-center px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 bg-white hover:bg-[#F8FAFC] text-[#60708C] hover:text-[#17233D] text-[10px] sm:text-xs font-semibold rounded-[8px] sm:rounded-[16px] border border-[#DDE5F0] transition-colors min-h-[28px] sm:min-h-[36px] cursor-pointer"
            title="Reset Tanggal"
          >
            <RotateCcw className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          </button>
        )}
      </div>
    </form>
  );
};
