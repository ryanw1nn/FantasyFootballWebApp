import React from 'react';
import { useOutletContext } from 'react-router-dom';

import PlayoffBracket from './PlayoffBracket';

/**
 * The bracket's route. It reads the year the toolbar is showing and hands it
 * down, so PlayoffBracket keeps taking `year` as a prop and never learns where
 * the year comes from.
 */
export default function BracketPage() {
  const { year } = useOutletContext();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      {year === null ? (
        <p className="text-slate-500 text-sm">No seasons to show.</p>
      ) : (
        <PlayoffBracket year={year} />
      )}
    </div>
  );
}
