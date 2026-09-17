// The only place in src/ that knows the API's address, its two dialects and
// what a failure looks like. No React in here: it is a plain module, so a route
// loader in Phase 5 can call it without becoming a component.
//
// Every function takes a slug, including the three whose URL has no :slug in
// it. Those reach the compatibility aliases, which have only ever meant the
// default league — so any other slug is a bug the module refuses rather than a
// week written into the wrong league. When Phase 6 swaps those URLs for the
// league-scoped ones, no call site moves.

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/** The league the four aliases serve. Mirrors DEFAULT_LEAGUE in server/queries.mjs. */
const ALIAS_LEAGUE = 'fan-club';

/**
 * A response the server refused. `status` is its code and `message` is the
 * server's own words: every 4xx it raises and the 500 handler answer with
 * `{"error": "…"}`, so a caller never has to invent wording of its own.
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ============================================
// LEAGUE METADATA — already the new dialect
// ============================================

/** Every league. Nothing calls this until Phase 5's switcher. */
export function getLeagues() {
  return request('GET', '/api/leagues');
}

/** One league and the shape of each of its seasons. */
export function getLeague(slug) {
  return request('GET', `/api/leagues/${encodeURIComponent(requireSlug(slug))}`);
}

// ============================================
// SEASON DATA — the file's dialect, via the aliases
// ============================================

/** Every season of the league: teams, standings and weeks in one payload. */
export function getSeasons(slug) {
  requireAliasLeague(slug);
  return request('GET', '/seasons');
}

/** One season's weeks and teams, which is all the edit page loads. */
export function getWeeks(slug, year) {
  requireAliasLeague(slug);
  return request('GET', `/api/seasons/${encodeURIComponent(year)}/weeks`);
}

/** Replace one week's matchups, and the standings behind them. */
export function saveWeek(slug, year, week, matchups) {
  requireAliasLeague(slug);
  return request(
    'PUT',
    `/api/seasons/${encodeURIComponent(year)}/weeks/${encodeURIComponent(week)}`,
    { body: { matchups }, withCookie: true }
  );
}

// ============================================
// SESSION
// ============================================

/** Whether this browser may write to the league. The server's answer, always. */
export function getSession(slug) {
  return request('GET', `/api/leagues/${encodeURIComponent(requireSlug(slug))}/session`, {
    withCookie: true,
  });
}

/** Trade the phrase for a session cookie that may write to this league. */
export function unlock(slug, phrase) {
  return request('POST', `/api/leagues/${encodeURIComponent(requireSlug(slug))}/unlock`, {
    body: { passphrase: phrase },
    withCookie: true,
  });
}

/** Give the session up. A bodyless POST, and it answers 204 with nothing. */
export function lock(slug) {
  return request('POST', `/api/leagues/${encodeURIComponent(requireSlug(slug))}/lock`, {
    withCookie: true,
  });
}

// ============================================
// THE 401
// ============================================

let unauthorizedHandler = null;

/**
 * Register the one thing that happens when the server answers 401. The module
 * notices; the app decides what that means. The call still throws afterwards,
 * so a caller that wants to say something about the failure still can.
 *
 * Two subscribers is a bug — the last registration would silently win — so a
 * second one throws. Pass null to clear.
 */
export function onUnauthorized(handler) {
  if (unauthorizedHandler !== null && handler !== null) {
    throw new Error('onUnauthorized already has a handler; there can be only one');
  }
  unauthorizedHandler = handler;
}

// ============================================
// THE ONE REQUEST
// ============================================

/**
 * Method, path, optional body, optional cookie — the single `fetch` in the tree.
 *
 * Content-Type is set only when there is a body. The write guard answers 415 to
 * a typed body that is not JSON and lets a bodyless write through, so declaring
 * JSON on the bodyless lock is the one way to turn a working 204 into a 415.
 *
 * No retries: a retried PUT is a second write, and the week is deleted before
 * it is reinserted, so a retry racing the original is the one shape the row
 * lock was never meant to fix.
 */
async function request(method, path, { body, withCookie = false } = {}) {
  const options = { method };

  if (withCookie) options.credentials = 'include';

  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${path}`, options);

  if (!response.ok) throw await refusal(response);

  // 204 from lock, with nothing to parse.
  if (response.status === 204) return null;

  return response.json();
}

/**
 * The error a non-2xx becomes. A body that will not parse turns into a generic
 * message rather than a crash inside response.json().
 */
async function refusal(response) {
  const body = await response.json().catch(() => ({}));
  const error = new ApiError(response.status, body.error || `Request failed (${response.status})`);

  if (response.status === 401 && unauthorizedHandler !== null) unauthorizedHandler(error);

  return error;
}

// ============================================
// SLUGS
// ============================================

function requireSlug(slug) {
  if (typeof slug !== 'string' || slug === '') {
    throw new Error('A league slug is required');
  }
  return slug;
}

/**
 * The aliases carry no slug, so the module checks what the URL cannot. Phase 6
 * gives these three league-scoped URLs and this check goes away.
 */
function requireAliasLeague(slug) {
  if (requireSlug(slug) !== ALIAS_LEAGUE) {
    throw new Error(
      `Season data for "${slug}" has no route yet: the aliases only serve "${ALIAS_LEAGUE}"`
    );
  }
}
