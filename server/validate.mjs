// The three values that arrive from the network, checked before the pool is
// touched.
//
// Parameterized queries make a bad :year safe, not sensible: /seasons/abc is a
// 400, not a 500 from "invalid input syntax for type integer". Every parser
// below takes what the URL gives — a string — and returns the typed value the
// queries bind, so a caller cannot forget the conversion.
import { RequestError } from "./errors.mjs";

/** League slugs are lowercase, hyphenated and short; "fan-club" is the only one. */
const SLUG = /^[a-z0-9-]{1,40}$/;

/** Four digits, so a year is never negative, fractional or 20250. */
const YEAR = /^\d{4}$/;

/** Regular season plus playoffs never reaches 30 weeks. */
const MIN_WEEK = 1;
const MAX_WEEK = 30;

export function parseSlug(value) {
  if (typeof value !== "string" || !SLUG.test(value)) {
    throw new RequestError(400, "Invalid league");
  }
  return value;
}

export function parseYear(value) {
  if (!YEAR.test(String(value))) throw new RequestError(400, "Invalid year");
  return Number(value);
}

export function parseWeek(value) {
  const week = Number(value);
  if (!Number.isInteger(week) || week < MIN_WEEK || week > MAX_WEEK) {
    throw new RequestError(400, "Invalid week");
  }
  return week;
}

// ---------------------------------------------------------------------------
// The request body
// ---------------------------------------------------------------------------
// A week of matchups is the only body the server accepts, and everything below
// checks it before the transaction opens. The season-dependent parts — does
// this name resolve to a team in this season — belong with the query that has
// the teams to hand; these are the parts that need nothing but the value.
//
// Both dialects share these. The aliases send display names and the league
// routes send ids, but a status is a status and an unknown key is a typo in
// either of them.

/**
 * More positions than any real week: twelve teams make six games, and week 15
 * carries a handful of bracket rows on top. Well above anything legitimate,
 * well below a body worth opening a transaction for.
 */
const MAX_MATCHUPS = 32;

/** Long enough for "Championship (Loser Gets Nothing)", short enough to store. */
const MAX_LABEL = 120;

/** The three the matchups_status_known constraint accepts, plus null. */
const STATUSES = ["playoff", "toilet", "out"];

/** The week itself: an array, and one short enough to be a week. */
export function parseMatchups(matchups) {
  if (!Array.isArray(matchups)) throw new RequestError(400, "Invalid data");
  if (matchups.length > MAX_MATCHUPS) {
    throw new RequestError(400, `Too many matchups: ${matchups.length} (max ${MAX_MATCHUPS})`);
  }
  return matchups;
}

/**
 * An unknown key is refused rather than dropped. Silently ignoring one means a
 * client that misspells `team1Score` gets a 200 and a week of empty scores.
 */
export function requireKnownKeys(matchup, allowed) {
  if (matchup === null || typeof matchup !== "object" || Array.isArray(matchup)) {
    throw new RequestError(400, "Invalid data");
  }

  const unknown = Object.keys(matchup).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RequestError(400, `Unknown matchup key: ${unknown.join(", ")}`);
  }
}

/** An empty status is the regular season, which the column stores as NULL. */
export function parseStatus(value) {
  if (value === null || value === undefined || value === "") return null;

  if (!STATUSES.includes(value)) {
    throw new RequestError(400, `Invalid status: ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseLabel(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value !== "string") throw new RequestError(400, "Invalid label");
  if (value.length > MAX_LABEL) {
    throw new RequestError(400, `Label is longer than ${MAX_LABEL} characters`);
  }
  return value;
}
