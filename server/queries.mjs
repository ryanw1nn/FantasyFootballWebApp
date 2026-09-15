// Every SQL statement the server issues. Nothing else in server/ talks to the
// pool, so there is one place to look when a payload is wrong or a query is
// slow.
//
// Two rules hold everywhere below:
//   * every value is a placeholder, including the id arrays. :slug, :year and
//     :week arrive from the network.
//   * every read that feeds a list has an explicit ORDER BY. Postgres
//     guarantees no row order, and matchups.position is the bracket — a week
//     returned in another order renders the wrong one.
//
// numeric columns come back from pg as fixed-scale strings ("1832.70"). They
// are left that way here and converted once, at the serializer boundary.
//
// The slug, year and week a caller supplies are parsed here rather than in a
// route, so both dialects of route get the same 400 and no unchecked value can
// reach the pool.
import { pool } from "../db/pool.mjs";
import { writeStandings } from "../db/standings.mjs";
import { RequestError } from "./errors.mjs";
import { nameOf } from "./serialize.mjs";
import {
  parseLabel,
  parseMatchups,
  parseSlug,
  parseStatus,
  parseWeek,
  parseYear,
  requireKnownKeys,
} from "./validate.mjs";

export { pool };

/** The one league that exists, and the only one the compat routes serve. */
export const DEFAULT_LEAGUE = "fan-club";

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------
// Columns are named one by one rather than selected with *. leagues carries
// write_secret_hash from Phase 3 onward, and a SELECT * anywhere here would put
// it in a response the day the column lands.

/** Every league with the years it has seasons for, oldest year first. */
export async function allLeagues(client) {
  const { rows } = await client.query(
    `SELECT l.id, l.slug, l.name,
            COALESCE(
              array_agg(s.year ORDER BY s.year) FILTER (WHERE s.id IS NOT NULL),
              '{}'
            ) AS season_years
       FROM leagues l
       LEFT JOIN seasons s ON s.league_id = l.id
      GROUP BY l.id, l.slug, l.name
      ORDER BY l.slug`
  );
  return rows;
}

/** One league, or null when the slug is unknown. */
export async function leagueBySlug(client, slug) {
  const { rows } = await client.query(
    `SELECT id, slug, name FROM leagues WHERE slug = $1`,
    [parseSlug(slug)]
  );
  return rows[0] ?? null;
}

/**
 * One league with its write_secret_hash, or null when the slug is unknown. The
 * only query that selects the hash; nothing it returns belongs in a response.
 */
