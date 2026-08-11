import React, { useState, useRef, useEffect } from 'react';
import { Columns3 } from 'lucide-react';

/**
 * "Columns" dropdown — lets the user show/hide optional table columns.
 * Selection is owned by the caller (see useColumnVisibility) so it persists.
 */
export default function ColumnMenu({ columns, visible, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm font-medium text-slate-700"
      >
        <Columns3 size={16} />
        Columns
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border border-slate-200 p-3 z-50">
          <h3 className="font-semibold text-slate-900 mb-2 text-sm">Show Columns</h3>
          {columns.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={visible[key] !== false}
                onChange={() => onToggle(key)}
                className="rounded border-slate-300 text-accent-600 focus:ring-accent-500"
              />
              <span className="text-sm text-slate-700">{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
