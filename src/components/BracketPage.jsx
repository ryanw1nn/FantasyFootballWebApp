import React from 'react';
import { useOutletContext } from 'react-router-dom';

import PlayoffBracket from './PlayoffBracket';

/**
 * The bracket's route. It reads the year the toolbar is showing and hands it
 * down with that season out of the layout's payload, so PlayoffBracket takes
 * both as props and never learns where either comes from — or fetches.
 */
export default function BracketPage() {
  const { seasons, year } = useOutletContext();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      {year === null ? (
        <p className="text-slate-500 text-sm">No seasons to show.</p>
      ) : (
        <PlayoffBracket year={year} seasonData={seasons[year]} />
      )}
    </div>
  );
}