export async function leagueSecretBySlug(client, slug) {
  const { rows } = await client.query(
    `SELECT id, slug, write_secret_hash FROM leagues WHERE slug = $1`,
    [parseSlug(slug)]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

/** Every season of a league, oldest first. Empty when the slug is unknown. */
export async function seasonsOfLeague(client, slug) {
  const { rows } = await client.query(
    `SELECT s.id, s.year, s.regular_season_weeks, s.playoff_start_week,
            s.standings_are_imported
       FROM seasons s
       JOIN leagues l ON l.id = s.league_id
      WHERE l.slug = $1
      ORDER BY s.year`,
    [parseSlug(slug)]
  );
  return rows;
}

export async function seasonOfLeague(client, slug, year) {
  const { rows } = await client.query(
    `SELECT s.id, s.year, s.regular_season_weeks, s.playoff_start_week,
            s.standings_are_imported
       FROM seasons s
       JOIN leagues l ON l.id = s.league_id
      WHERE l.slug = $1 AND s.year = $2`,
    [parseSlug(slug), parseYear(year)]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// The three reads
// ---------------------------------------------------------------------------
// Three queries for a whole league, not three per season: a season list costs
// the same round trips as a single season.

export async function teamsForSeasons(client, seasonIds) {
  const { rows } = await client.query(
    `SELECT t.id, t.season_id, t.team_name, t.status, t.playoff_rounds,
            t.made_playoffs, t.is_playoff_champ, t.is_regular_champ,
            p.display_name
       FROM teams t
       LEFT JOIN players p ON p.id = t.player_id
      WHERE t.season_id = ANY($1)
      ORDER BY t.season_id, t.id`,
    [seasonIds]
  );
  return rows;
}

export async function standingsForSeasons(client, seasonIds) {
  const { rows } = await client.query(
    `SELECT season_id, team_id, wins, losses, ties, pf, pa, place, prev_place,
            playoff_stats
       FROM standings
      WHERE season_id = ANY($1)
      ORDER BY season_id, place`,
    [seasonIds]
  );
  return rows;
}

export async function matchupsForSeasons(client, seasonIds) {
  const { rows } = await client.query(
    `SELECT season_id, week, position, status, label,
            team1_id, team1_score, team2_id, team2_score
       FROM matchups
      WHERE season_id = ANY($1)
      ORDER BY season_id, week, position`,
    [seasonIds]
  );
  return rows;
}

/** Teams, standings and matchups for a set of seasons, grouped by season id. */
export async function loadSeasons(client, seasons) {
  const ids = seasons.map((season) => season.id);
  if (ids.length === 0) return new Map();

  const [teams, standings, matchups] = await Promise.all([
    teamsForSeasons(client, ids),
    standingsForSeasons(client, ids),
    matchupsForSeasons(client, ids),
  ]);

  const bundles = new Map(
    seasons.map((season) => [season.id, { season, teams: [], standings: [], matchups: [] }])
  );

  for (const row of teams) bundles.get(row.season_id).teams.push(row);
  for (const row of standings) bundles.get(row.season_id).standings.push(row);
  for (const row of matchups) bundles.get(row.season_id).matchups.push(row);

  return bundles;
}

/** One season's bundle, or null when the year does not exist in the league. */
export async function loadSeason(client, slug, year) {
  const season = await seasonOfLeague(client, slug, year);
  if (season === null) return null;

  const bundles = await loadSeasons(client, [season]);
  return bundles.get(season.id);
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

/**
 * Replaces one week's matchups and recomputes the standings they changed, in a
 * single transaction. Returns the season's bundle as it stands after the write.
 *
 * `toRow` reads one matchup out of the request body. It is the only thing the
 * two dialects differ by: the aliases send display names and "BYE", the league
 * routes send team ids and null, and both end in the same transaction rather
 * than in two implementations of it.
 *
 * The season row is locked first: two editors saving different weeks both
 * recompute the same standings table, and without the lock the second recompute
 * can read the first's uncommitted absence and store a stale table.
 */
export async function replaceWeek(slug, year, week, matchups, toRow) {
  // Parsed before a connection is taken: a bad week should not cost a client
  // out of the pool, let alone an open transaction. The body is checked here
  // rather than in a route so both dialects reject the same payloads.
  const league = parseSlug(slug);
  const seasonYear = parseYear(year);
  const weekNumber = parseWeek(week);
  const entries = parseMatchups(matchups);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT s.id, s.standings_are_imported
         FROM seasons s
         JOIN leagues l ON l.id = s.league_id
        WHERE l.slug = $1 AND s.year = $2
        FOR UPDATE OF s`,
      [league, seasonYear]
    );
    if (rows.length === 0) throw new RequestError(404, "Not found");
    if (rows[0].standings_are_imported) {
      // writeStandings returns null here rather than recomputing, so accepting
      // the matchups would store games the standings do not describe. Refusing
      // the write is the only outcome that keeps the two in step.
      throw new RequestError(
        409,
        "This season's standings are imported and cannot be recomputed"
      );
    }
    const seasonId = rows[0].id;

    const teams = await teamsForSeasons(client, [seasonId]);
    const rowsToInsert = entries.map((matchup, position) =>
      toRow(matchup, position, teams)
    );

    await client.query(`DELETE FROM matchups WHERE season_id = $1 AND week = $2`, [
      seasonId,
      weekNumber,
    ]);

    for (const row of rowsToInsert) {
      await client.query(
        `INSERT INTO matchups
           (season_id, week, position, status, label,
            team1_id, team1_score, team2_id, team2_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          seasonId,
          weekNumber,
          row.position,
          row.status,
          row.label,
          row.team1_id,
          row.team1_score,
          row.team2_id,
          row.team2_score,
        ]
      );
    }

    await writeStandings(client, seasonId);
    await client.query("COMMIT");

    return await loadSeason(client, league, seasonYear);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** A BYE, an empty slot and a missing key are all "no opponent". */
function resolveTeam(name, teams) {
  if (!name || name === "BYE") return null;

  const team = teams.find((row) => nameOf(row) === name);
  if (team === undefined) throw new RequestError(400, `Unknown team "${name}"`);
  return team.id;
}

/** A team id must belong to this season — the foreign key is not an error page. */
function resolveTeamId(id, teams) {
  if (id === null || id === undefined) return null;

  if (!teams.some((row) => row.id === id)) {
    throw new RequestError(400, `Unknown team ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * Two teams in one game, or the same team twice. The constraint catches the
 * second, but only after the DELETE has run — and a body's mistake is a 400.
 */
function requireDistinct(row) {
  if (row.team1_id !== null && row.team1_id === row.team2_id) {
    throw new RequestError(400, "A team cannot play itself");
  }
  return row;
}

/** Everything the serializer emits for a matchup, and nothing else. */
const NAME_KEYS = ["team1", "team1Score", "team2", "team2Score", "status", "label"];
const ID_KEYS = ["team1_id", "team1_score", "team2_id", "team2_score", "status", "label"];

/** The aliases' body: a side is a display name, "BYE", or an absent key. */
export function matchupFromNames(matchup, position, teams) {
  requireKnownKeys(matchup, NAME_KEYS);

  return requireDistinct({
    position,
    status: parseStatus(matchup.status),
    label: parseLabel(matchup.label),
    team1_id: resolveTeam(matchup.team1, teams),
    team1_score: score(matchup.team1Score),
    team2_id: resolveTeam(matchup.team2, teams),
    team2_score: score(matchup.team2Score),
  });
}

/** The league routes' body: a side is a team id, and no opponent is null. */
export function matchupFromIds(matchup, position, teams) {
  requireKnownKeys(matchup, ID_KEYS);

  return requireDistinct({
    position,
    status: parseStatus(matchup.status),
    label: parseLabel(matchup.label),
    team1_id: resolveTeamId(matchup.team1_id, teams),
    team1_score: score(matchup.team1_score),
    team2_id: resolveTeamId(matchup.team2_id, teams),
    team2_score: score(matchup.team2_score),
  });
}

/** The range numeric(8,2) and a football week agree on: 0 to 999.99. */
const MAX_SCORE = 999.99;

function score(value) {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);
  if (!Number.isFinite(number)) throw new RequestError(400, "Invalid score");

  // Out of range is the caller's mistake, so it is a 400 here rather than a
  // constraint violation surfacing as a 500 from the INSERT.
  if (number < 0 || number > MAX_SCORE) {
    throw new RequestError(400, `Score out of range: ${number}`);
  }
  return number.toFixed(2);
}
