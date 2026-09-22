// The only place in src/ that knows the API's address, its dialect and what a
// failure looks like. No React in here: it is a plain module, so a route loader
// in Phase 5 can call it without becoming a component.
//
// Every function takes a slug, and every URL now carries it. The read path moved
// onto the league-scoped routes first and the editor's load and write followed,
// so nothing here reaches a compatibility alias any more — the aliases still
// exist and still pass their gate, they just have no caller. A slug other than
// the default is now something this module can address rather than refuse.

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

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

/** Every league, with the years each has seasons for. The switcher's list. */
export function getLeagues() {
  return request('GET', '/api/leagues');
}

/** One league and the shape of each of its seasons. */
export function getLeague(slug) {
  return request('GET', `/api/leagues/${encodeURIComponent(requireSlug(slug))}`);
}

// ============================================
// SEASON DATA
// ============================================

/**
 * Every season of the league: teams, standings and weeks in one payload.
 *
 * The response is wrapped — `{ seasons: { "2020": … } }` — so it can grow a
 * field without changing type. The wrapper is unwrapped here rather than in
 * the layout, so the one place that knows the API's shape stays the one place
 * that knows it.
 */
export async function getSeasons(slug) {
  const body = await request(
    'GET',
    `/api/leagues/${encodeURIComponent(requireSlug(slug))}/seasons`
  );
  return body.seasons;
}

/**
 * One season on its own: its shape, its teams, its standings and its weeks.
 *
 * The editor's load. It reads a fresh copy of the season it is about to write
 * rather than sharing the layout's payload, because that payload is what every
 * other view is rendering and the editor holds unsaved edits on top of its own.
 * `season` is what carries `playoff_start_week`, which is how the editor knows
 * which weeks are playoff weeks without hardcoding this league's calendar.
 */
export function getSeason(slug, year) {
  return request(
    'GET',
    `/api/leagues/${encodeURIComponent(requireSlug(slug))}/seasons/${encodeURIComponent(year)}`
  );
}

/**
 * Replace one week's matchups, and the standings behind them.
 *
 * The only call the server's write guard stands in front of, so the only one
 * whose 401 means "this session may not write" rather than "the server is
 * wrong". That is what `guarded` marks, and it is why it appears once.
 */
export function saveWeek(slug, year, week, matchups) {
  return request(
    'PUT',
    `/api/leagues/${encodeURIComponent(requireSlug(slug))}` +
      `/seasons/${encodeURIComponent(year)}/weeks/${encodeURIComponent(week)}`,
    { body: { matchups }, withCookie: true, guarded: true }
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
 * Register the one thing that happens when a guarded write is refused for want
 * of a session. The module notices; the app decides what that means. The call
 * still throws afterwards, so a caller that wants to say something about the
 * failure still can — and so the editor keeps the week that was typed into it.
 *
 * Only saveWeek reaches this. A 401 from a read is a defect in the server, not
 * a prompt: reads are public, so answering one with an unlock form would tell
 * the reader something untrue about the product. A 401 from unlock is the
 * passphrase being wrong, which the form the caller is already showing says in
 * the server's own words. Neither calls the handler; both still throw.
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
 * Method, path, optional body, optional cookie, optional guard — the single
 * `fetch` in the tree.
 *
 * Content-Type is set only when there is a body. The write guard answers 415 to
 * a typed body that is not JSON and lets a bodyless write through, so declaring
 * JSON on the bodyless lock is the one way to turn a working 204 into a 415.
 *
 * No retries: a retried PUT is a second write, and the week is deleted before
 * it is reinserted, so a retry racing the original is the one shape the row
 * lock was never meant to fix.
 */
async function request(method, path, { body, withCookie = false, guarded = false } = {}) {
  const options = { method };

  if (withCookie) options.credentials = 'include';

  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${path}`, options);

  if (!response.ok) throw await refusal(response, guarded);

  // 204 from lock, with nothing to parse.
  if (response.status === 204) return null;

  return response.json();
}

/**
 * The error a non-2xx becomes. A body that will not parse turns into a generic
 * message rather than a crash inside response.json().
 *
 * The handler runs before the error is thrown and cannot replace it: a handler
 * that throws is reported and the caller still receives the ApiError, because
 * the alternative is a save failing with a message about the app's own wiring.
 */
async function refusal(response, guarded) {
  const body = await response.json().catch(() => ({}));
  const error = new ApiError(response.status, body.error || `Request failed (${response.status})`);

  if (response.status === 401 && guarded && unauthorizedHandler !== null) {
    try {
      unauthorizedHandler(error);
    } catch (handlerFailure) {
      console.error('onUnauthorized handler threw', handlerFailure);
    }
  }

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
