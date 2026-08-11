import React from 'react';

/**
 * Chip used for table badges (championships, PF leader, playoff rounds, etc).
 * variant "accent" = standard stat/award chip
 * variant "gold"   = championship flare — reserved for title wins, especially postseason
 */
export default function Badge({ children, icon: Icon, variant = 'accent', ...props }) {
  const variants = {
    accent: 'bg-accent-50 text-accent-700 border-accent-200 font-semibold',
    gold: 'bg-amber-100 text-amber-800 border-amber-300 font-bold shadow-sm',
  };

  return (
    <span
      className={`inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-xs border ${variants[variant]}`}
      {...props}
    >
      {Icon && <Icon size={12} strokeWidth={2.5} />}
      {children}
    </span>
  );
}
