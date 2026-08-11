import React from 'react';

/**
 * Shared button used across toolbars/controls.
 * variant "solid" = accent-filled (active/primary state)
 * variant "outline" = neutral bordered (default/inactive state)
 */
export default function Button({ variant = 'outline', className = '', children, ...props }) {
  const base = 'px-4 py-2 rounded-lg font-medium text-sm transition-colors inline-flex items-center gap-2';
  const variants = {
    solid: 'bg-accent-600 text-white hover:bg-accent-700',
    outline: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    ghost: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  };

  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
