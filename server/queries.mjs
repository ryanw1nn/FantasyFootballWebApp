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
// route, so every route gets the same 400 and no unchecked value can reach the
// pool.
import { pool } from "../db/pool.mjs";
import { writeStandings } from "../db/standings.mjs";
import {
  SeasonBuildError,
  buildSeason,
  leagueBySlug as leagueTemplateBySlug,
  nearestSeason,
  nextRoster,
  playerIds,
  playoffLayout,
  rosterOf,
  seasonsOf,
} from "../db/season-builder.mjs";
import { RequestError } from "./errors.mjs";
import {
  MAX_TEAMS,
  parseLabel,
  parseMatchups,
  parseNewSeasonBody,
  parseNewTeamBody,
  parseRenameTeamBody,
  parseSlug,
  parseStatus,
  parseTeamId,
  parseWeek,
  parseYear,
  requireKnownKeys,
} from "./validate.mjs";

export { pool };

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
 * `toRow` reads one matchup out of the request body. It is the seam the two
 * dialects used to differ by: the aliases sent display names and "BYE" where the
 * league routes send team ids and null, and both ended in the same transaction
 * rather than in two implementations of it. Since Phase 7 deleted the aliases
 * there is one caller and one dialect, and the parameter is what keeps the
 * transaction from knowing which.
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

/** Everything a matchup body may carry, and nothing else. */
const ID_KEYS = ["team1_id", "team1_score", "team2_id", "team2_score", "status", "label"];

/** A matchup as a write sends it: a side is a team id, and no opponent is null. */
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

// ---------------------------------------------------------------------------
// Creating a season
// ---------------------------------------------------------------------------
// db/season-builder.mjs does the writing, the same builder db:season and
// db:league call, so a season made on the web has the same shape as one made
// in the terminal. What lives here is the web's half: which season to copy, the
// 409 for a year that exists, and turning the builder's refusals into 400s.
//
// The preview and the create share draftSeason, so what the editor is shown is
// exactly what the POST will build from — not a second guess at "nearest".

const NO_EDITS = { drop: [], add: [], rename: [] };

/**
 * What creating `year` would start from: the nearest season's roster with the
 * edits applied, the playoff rows it would copy, and the weeks the league's
 * template gives. Throws the 409 for an existing year and a 400 for a roster
 * the builder refuses.
 */
async function draftSeason(client, slug, year, edits) {
  const league = await leagueTemplateBySlug(client, slug);
  const seasons = await seasonsOf(client, league.id);

  if (seasons.some((season) => season.year === year)) {
    throw new RequestError(409, `${year} already exists in this league`);
  }

  const from = nearestSeason(seasons, year);
  const roster = nextRoster(await rosterOf(client, from.id), edits);
  if (roster.length > MAX_TEAMS) {
    throw new RequestError(400, `${roster.length} teams is more than the ${MAX_TEAMS} allowed`);
  }

  const layout = await playoffLayout(client, from.id, from.playoff_start_week);
  const latest = seasons.at(-1);

  return { league, from, roster, layout, latest };
}

/**
 * Warnings that do not block: the builder's own, a source with no bracket to
 * copy, and a latest season whose final has not been scored — creating next
 * year before this one is finished is allowed, but rarely meant.
 */
async function draftWarnings(client, draft, year) {
  const warnings = [];

  if (draft.layout.length === 0) {
    warnings.push(
      `${draft.from.year} has no playoff rows to copy, so ${year} gets regular-season weeks only.`
    );
  }

  if (year > draft.latest.year) {
    const { rows } = await client.query(
      `SELECT count(*) AS unscored FROM matchups
        WHERE season_id = $1 AND status = 'playoff'
          AND week = (SELECT max(week) FROM matchups WHERE season_id = $1)
          AND team1_score IS NULL AND team2_score IS NULL`,
      [draft.latest.id]
    );
    if (Number(rows[0].unscored) > 0) {
      warnings.push(`${draft.latest.year}'s final has no score yet.`);
    }
  }

  return warnings;
}

