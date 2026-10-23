import React, { useState, useEffect } from 'react';
import { Calendar, RotateCcw } from 'lucide-react';
import { Button, IconButton } from './UI.tsx';

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
      className={`hd-date-filter flex flex-wrap items-center gap-2 text-xs w-full sm:w-auto ${className}`}
    >
      <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-[#E2E8F0] flex-1 sm:flex-initial min-h-[34px]">
        <Calendar className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-[#64748B] shrink-0" />
        <input
          id="date-filter-start"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="Dari"
          aria-label="Dari tanggal"
          className="text-xs text-[#1E293B] bg-transparent outline-none cursor-pointer flex-1 sm:flex-none w-[112px] p-0"
        />
        <span className="text-[#64748B] text-[10px] sm:text-xs shrink-0">—</span>
        <input
          id="date-filter-end"
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          placeholder="Sampai"
          aria-label="Sampai tanggal"
          className="text-xs text-[#1E293B] bg-transparent outline-none cursor-pointer flex-1 sm:flex-none w-[112px] p-0"
        />
      </div>

      <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
        <Button
          id="btn-apply-filter"
          type="submit"
          variant="primary"
        >
          Filter
        </Button>

        {(start || end) && (
          <IconButton
            id="btn-reset-filter"
            type="button"
            onClick={handleReset}
            variant="secondary"
            aria-label="Reset tanggal"
            title="Reset Tanggal"
          >
            <RotateCcw className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          </IconButton>
        )}
      </div>
    </form>
  );
};
