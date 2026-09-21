// The league's name in the header, and the way to another league. Switching is
// a navigation, not a state change: the slug lives in the URL, so moving to
// another league means moving to another address, and the provider follows it.

import React from 'react';
import { useMatch, useNavigate } from 'react-router-dom';

import { useLeague } from '../context/LeagueContext';
import { resolveYear } from '../hooks/useSeasonYear';
import { alltimePath, bracketPath, seasonPath } from '../routes';

// The views that mean the same thing in any league. A player page names a
// person, and the leagues are separate people; the editor needs an unlock that
// belongs to one league. Both land on the target's season view instead.
const CROSSING_VIEWS = {
  season: seasonPath,
  alltime: alltimePath,
  bracket: bracketPath,
};

/**
 * Where a switch to `target` lands, from `view` with `urlYear` in the address.
 *
 * The view crosses when it can. The year is re-resolved against the target's
 * own seasons: kept if the target has it, its latest if not, and written into
 * the URL either way. A URL with no year keeps meaning "the latest" and gets
 * none.
 */
export function leagueSwitchPath(target, view, urlYear) {
  const pathFor = CROSSING_VIEWS[view] ?? seasonPath;
  if (urlYear === null) return pathFor(target.slug);

  // season_years arrives oldest first; resolveYear wants newest first.
  const years = [...target.season_years].sort((a, b) => b - a);
  return pathFor(target.slug, resolveYear(String(urlYear), years));
}

export default function LeagueSwitcher({ urlYear, className = '' }) {
  const { slug, leagues } = useLeague();
  const navigate = useNavigate();
  const view = useMatch('/l/:slug/:view/*')?.params.view;

  // Not loaded is not "no leagues": draw nothing rather than an empty select.
  if (leagues === null) return null;

  // A slug the list doesn't have is the 404 page's to answer, not this one's.
  const currentLeague = leagues.find((league) => league.slug === slug);
  if (!currentLeague) return null;

  // One league is not a choice. The same component becomes a select the day a
  // second league exists, with no second visit.
  if (leagues.length < 2) {
    return <span className={className}>{currentLeague.name}</span>;
  }

  function switchTo(nextSlug) {
    const target = leagues.find((league) => league.slug === nextSlug);
    if (target) navigate(leagueSwitchPath(target, view, urlYear));
  }

  return (
    <select
      aria-label="League"
      value={slug}
      onChange={(e) => switchTo(e.target.value)}
      className={`bg-transparent border-none cursor-pointer focus:ring-2 focus:ring-accent-500 rounded-lg ${className}`}
    >
      {leagues.map((league) => (
        <option key={league.slug} value={league.slug}>
          {league.name}
        </option>
      ))}
    </select>
  );
}