/** The roster as the editor shows it: who, and under which team name. */
function draftRoster(roster) {
  return roster.map((team) => ({ player: team.display_name, team: team.team_name }));
}

/** A builder refusal is the caller's mistake, said in the builder's words. */
function asRequestError(err) {
  if (err instanceof SeasonBuildError) return new RequestError(400, err.message);
  // Two creates of one year racing past the check: the second loses here.
  if (err.code === "23505" && err.constraint === "seasons_league_year_unique") {
    return new RequestError(409, "That season already exists in this league");
  }
  return err;
}

/**
 * The roster a new season of `year` would start from, read-only. The editor's
 * starting point; nothing is written and no transaction is held.
 */
export async function previewSeason(slug, year) {
  const seasonYear = parseYear(year);
  const client = await pool.connect();

  try {
    const draft = await draftSeason(client, parseSlug(slug), seasonYear, NO_EDITS);
    const league = draft.league;

    return {
      year: seasonYear,
      from: draft.from.year,
      roster: draftRoster(draft.roster),
      regular_season_weeks: league.regular_season_weeks,
      playoff_start_week: league.playoff_start_week,
      playoff_matchups: draft.layout.length,
      warnings: await draftWarnings(client, draft, seasonYear),
    };
  } catch (err) {
    throw asRequestError(err);
  } finally {
    client.release();
  }
}

/**
 * Creates a season from `{ year, drop, add, rename }` in one transaction. The
 * league row is locked first, so two creates of the same year queue rather than
 * both passing the existence check. There is no replace: deleting a season, or
 * rebuilding one, stays db:season's.
 */
export async function createSeason(slug, body) {
  const league = parseSlug(slug);
  const { year, ...edits } = parseNewSeasonBody(body);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM leagues WHERE slug = $1 FOR UPDATE`, [league]);

    const draft = await draftSeason(client, league, year, edits);
    const warnings = await draftWarnings(client, draft, year);

    const built = await buildSeason(client, draft.league, {
      year,
      roster: draft.roster,
      layout: draft.layout,
    });

    await client.query("COMMIT");

    return {
      year,
      from: draft.from.year,
      teams: built.teamIds.length,
      matchups: built.matchups,
      created: built.created,
      warnings: [...built.warnings, ...warnings],
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw asRequestError(err);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Editing a season's roster
// ---------------------------------------------------------------------------
// Rename a team, add one, remove one — in that season only. Each runs in one
// transaction with the season row locked, the same lock replaceWeek takes, so a
// roster change and a week save cannot recompute the standings over each other.
// Each answers with the whole season as it stands afterwards: an add or a remove
// changes the weeks and the standings as well as the teams.

/**
 * Runs `work(client, season)` inside a transaction on the locked season, then
 * reads the season back. :slug and :year are parsed before a connection is
 * taken; an unknown season is a 404.
 */
async function inSeasonTransaction(slug, year, work) {
  const league = parseSlug(slug);
  const seasonYear = parseYear(year);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT s.id, s.year, s.league_id, s.playoff_start_week
         FROM seasons s
         JOIN leagues l ON l.id = s.league_id
        WHERE l.slug = $1 AND s.year = $2
        FOR UPDATE OF s`,
      [league, seasonYear]
    );
    if (rows.length === 0) throw new RequestError(404, "Season not found");

    await work(client, rows[0]);
    await client.query("COMMIT");

    return await loadSeason(client, league, seasonYear);
  } catch (err) {
    await client.query("ROLLBACK");
    throw asRosterError(err);
  } finally {
    client.release();
  }
}

/** The constraints behind the checks below, should a race get past one. */
function asRosterError(err) {
  if (err.code === "23505" && err.constraint === "teams_season_name_unique") {
    return new RequestError(409, "Another team this season already has that name");
  }
  if (err.code === "23505" && err.constraint === "teams_season_player_unique") {
    return new RequestError(409, "That player already has a team this season");
  }
  return err;
}

