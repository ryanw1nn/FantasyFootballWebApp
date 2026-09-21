import React from 'react';
import { NavLink } from 'react-router-dom';

const BASE = 'px-4 py-2 rounded-lg font-medium text-sm transition-colors inline-flex items-center gap-2';
const VARIANTS = {
  solid: 'bg-accent-600 text-white hover:bg-accent-700',
  outline: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  ghost: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
};

function buttonClasses(variant, className) {
  return `${BASE} ${VARIANTS[variant]} ${className}`;
}

/**
 * Shared button used across toolbars/controls.
 * variant "solid" = accent-filled (active/primary state)
 * variant "outline" = neutral bordered (default/inactive state)
 */
export default function Button({ variant = 'outline', className = '', children, ...props }) {
  return (
    <button className={buttonClasses(variant, className)} {...props}>
      {children}
    </button>
  );
}

/**
 * A Button that is a link. The views are addresses now, so the controls that
 * move between them are links — they open in a new tab and can be copied and
 * sent. It wears `activeVariant` while its own URL is the one showing, which is
 * how the toolbar knows which view is selected without being told.
 */
export function LinkButton({ to, variant = 'outline', activeVariant = variant, className = '', children }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) => buttonClasses(isActive ? activeVariant : variant, className)}
    >
      {children}
    </NavLink>
  );
}
