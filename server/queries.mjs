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
  MANAGERS_OF_TEAM,
  MANAGER_IDS_OF_TEAM,
  SeasonBuildError,
  buildSeason,
  deleteOrphanedPlayers,
  leagueBySlug as leagueTemplateBySlug,
  nearestSeason,
  nextRoster,
  playerIds,
  playoffLayout,
  rosterOf,
  seasonsOf,
  setManagers,
} from "../db/season-builder.mjs";
import { RequestError } from "./errors.mjs";
import { parseSchedule } from "./espn-schedule.mjs";
import {
  MAX_TEAMS,
  parseImportBody,
  parseLabel,
  parseMatchups,
  parseNewSeasonBody,
  parseNewTeamBody,
  parseTeamChangeBody,
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
            ${MANAGERS_OF_TEAM}
       FROM teams t
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

/**
 * The roster as the editor shows it: who, and under which team name. `player`
 * is the name a drop or rename names the team by — its first manager, since
 * any one of them is enough.
 */
function draftRoster(roster) {
  return roster.map((team) => ({
    player: team.managers[0],
    managers: team.managers,
    team: team.team_name,
  }));
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
// Rename a team or change who manages it, add one, remove one — in that season
// only. Each runs in one
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
  if (
    err.code === "23505" &&
    ["teams_season_player_unique", "team_managers_season_player_unique"].includes(err.constraint)
  ) {
    return new RequestError(409, "That player already has a team this season");
  }
  return err;
}

async function rosterTeams(client, seasonId) {
  const { rows } = await client.query(
    `SELECT t.id, t.season_id, t.team_name, ${MANAGERS_OF_TEAM}, ${MANAGER_IDS_OF_TEAM}
       FROM teams t
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
 * A player a body names. `{ id }` must be someone who has managed a team in
 * this league already, so an id cannot borrow a player from another league.
 * `{ name }` goes through the season builder's rule: the league's player of that
 * name, an orphaned row of it, or a new row.
 */
async function resolvePlayer(client, leagueId, player) {
  if (player.id !== undefined) {
    const { rows } = await client.query(
      `SELECT p.id, p.display_name
         FROM players p
        WHERE p.id = $2
          AND EXISTS (SELECT 1 FROM team_managers m JOIN seasons s ON s.id = m.season_id
                       WHERE m.player_id = p.id AND s.league_id = $1)`,
      [leagueId, player.id]
    );
    if (rows.length === 0) throw new RequestError(400, `Player ${player.id} is not in this league`);
    return rows[0];
  }

  const { ids } = await playerIds(client, leagueId, [player.name]);
  return { id: ids.get(player.name), display_name: player.name };
}

/**
 * The people a body names as a team's managers, in order, each of whom must be
 * free this season — managing no team, or only `exceptTeam`, the one being
 * changed. The same person twice is one mistake, said once.
 */
async function resolveManagers(client, season, teams, players, exceptTeam = null) {
  const resolved = [];
  for (const player of players) {
    const person = await resolvePlayer(client, season.league_id, player);
    if (resolved.some((other) => other.id === person.id)) {
      throw new RequestError(400, `${person.display_name} is named twice`);
    }
    const holder = teams.find((team) => team.manager_ids.includes(person.id));
    if (holder !== undefined && holder !== exceptTeam) {
      throw new RequestError(
        409,
        `${person.display_name} already manages "${holder.team_name}" in ${season.year}`
      );
    }
    resolved.push(person);
  }
  return resolved;
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

/**
 * Changes a team in one season: its name, who manages it, or both. Every other
 * season keeps the name and the managers it had. A manager taken off the team
 * whose player row then manages nothing anywhere is deleted, as removeTeam does.
 *
 * Who manages a team that has played is allowed to change: it corrects whose
 * career the season counts toward, and no score moves.
 */
export async function changeTeam(slug, year, teamId, body) {
  const id = parseTeamId(teamId);
  const { teamName, players } = parseTeamChangeBody(body);

  return inSeasonTransaction(slug, year, async (client, season) => {
    const teams = await rosterTeams(client, season.id);
    const team = teamOf(teams, id);

    if (teamName !== undefined) {
      requireFreeName(teams, teamName, season.year, id);
      await client.query(`UPDATE teams SET team_name = $1 WHERE id = $2`, [teamName, id]);
    }

    if (players !== undefined) {
      if (team.manager_ids.length === 0) {
        throw new RequestError(409, `"${team.team_name}" is a botted slot and has no managers`);
      }
      const managers = await resolveManagers(client, season, teams, players, team);
      const ids = managers.map((person) => person.id);
      await setManagers(client, team, ids);
      await deleteOrphanedPlayers(
        client,
        team.manager_ids.filter((previous) => !ids.includes(previous))
      );
    }
  });
}

/**
 * Adds a team to a season: the team, a zero standings row, and — if the roster
 * has outgrown the weeks — an empty row in each regular-season week. It has no
 * opponents until a week is edited.
 */
export async function addTeam(slug, year, body) {
  const { teamName, players } = parseNewTeamBody(body);

  return inSeasonTransaction(slug, year, async (client, season) => {
    const teams = await rosterTeams(client, season.id);
    if (teams.length >= MAX_TEAMS) {
      throw new RequestError(400, `${season.year} already has ${MAX_TEAMS} teams, the most allowed`);
    }
    requireFreeName(teams, teamName, season.year);

    const managers = await resolveManagers(client, season, teams, players);

    const { rows } = await client.query(
      `INSERT INTO teams (season_id, team_name, status)
       VALUES ($1, $2, 'active') RETURNING id, season_id`,
      [season.id, teamName]
    );
    await setManagers(client, rows[0], managers.map((person) => person.id));
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
 * team and its standings row go, and so does any of its players for whom this
 * was their only team anywhere.
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
    // team_managers goes with the team, by cascade.
    await client.query(`DELETE FROM teams WHERE id = $1`, [id]);
    await deleteOrphanedPlayers(client, team.manager_ids);

    await fitRegularWeeks(client, season, teams.length - 1);
    await settleStandings(client, season.id);
  });
}

// ---------------------------------------------------------------------------
// Importing a season's scores from ESPN
// ---------------------------------------------------------------------------
// The commissioner pastes ESPN's League Schedule page; server/espn-schedule.mjs
// reads it into weeks of games, and everything below decides what those games
// mean for a season that already exists. The importer never creates a team or a
// player, never moves a score that is already entered, and never guesses: every
// name must match the roster, every pairing must agree with what the site
// already has, and anything else is a problem that stops the whole import.
//
// The same request answers twice. Without `apply` it is the report — every week,
// every game, what would happen to it, and every problem with its line in the
// paste. With `apply` it builds the same report inside the transaction and
// writes only if the report has no problems, so what was previewed and what is
// written cannot come from two readings of the season.

/**
 * Weeks a paste carries that the importer leaves alone: playoff weeks, which
 * are entered in the editor (see server/espn-schedule.mjs), and weeks that are
 * not results yet.
 */
function skippedBecause(week) {
  if (week.playoff) return "playoffs, enter these in the editor";
  if (!week.determined) return "matchups to be determined";
  if (week.games.length === 0) return "no games";
  if (week.games.some((game) => game.away.score === null || game.home.score === null)) {
    return "not played yet";
  }
  if (week.games.some((game) => game.away.score === 0 || game.home.score === 0)) {
    return "has a score of 0";
  }
  return null;
}

/** Edit distance, for "did you mean". Names are short, so the plain table is fine. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** The closest candidate within three edits, or null. */
function closest(name, candidates) {
  const close = candidates
    .map((candidate) => ({ candidate, d: distance(name.toLowerCase(), candidate.toLowerCase()) }))
    .filter(({ d }) => d > 0 && d <= 3)
    .sort((x, y) => x.d - y.d);
  return close[0]?.candidate ?? null;
}

/** What every screen calls a team's people: "Alex", or "Alex & Blake". */
function managersOf(team) {
  return team.managers.length > 0 ? team.managers.join(" & ") : null;
}

/**
 * Whether ESPN's manager column names this team's people: one of its managers,
 * or a co-managed team's names joined by "," or "&" in any order. How ESPN
 * prints a co-managed team has not been seen yet; anything else is a problem
 * with its line, not a guess. Case is ignored: ESPN prints names as each
 * manager typed them, so "dan mcknight" is Dan McKnight.
 */
function managedBy(team, manager) {
  const managers = team.managers.map((name) => name.toLowerCase());
  const wanted = manager.toLowerCase();
  if (managers.includes(wanted)) return true;

  const names = wanted.split(/\s*[,&]\s*/).filter((name) => name !== "");
  return names.length > 1 && names.every((name) => managers.includes(name));
}

/**
 * The roster team an ESPN side stands for: the manager must be the team's
 * player and the team name must be its name this season. Both, because a
 * manager's name is the stable half and the team name is the half a mistake
 * hides behind. A mismatch is reported once per name, at its first line.
 */
function sideResolver(teams, year, problems) {
  const reported = new Set();
  const players = teams.filter((team) => team.managers.length > 0);

  function report(key, line, message) {
    if (reported.has(key)) return;
    reported.add(key);
    problems.push({ line, message });
  }

  return (side, line) => {
    const byPlayer = players.find((team) => managedBy(team, side.manager));
    const byName = teams.find((team) => team.team_name === side.team);

    if (byPlayer !== undefined && byPlayer.team_name === side.team) return byPlayer;

    const key = `${side.manager}\u0000${side.team}`;
    if (byPlayer !== undefined) {
      report(
        key,
        line,
        `Team name not valid: ESPN calls ${side.manager}'s team "${side.team}", but in ${year} ` +
          `it is "${byPlayer.team_name}". Rename it in the roster panel if ESPN is right.`
      );
    } else if (byName !== undefined) {
      report(
        key,
        line,
        `Player not found: ESPN has "${side.manager}" managing "${side.team}", but in ${year} ` +
          `that team belongs to ${managersOf(byName) ?? "a botted slot"}.`
      );
    } else {
      const player = closest(side.manager, players.flatMap((team) => team.managers));
      const team = closest(side.team, teams.map((row) => row.team_name));
      const hints = [
        player && `player "${player}"`,
        team && `team "${team}"`,
      ].filter(Boolean);

      report(
        key,
        line,
        `Player not found: "${side.manager}" (team "${side.team}") is not on the ${year} ` +
          `roster, and no ${year} team has that name.` +
          (hints.length > 0 ? ` Closest on the roster: ${hints.join(", ")}.` : "")
      );
    }
    return null;
  };
}

