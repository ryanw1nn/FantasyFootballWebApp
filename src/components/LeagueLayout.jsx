// Everything under /l/:slug renders inside this layout, and its whole job is to
// take the slug out of the URL and hand it to the provider. Before this, the
// slug was a constant with a default; after it, it is whatever the address bar
// says — which is what makes a league switcher a navigation rather than a state
// change.
//
// It also owns the season payload. Three of the five views are built on the
// same GET /seasons, so a view that fetched it would fetch it again on every
// navigation between those three. Fetching it here means one request per league
// visit, and it travels down the outlet rather than through a second context:
// it is route-shaped data that dies with the route.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { LeagueProvider } from '../context/LeagueContext';
import { getSeasons } from '../api/client';
import useSeasonYear from '../hooks/useSeasonYear';

export default function LeagueLayout() {
  const { slug } = useParams();

  // Null means "no answer yet" and is the spinner's condition. A failed request
  // settles on an empty object instead, because a league with no seasons and a
  // league that could not be reached draw the same blank page today — telling
  // them apart is the 404 page 5.9 owns, which is what `error` is kept for.
  const [seasons, setSeasons] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Which request is the current one. A league switch and an editor refresh can
  // both be in flight, and only the newest answer may land — awaiting the reply
  // for the league you just left and writing it into state is how a switcher
  // ends up showing the wrong league's seasons.
  const latestRequest = useRef(0);

  /**
   * Fetch the payload for the slug in the URL. Handed down as refresh() so the
   * editor can call it after a save lands — the one event that changes what the
   * other views are drawing.
   *
   * The call is awaited inside an async function rather than chained off, so a
   * slug the client refuses outright — it throws before it fetches — lands in
   * the same catch as a network failure.
   */
  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);

    try {
      const data = await getSeasons(slug);
      if (request !== latestRequest.current) return;
      setSeasons(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch seasons:', err);
      if (request !== latestRequest.current) return;
      setSeasons((current) => current ?? {});
      setError(err);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [slug]);

  // load changes identity only when the slug does, so this runs once per league
  // visit. Clearing first is what puts the spinner back up for the new league
  // rather than leaving the old one's tables on screen while it loads.
  useEffect(() => {
    setSeasons(null);
    setError(null);
    load();
  }, [load]);

  // Newest first, as numbers: the payload's keys are strings, and a select
  // whose value is a number next to options built from strings shows nothing
  // selected while the table renders fine.
  const years = useMemo(
    () => Object.keys(seasons ?? {}).map(Number).sort((a, b) => b - a),
    [seasons]
  );

  // The season every view is looking at comes from ?year=, resolved against
  // this league's seasons. It is resolved here, once, so a bad year is
  // rewritten once rather than by every view that reads it.
  const { year, urlYear, setYear } = useSeasonYear(years);

  // No key={slug}. A keyed provider is a *new* provider on every league change,
  // and the client allows exactly one 401 subscriber — a second registration
  // throws rather than quietly winning. Unkeyed, the slug arrives as a changing
  // prop, which is what the provider's session effect was written for: it
  // depends on [slug] and guards the in-flight answer so the old league's reply
  // cannot land as the new league's.
  return (
    <LeagueProvider slug={slug}>
      {seasons === null ? (
        <LoadingScreen />
      ) : (
        <Outlet context={{ seasons, loading, error, refresh: load, years, year, urlYear, setYear }} />
      )}
    </LeagueProvider>
  );
}

/**
 * The spinner App used to draw, one level up. It now guards more than a table:
 * until the payload lands there is no year list to validate a pasted ?year=
 * against and no way to know whether the slug names a real league, and showing
 * a 404 or an empty table in that window is what makes a slow load look like a
 * dead link.
 */
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-600 mx-auto mb-4"></div>
        <p className="text-slate-600">Loading season data...</p>
      </div>
    </div>
  );
}