async function rosterTeams(client, seasonId) {
  const { rows } = await client.query(
    `SELECT t.id, t.player_id, t.team_name, p.display_name
       FROM teams t
       LEFT JOIN players p ON p.id = t.player_id
      WHERE t.season_id = $1
      ORDER BY t.id`,
    [seasonId]
  );
  return rows;
}

/**
 * The team, if it belongs to this season. A team id from another season — or
 * another league — is a 404 here, so no route below can reach past :slug.
 */
function teamOf(teams, teamId) {
  const team = teams.find((row) => row.id === teamId);
  if (team === undefined) throw new RequestError(404, "Team not found");
  return team;
}

function requireFreeName(teams, teamName, year, exceptId = null) {
  if (teams.some((team) => team.team_name === teamName && team.id !== exceptId)) {
    throw new RequestError(409, `Another team in ${year} is already called "${teamName}"`);
  }
}

/**
 * The player an add names. `{ id }` must be someone with a team in this league
 * already, so an id cannot borrow a player from another league. `{ name }` goes
 * through the season builder's rule: the league's player of that name, an
 * orphaned row of it, or a new row.
 */
async function resolvePlayer(client, leagueId, player) {
  if (player.id !== undefined) {
    const { rows } = await client.query(
      `SELECT p.id, p.display_name
         FROM players p
        WHERE p.id = $2
          AND EXISTS (SELECT 1 FROM teams t JOIN seasons s ON s.id = t.season_id
                       WHERE t.player_id = p.id AND s.league_id = $1)`,
      [leagueId, player.id]
    );
    if (rows.length === 0) throw new RequestError(400, `Player ${player.id} is not in this league`);
    return rows[0];
  }

  const { ids } = await playerIds(client, leagueId, [{ display_name: player.name }]);
  return { id: ids.get(player.name), display_name: player.name };
}

/**
 * Keeps every regular-season week at one row per game: half the roster,
 * rounded up, so an odd roster's spare team has a row to be paired or given a
 * BYE in. Short weeks gain empty rows at the end; long ones lose empty rows from
 * the end — only rows with no team, score, status or label, so nothing anyone
 * entered is deleted. Only weeks that already have rows are touched: a week
 * exists because some row carries its number, and this does not invent one.
 * Playoff weeks are the bracket's wiring and are left alone.
 */
async function fitRegularWeeks(client, season, teamCount) {
  const perWeek = Math.ceil(teamCount / 2);

  const { rows } = await client.query(
    `SELECT week, position,
            (team1_id IS NULL AND team2_id IS NULL
             AND team1_score IS NULL AND team2_score IS NULL
             AND status IS NULL AND label IS NULL) AS is_empty
       FROM matchups
      WHERE season_id = $1 AND week < $2
      ORDER BY week, position`,
    [season.id, season.playoff_start_week]
  );

  const weeks = new Map();
  for (const row of rows) {
    if (!weeks.has(row.week)) weeks.set(row.week, []);
    weeks.get(row.week).push(row);
  }

  for (const [week, matchups] of weeks) {
    let next = matchups.at(-1).position + 1;
    for (let count = matchups.length; count < perWeek; count++) {
      await client.query(
        `INSERT INTO matchups (season_id, week, position) VALUES ($1, $2, $3)`,
        [season.id, week, next++]
      );
    }

    const spare = matchups.filter((row) => row.is_empty).reverse();
    for (let count = matchups.length; count > perWeek && spare.length > 0; count--) {
      await client.query(
        `DELETE FROM matchups WHERE season_id = $1 AND week = $2 AND position = $3`,
        [season.id, week, spare.shift().position]
      );
    }
  }
}

/**
 * Recomputes the standings after the roster changed. A season with no scored
 * week, or with imported standings, has nothing to recompute from, so its
 * table keeps the order it had: a removed team's place closes up and a new team
 * sits last.
 */
