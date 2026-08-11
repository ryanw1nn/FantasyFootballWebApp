import { useState, useEffect } from 'react';

/**
 * Persisted show/hide state for a table's optional columns.
 * `columns` is an array of { key, label, defaultVisible? } for the toggleable
 * columns only — required columns (rank, name, etc.) never go through this.
 * `defaultVisible` defaults to true when omitted.
 */
export default function useColumnVisibility(storageKey, columns) {
  const [visible, setVisible] = useState(() => {
    const defaults = Object.fromEntries(columns.map((c) => [c.key, c.defaultVisible !== false]));
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      return stored ? { ...defaults, ...stored } : defaults;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(visible));
  }, [storageKey, visible]);

  const toggle = (key) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return [visible, toggle];
}