const twoPlaces = (value) => Number(value).toFixed(2);

/** How a site row reads in a message: who, and their score or that there is none. */
function siteSide(teams, teamId, score) {
  if (teamId === null) return "nobody";
  const team = teams.find((row) => row.id === teamId);
  const who = (team && managersOf(team)) ?? team?.team_name ?? `team ${teamId}`;
  return score === null ? `${who} (no score)` : `${who} ${twoPlaces(score)}`;
}

const espnSide = (side) => `${side.manager} ${twoPlaces(side.score)}`;

/**
 * One played week: each game matched to the site's row for it. A row with the
 * same two teams is the game; its scores are entered if it has none, left alone
 * if they agree, and a problem if they differ. A pairing the site does not have
 * goes into an empty row of the week, unless either team is already paired
 * there with someone else — that is a disagreement, not a gap. Only regular-
 * season weeks get here; playoff weeks are skipped before matching.
 */
function matchWeek(week, rows, teams, resolve, year, problems) {
  const games = [];
  const claimed = new Set();
  const seen = new Map();

  for (const game of week.games) {
    const away = resolve(game.away, game.line);
    const home = resolve(game.home, game.line);
    const entry = {
      line: game.line,
      away: { player: game.away.manager, team: game.away.team, score: game.away.score },
      home: { player: game.home.manager, team: game.home.team, score: game.home.score },
      action: null,
    };
    games.push(entry);
    if (away === null || home === null) continue;

    for (const team of [away, home]) {
      if (seen.has(team.id)) {
        problems.push({
          line: game.line,
          message: `Week ${week.week}: ${managersOf(team)} plays twice (lines ${seen.get(team.id)} and ${game.line}).`,
        });
      }
      seen.set(team.id, game.line);
    }

    const row = rows.find(
      (r) =>
        (r.team1_id === away.id && r.team2_id === home.id) ||
        (r.team1_id === home.id && r.team2_id === away.id)
    );

    if (row !== undefined) {
      claimed.add(row.id);
      const [score1, score2] =
        row.team1_id === away.id ? [game.away.score, game.home.score] : [game.home.score, game.away.score];

      if (row.team1_score === null && row.team2_score === null) {
        entry.action = "enter";
        entry.write = { id: row.id, team1_id: row.team1_id, team2_id: row.team2_id, score1, score2 };
      } else if (
        row.team1_score !== null &&
        row.team2_score !== null &&
        twoPlaces(row.team1_score) === twoPlaces(score1) &&
        twoPlaces(row.team2_score) === twoPlaces(score2)
      ) {
        entry.action = "same";
      } else {
        problems.push({
          line: game.line,
          message:
            `Score mismatch, week ${week.week}: ESPN has ${espnSide(game.away)} – ${espnSide(game.home)}, ` +
            `the site has ${siteSide(teams, row.team1_id, row.team1_score)} – ` +
            `${siteSide(teams, row.team2_id, row.team2_score)}. Fix whichever is wrong; nothing was imported.`,
        });
      }
      continue;
    }

    const elsewhere = rows.find(
      (r) => [away.id, home.id].includes(r.team1_id) || [away.id, home.id].includes(r.team2_id)
    );
    if (elsewhere !== undefined) {
      problems.push({
        line: game.line,
        message:
          `Pairing mismatch, week ${week.week}: ESPN has ${game.away.manager} vs ${game.home.manager}, ` +
          `the site has ${siteSide(teams, elsewhere.team1_id, elsewhere.team1_score)} vs ` +
          `${siteSide(teams, elsewhere.team2_id, elsewhere.team2_score)}.`,
      });
      continue;
    }

    const empty = rows.find(
      (r) =>
        !claimed.has(r.id) &&
        r.team1_id === null && r.team2_id === null &&
        r.team1_score === null && r.team2_score === null
    );
    if (empty === undefined) {
      problems.push({
        line: game.line,
        message: `Week ${week.week}: no empty game left on the site for ${game.away.manager} vs ${game.home.manager}.`,
      });
      continue;
    }

    claimed.add(empty.id);
    entry.action = "enter";
    entry.write = {
      id: empty.id,
      team1_id: away.id,
      team2_id: home.id,
      score1: game.away.score,
      score2: game.home.score,
    };
  }

  if (week.complete) {
    for (const team of teams) {
      if (team.status === "botted" || seen.has(team.id)) continue;
      // Only a fully resolved week can say who is missing; otherwise the
      // unmatched names above are the real problem and this would repeat them.
      if (games.some((game) => game.action === null)) break;
      problems.push({
        line: week.line,
        message: `Week ${week.week}: ${managersOf(team)} ("${team.team_name}") is on the ${year} roster but not in ESPN's week.`,
      });
    }
  }

  return games;
}