async function settleStandings(client, seasonId) {
  if ((await writeStandings(client, seasonId)) !== null) return;

  await client.query(
    `UPDATE standings st
        SET place = ranked.place
       FROM (SELECT team_id, row_number() OVER (ORDER BY place, team_id) AS place
               FROM standings WHERE season_id = $1) ranked
      WHERE st.season_id = $1 AND st.team_id = ranked.team_id`,
    [seasonId]
  );
}

/** Renames a team in one season. Every other season keeps the name it had. */
export async function renameTeam(slug, year, teamId, body) {
  const id = parseTeamId(teamId);
  const { teamName } = parseRenameTeamBody(body);

  return inSeasonTransaction(slug, year, async (client, season) => {
    const teams = await rosterTeams(client, season.id);
    teamOf(teams, id);
    requireFreeName(teams, teamName, season.year, id);

    await client.query(`UPDATE teams SET team_name = $1 WHERE id = $2`, [teamName, id]);
  });
}

/**
 * Adds a team to a season: the team, a zero standings row, and — if the roster
 * has outgrown the weeks — an empty row in each regular-season week. It has no
 * opponents until a week is edited.
 */
export async function addTeam(slug, year, body) {
  const { teamName, player } = parseNewTeamBody(body);

  return inSeasonTransaction(slug, year, async (client, season) => {
    const teams = await rosterTeams(client, season.id);
    if (teams.length >= MAX_TEAMS) {
      throw new RequestError(400, `${season.year} already has ${MAX_TEAMS} teams, the most allowed`);
    }
    requireFreeName(teams, teamName, season.year);

    const resolved = await resolvePlayer(client, season.league_id, player);
    if (teams.some((team) => team.player_id === resolved.id)) {
      throw new RequestError(409, `${resolved.display_name} already has a team in ${season.year}`);
    }

    const { rows } = await client.query(
      `INSERT INTO teams (season_id, player_id, team_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [season.id, resolved.id, teamName]
    );
    const place = teams.length + 1;
    await client.query(
      `INSERT INTO standings (season_id, team_id, place, prev_place) VALUES ($1, $2, $3, $4)`,
      [season.id, rows[0].id, place, place]
    );

    await fitRegularWeeks(client, season, teams.length + 1);
    await settleStandings(client, season.id);
  });
}

/**
 * Removes a team from a season, but never one that has played: any scored
 * matchup is a 409 and nothing changes. Otherwise every game it was in is
 * emptied — both sides, since its opponent was paired with a team that no
 * longer exists and one empty side would read as a BYE nobody chose — then the
 * team and its standings row go, and so does its player if this was their only
 * team anywhere.
 */
export async function removeTeam(slug, year, teamId) {
  const id = parseTeamId(teamId);

  return inSeasonTransaction(slug, year, async (client, season) => {
    const teams = await rosterTeams(client, season.id);
    const team = teamOf(teams, id);

    const { rows } = await client.query(
      `SELECT count(*) AS scored FROM matchups
        WHERE season_id = $1 AND (team1_id = $2 OR team2_id = $2)
          AND (team1_score IS NOT NULL OR team2_score IS NOT NULL)`,
      [season.id, id]
    );
    const scored = Number(rows[0].scored);
    if (scored > 0) {
      throw new RequestError(
        409,
        `${team.team_name} has ${scored} scored matchup(s) in ${season.year} and cannot be ` +
          `removed. Rename it instead.`
      );
    }

    await client.query(
      `UPDATE matchups SET team1_id = NULL, team2_id = NULL
        WHERE season_id = $1 AND (team1_id = $2 OR team2_id = $2)`,
      [season.id, id]
    );
    await client.query(`DELETE FROM teams WHERE id = $1`, [id]);

    if (team.player_id !== null) {
      await client.query(
        `DELETE FROM players p
          WHERE p.id = $1 AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.player_id = p.id)`,
        [team.player_id]
      );
    }

    await fitRegularWeeks(client, season, teams.length - 1);
    await settleStandings(client, season.id);
  });
}
