// The three values that arrive from the network, checked before the pool is
// touched.
//
// Parameterized queries make a bad :year safe, not sensible: /seasons/abc is a
// 400, not a 500 from "invalid input syntax for type integer". Every parser
// below takes what the URL gives — a string — and returns the typed value the
// queries bind, so a caller cannot forget the conversion.
import { MAX_MANAGERS } from "../db/season-builder.mjs";
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
// These were shared by both dialects: the aliases sent display names where the
// league routes send ids, but a status is a status and an unknown key is a typo
// in either of them. Only the league routes are left, and the rules did not
// depend on which was calling.

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

// ---------------------------------------------------------------------------
// The unlock body
// ---------------------------------------------------------------------------

/**
 * Wide enough for any passphrase db:passphrase would have accepted, which is at
 * least 12 characters. The minimum here is 1: a short guess is a wrong
 * passphrase, answered with the same 401 as any other.
 */
const MAX_PASSPHRASE = 200;

/** `{ passphrase }` and nothing else, the passphrase a string of 1–200 characters. */
export function parseUnlockBody(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "Invalid data");
  }

  const unknown = Object.keys(body).filter((key) => key !== "passphrase");
  if (unknown.length > 0) {
    throw new RequestError(400, `Unknown key: ${unknown.join(", ")}`);
  }

  const { passphrase } = body;
  if (typeof passphrase !== "string") throw new RequestError(400, "Invalid passphrase");

  const length = [...passphrase].length;
  if (length < 1 || length > MAX_PASSPHRASE) {
    throw new RequestError(400, `Passphrase must be 1–${MAX_PASSPHRASE} characters`);
  }
  return passphrase;
}

// ---------------------------------------------------------------------------
// The new-season body
// ---------------------------------------------------------------------------
// `{ year, drop, add, rename }`, in db:season's vocabulary: drop is a list of
// display names, add and rename are `{ player, team }` pairs. Whether a drop or
// a rename names someone on the source roster needs the roster, so that is the
// builder's check, inside the transaction. Everything here needs only the value.

/** The earliest season anyone could plausibly backfill. */
const MIN_SEASON_YEAR = 2000;

/** More teams than any league fields; a single week never exceeds MAX_MATCHUPS. */
export const MAX_TEAMS = 32;

/** Owner and team names, matching what db:league accepts. */
const MAX_NAME = 120;

const NEW_SEASON_KEYS = ["year", "drop", "add", "rename"];
const PAIR_KEYS = ["player", "team"];

/** A year from 2000 to next year, as a number. The body sends it unquoted. */
export function parseSeasonYear(value, now = new Date()) {
  const latest = now.getFullYear() + 1;
  if (!Number.isInteger(value) || value < MIN_SEASON_YEAR || value > latest) {
    throw new RequestError(400, `Year must be ${MIN_SEASON_YEAR}–${latest}`);
  }
  return value;
}

/** A trimmed name of 1–120 characters. */
function parseName(value, what) {
  if (typeof value !== "string") throw new RequestError(400, `Invalid ${what}`);

  const name = value.trim();
  const length = [...name].length;
  if (length < 1 || length > MAX_NAME) {
    throw new RequestError(400, `${what} must be 1–${MAX_NAME} characters`);
  }
  return name;
}

/** An optional array no longer than a roster, or an empty one when absent. */
function parseList(value, what) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new RequestError(400, `${what} must be a list`);
  if (value.length > MAX_TEAMS) {
    throw new RequestError(400, `Too many in ${what}: ${value.length} (max ${MAX_TEAMS})`);
  }
  return value;
}

function parsePair(value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, `Invalid ${what} entry`);
  }

  const unknown = Object.keys(value).filter((key) => !PAIR_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new RequestError(400, `Unknown ${what} key: ${unknown.join(", ")}`);
  }

  return { player: parseName(value.player, "Player name"), team: parseName(value.team, "Team name") };
}

/** No name twice in one list: a second drop of someone is a typo, not an intent. */
function requireUnique(names, what) {
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) throw new RequestError(400, `"${name}" appears twice in ${what}`);
    seen.add(name);
  }
}