/**
 * Reads a pasted ESPN schedule against a season and reports, or with `apply`
 * also writes, in one transaction on the locked season. Returns
 * `{ year, weeks, problems, entered, applied }`; the route answers a refused
 * apply with a 409 carrying the same report.
 */
export async function importSeason(slug, year, body) {
  const league = parseSlug(slug);
  const seasonYear = parseYear(year);
  const { text, apply } = parseImportBody(body);
  const parsed = parseSchedule(text);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: seasons } = await client.query(
      `SELECT s.id, s.year, s.standings_are_imported
         FROM seasons s
         JOIN leagues l ON l.id = s.league_id
        WHERE l.slug = $1 AND s.year = $2
        FOR UPDATE OF s`,
      [league, seasonYear]
    );
    if (seasons.length === 0) throw new RequestError(404, "Season not found");
    const season = seasons[0];

    const problems = [...parsed.problems];
    if (parsed.year !== null && parsed.year !== season.year) {
      problems.push({
        line: null,
        message: `This paste is ESPN's ${parsed.year} season, but the editor is on ${season.year}.`,
      });
    }
    if (season.standings_are_imported) {
      problems.push({
        line: null,
        message: `${season.year}'s standings are imported and cannot be recomputed, so its scores cannot be imported.`,
      });
    }

    const teams = await client.query(
      `SELECT t.id, t.team_name, t.status, ${MANAGERS_OF_TEAM}
         FROM teams t
        WHERE t.season_id = $1 ORDER BY t.id`,
      [season.id]
    ).then((result) => result.rows);

    const { rows: matchups } = await client.query(
      `SELECT id, week, position, team1_id, team1_score, team2_id, team2_score
         FROM matchups WHERE season_id = $1 ORDER BY week, position`,
      [season.id]
    );

    const resolve = sideResolver(teams, season.year, problems);
    const weeks = [];

    for (const week of parsed.weeks) {
      const reason = skippedBecause(week);
      if (reason !== null) {
        weeks.push({ week: week.week, playoff: week.playoff, action: "skipped", reason, games: [] });
        continue;
      }

      const rows = matchups.filter((row) => row.week === week.week);
      if (rows.length === 0) {
        problems.push({ line: week.line, message: `Week ${week.week}: ${season.year} has no week ${week.week} on the site.` });
        continue;
      }

      const games = matchWeek(week, rows, teams, resolve, season.year, problems);
      weeks.push({
        week: week.week,
        playoff: week.playoff,
        action: games.some((game) => game.action === null)
          ? "problem"
          : games.some((game) => game.action === "enter")
            ? "enter"
            : "unchanged",
        games,
      });
    }

    const writes = weeks.flatMap((week) => week.games.filter((game) => game.action === "enter"));
    const applied = apply && problems.length === 0 && writes.length > 0;

    if (applied) {
      for (const { write } of writes) {
        await client.query(
          `UPDATE matchups
              SET team1_id = $2, team1_score = $3, team2_id = $4, team2_score = $5
            WHERE id = $1`,
          [write.id, write.team1_id, twoPlaces(write.score1), write.team2_id, twoPlaces(write.score2)]
        );
      }
      await writeStandings(client, season.id);
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }

    // The row ids stay server-side.
    for (const week of weeks) for (const game of week.games) delete game.write;

    problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    return { year: season.year, weeks, problems, entered: writes.length, applied };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
