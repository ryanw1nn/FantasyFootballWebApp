// The only place in src/ that builds a URL. Every <Link> and every navigate()
// goes through it, for the same reason client.js owns the API's address: a path
// spelled in nine places drifts in nine places, and the league switcher alone
// has to build all five views.
//
// No React in here either — it is string building, so a component, a redirect
// and a test can all call it.
//
// The grammar these functions implement is /l/:slug/:view with the year as a
// query param. Two of the five views have no year at all, which is why the year
// is a param and not a segment: there would be nothing to put in the segment.

/** The prefix that keeps league slugs from colliding with /about or /healthz. */
const LEAGUE_PREFIX = '/l';

/**
 * `?year=2026`, or nothing at all. An omitted year is not a mistake to be
 * corrected — a link with no year means "the latest season", which is the link
 * worth sending someone, so it must survive being built.
 */
function yearQuery(year) {
  if (year === undefined || year === null || year === '') return '';
  return `?year=${encodeURIComponent(year)}`;
}

/** `/` — redirects to the default league's season view. */
export function homePath() {
  return '/';
}

/** `/l/:slug` — the bare league URL, which redirects rather than 404s. */
export function leaguePath(slug) {
  return `${LEAGUE_PREFIX}/${encodeURIComponent(slug)}`;
}

/** `/l/:slug/season` — the dashboard's season table. */
export function seasonPath(slug, year) {
  return `${leaguePath(slug)}/season${yearQuery(year)}`;
}

/**
 * `/l/:slug/alltime` — the dashboard's all-time table. Takes no year by design:
 * it spans every season, so a year on it would be an address that lies.
 */
export function alltimePath(slug) {
  return `${leaguePath(slug)}/alltime`;
}

/** `/l/:slug/bracket` — the playoff bracket. */
export function bracketPath(slug, year) {
  return `${leaguePath(slug)}/bracket${yearQuery(year)}`;
}

/** `/l/:slug/edit` — the season editor, deep-linkable while locked. */
export function editPath(slug, year) {
  return `${leaguePath(slug)}/edit${yearQuery(year)}`;
}

/**
 * `/l/:slug/players/:name` — one player's career. A player is still a display
 * name, and the names have spaces in them, so this is the one place the segment
 * is encoded. When Phase 6 puts a player id in the URL instead, this function
 * and decodePlayerName below are the whole change.
 */
export function playerPath(slug, name, year) {
  return `${leaguePath(slug)}/players/${encodeURIComponent(name)}${yearQuery(year)}`;
}

/**
 * :name off the route back to a name. The router has already decoded it —
 * useParams hands out `TJ Cairney`, not `TJ%20Cairney` — so decoding again here
 * would turn a name with a `%` in it into a different name, or throw. This is
 * still the one place a route param becomes a player, which is what Phase 6's
 * switch to ids needs.
 */
export function decodePlayerName(param) {
  return param ?? '';
}
