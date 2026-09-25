// The write guard: every request that could change something needs the unlock
// of the league it touches.
//
// It keys on the method, not the route, and runs ahead of every router. A write
// route added anywhere later starts out denied; nobody has to remember to guard
// it. A write to a path that doesn't exist is a 401 rather than a 404, so an
// anonymous caller can't use the guard to discover which write routes exist.
import { leagueBySlug, pool } from "./queries.mjs";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

// Express matches routes case-insensitively and ignores a trailing slash, so
// these must too. A pattern stricter than the router would let /API/leagues/x/…
// name no league, and every write to it would be refused.

/** The only writes anyone may make without an unlock: the unlock and the lock. */
const OPEN_WRITES = [/^\/api\/leagues\/[^/]+\/(unlock|lock)\/?$/i];

/** /api/leagues/:slug/… names its league. Nothing else names one at all. */
const LEAGUE_PATH = /^\/api\/leagues\/([^/]+)(?:\/|$)/i;

export async function requireWrite(req, res, next) {
  if (READS.has(req.method)) return next();
  if (OPEN_WRITES.some((pattern) => pattern.test(req.path))) return requireJson(req, res, next);

  const slug = slugOf(req.path);
  const league = slug === null ? null : await findLeague(slug);

  if (league === null || !unlockedLeagues(req.session).includes(league.id)) {
    return res.status(401).json({ error: "Unlock this league to make changes." });
  }

  requireJson(req, res, next);
}

/**
 * The league a write path belongs to, or null when it names none.
 *
 * Every write route the server has lives under /api/leagues/:slug/, so a write
 * path that carries no slug addresses no league and is refused. It used to fall
 * back to the one league, because the compatibility aliases wrote to it without
 * naming it; with those gone, a fallback could only ever hand an unrecognised
 * path the real league's data.
 */
function slugOf(path) {
  const match = path.match(LEAGUE_PATH);
  if (match === null) return null;

  // The router decodes params before a handler sees them, so decode the same way.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** An unknown or malformed slug is no league, and so no access. */
async function findLeague(slug) {
  try {
    return await leagueBySlug(pool, slug);
  } catch (err) {
    if (err.status) return null;
    throw err;
  }
}

function unlockedLeagues(session) {
  return Array.isArray(session?.canWrite) ? session.canWrite : [];
}

/**
 * A write that carries a body must say it is JSON. HTML forms can't send that
 * type, and a cross-origin fetch that does is preflighted and refused by CORS.
 * A write with no body at all, like a lock, has no type to check.
 */
function requireJson(req, res, next) {
  const hasBody =
    req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"]) > 0;

  if (hasBody && !req.is("application/json")) {
    return res.status(415).json({ error: "Send the body as application/json." });
  }
  next();
}
