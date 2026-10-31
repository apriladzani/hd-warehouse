import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, Search, Store, X } from 'lucide-react';
import { effectiveOutletIds, outletFilterLabel, outletName, type OutletOption } from '../../finance/outletFilter.ts';

// Multi-select outlet filter. A locked filter (Outlet account) shows its outlet only.
export function OutletFilter({ outlets, selected, onChange, lockedOutletId = null }: { outlets: OutletOption[]; selected: number[]; onChange: (ids: number[]) => void; lockedOutletId?: number | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  if (lockedOutletId != null) return <div className="fin-outlet-filter"><span className="fin-outlet-button fin-outlet-button--locked" title="Akun Outlet hanya dapat melihat outlet sendiri."><Lock size={14} />{outletName(lockedOutletId, outlets)}</span></div>;

  const shown = outlets.filter(o => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  const chips = effectiveOutletIds(selected, outlets);
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return <div className="fin-outlet-filter" ref={root}>
    <button type="button" className="fin-outlet-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)}><Store size={14} />{outletFilterLabel(selected, outlets)}<ChevronDown size={14} /></button>
    {open && <div className="fin-outlet-menu" role="listbox" aria-multiselectable="true" aria-label="Pilih outlet">
      <label className="fin-outlet-search"><Search size={14} /><input autoFocus type="search" placeholder="Cari outlet…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="fin-outlet-actions"><button type="button" onClick={() => onChange(outlets.map(o => o.id))}>Pilih semua</button><button type="button" onClick={() => onChange([])}>Kosongkan</button></div>
      <div className="fin-outlet-options">{shown.length ? shown.map(o => <label key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />{o.name}</label>) : <p>Outlet tidak ditemukan.</p>}</div>
    </div>}
    {chips.length > 0 && <ul className="fin-outlet-chips" aria-label="Outlet terpilih">{chips.map(id => <li key={id}>{outletName(id, outlets)}<button type="button" aria-label={`Hapus ${outletName(id, outlets)}`} onClick={() => onChange(chips.filter(x => x !== id))}><X size={12} /></button></li>)}</ul>}
  </div>;
}