export function parseNewSeasonBody(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "Invalid data");
  }

  const unknown = Object.keys(body).filter((key) => !NEW_SEASON_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new RequestError(400, `Unknown key: ${unknown.join(", ")}`);
  }

  const year = parseSeasonYear(body.year);
  const drop = parseList(body.drop, "drop").map((name) => parseName(name, "Player name"));
  const add = parseList(body.add, "add").map((pair) => parsePair(pair, "add"));
  const rename = parseList(body.rename, "rename").map((pair) => parsePair(pair, "rename"));

  requireUnique(drop, "drop");
  requireUnique(add.map((pair) => pair.player), "add");
  requireUnique(add.map((pair) => pair.team), "add");
  requireUnique(rename.map((pair) => pair.player), "rename");

  return { year, drop, add, rename };
}

// ---------------------------------------------------------------------------
// The roster bodies
// ---------------------------------------------------------------------------
// A team in a season is renamed, added or removed. Whether a name is free, or a
// player already plays that season, needs the season's teams, so those are the
// query's checks inside the transaction. Everything here needs only the value.

/** A team id from the URL: a positive integer, short enough to be an id. */
const TEAM_ID = /^[1-9]\d{0,8}$/;

export function parseTeamId(value) {
  if (!TEAM_ID.test(String(value))) throw new RequestError(400, "Invalid team");
  return Number(value);
}

/** A body that is an object with no key outside `allowed`. */
function requireBodyKeys(body, allowed) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "Invalid data");
  }

  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RequestError(400, `Unknown key: ${unknown.join(", ")}`);
  }
}

/** One person a body names: `{ id }` the league already has, or `{ name }`. */
function parsePlayerRef(player) {
  if (player === null || typeof player !== "object" || Array.isArray(player)) {
    throw new RequestError(400, "Invalid player");
  }

  const keys = Object.keys(player);
  if (keys.length !== 1 || !["id", "name"].includes(keys[0])) {
    throw new RequestError(400, "Player must be { id } or { name }");
  }

  if (keys[0] === "id") {
    if (!Number.isInteger(player.id) || player.id < 1) throw new RequestError(400, "Invalid player id");
    return { id: player.id };
  }

  return { name: parseName(player.name, "Player name") };
}

/**
 * A team's managers: one person, or up to MAX_MANAGERS for a co-managed team,
 * in the order they are listed. Whether two refs are the same person needs the
 * league, so that is the query's check.
 */
function parsePlayers(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestError(400, "players must be a list of one or more players");
  }
  if (value.length > MAX_MANAGERS) {
    throw new RequestError(400, `A team can have ${MAX_MANAGERS} managers, not ${value.length}`);
  }
  return value.map(parsePlayerRef);
}

/**
 * `{ teamName?, players? }`, at least one of them: a rename, a change of who
 * manages the team, or both at once.
 */
export function parseTeamChangeBody(body) {
  requireBodyKeys(body, ["teamName", "players"]);
  if (body.teamName === undefined && body.players === undefined) {
    throw new RequestError(400, "Nothing to change: send teamName, players or both");
  }

  return {
    teamName: body.teamName === undefined ? undefined : parseName(body.teamName, "Team name"),
    players: body.players === undefined ? undefined : parsePlayers(body.players),
  };
}

/**
 * `{ teamName, players }`, where each player is `{ id }` for someone the league
 * already has, or `{ name }` for a name the league's player rule resolves —
 * reusing the league's player of that name, or creating one.
 */
export function parseNewTeamBody(body) {
  requireBodyKeys(body, ["teamName", "players"]);
  return {
    teamName: parseName(body.teamName, "Team name"),
    players: parsePlayers(body.players),
  };
}

// ---------------------------------------------------------------------------
// The import body
// ---------------------------------------------------------------------------

/**
 * A whole season's schedule page is about 10,000 characters. This is several
 * of them, and still under the body parser's 100kb, which would otherwise
 * answer first with a less useful message.
 */
const MAX_PASTE = 90000;

/** `{ text, apply }`: the pasted page, and whether to write it or only report. */
export function parseImportBody(body) {
  requireBodyKeys(body, ["text", "apply"]);

  if (typeof body.text !== "string" || body.text.trim() === "") {
    throw new RequestError(400, "Paste the schedule page first");
  }
  if (body.text.length > MAX_PASTE) {
    throw new RequestError(400, `The paste is longer than ${MAX_PASTE} characters`);
  }
  if (body.apply !== undefined && typeof body.apply !== "boolean") {
    throw new RequestError(400, "apply must be true or false");
  }

  return { text: body.text, apply: body.apply === true };
}
