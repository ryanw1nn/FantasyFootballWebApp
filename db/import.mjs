// Loads src/data/seasons.json into the tables created by db/migrations/*.sql.
//
//   npm run db:import          truncate and reload
//   npm run db:import -- --yes required when the target is not localhost
//
// Truncate-and-reload, not an upsert. seasons.json stays the source of truth
// until Phase 2, so an edit made mid-phase means running this again — it has to
// be a command you can run without thinking about it. Everything happens in one
// transaction, and the row counts below are checked before the COMMIT: a run
// that would produce the wrong shape rolls back instead of landing.
//
// The five places a 1:1 reading of the JSON would be wrong, all of them decided
// in docs/schema.md and each marked where it happens below:
//
//   1. "Botted Season" is a slot, not a person — 16 distinct names, 15 players.
//   2. jake2020 is a corrupted 'active'. The value ceases to exist here.
//   3. teams[] and standings[] duplicate seven fields and disagree in 2025.
//      standings[] is the correct copy, matching server.js:221's spread.
//   4. Champions store playoff_rounds = 4. The JSON stores 3 for the champion
//      and the runner-up alike, and AllTimeTable.jsx:139 adds the missing one at
//      render time.
//   5. 2020 imports no matchups at all — its 103 rows are 101 empty ones plus a
//      pair of BYEs copied from a later season's grid, describing a bracket it
//      never played.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, describeTarget } from "./pool.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEASONS_JSON = path.join(repoRoot, "src", "data", "seasons.json");

// ---------------------------------------------------------------------------
// What the file means
// ---------------------------------------------------------------------------

const LEAGUE = {
  slug: "fan-club",
  name: "The Fan Club",
  // Template for new seasons only. Season shape is read from the season row.
  regular_season_weeks: 14,
  playoff_start_week: 15,
  team_count: 12,
};

// Per season, because 2020 was a different competition: 12 regular-season games
// and a 12-team, four-round tournament, against 14 and a 6-team bracket since.
const SEASON_SHAPE = {
  2020: { regular_season_weeks: 12, playoff_start_week: 13 },
  default: { regular_season_weeks: 14, playoff_start_week: 15 },
};

// 2020's standings are hand-entered and cannot be derived — the season has no
// scores anywhere. The flag stops the Phase 2 standings writer recomputing them
// out of existence.
const IMPORTED_STANDINGS_YEARS = new Set([2020]);

// See note 5 above.
const YEARS_WITHOUT_MATCHUPS = new Set([2020]);

// A team without a person. Never becomes a players row.
const NOT_A_PLAYER = "Botted Season";

// The literal the JSON uses for an absent opponent.
const BYE = "BYE";

const STATUS_FIXES = { jake2020: "active" };

// A correct run produces exactly these. Checked before COMMIT.
const EXPECTED = {
  leagues: 1,
  players: 15,
  seasons: 6,
  teams: 72,
  matchups: 515, // 505 with two named teams + 10 BYEs, and nothing from 2020
  standings: 72,
  byes: 10, // two per season, 2021-2025
  teamsWithoutPlayer: 1, // 2023's botted slot
};

// ---------------------------------------------------------------------------
// Reading the JSON
// ---------------------------------------------------------------------------

function fail(message) {
  throw new Error(message);
}

function seasonShape(year) {
  return SEASON_SHAPE[year] ?? SEASON_SHAPE.default;
}

function normalizeStatus(state, year, teamName) {
  const status = STATUS_FIXES[state] ?? state;
  if (!status) fail(`${year} "${teamName}" has no state`);
  return status;
}

/**
 * The seven fields stored twice. standings[] wins where it exists, which is the
 * behaviour server.js:221 already has — {...team, ...existingTeam} lets the
 * standings copy win, and win stickily.
 */
function mergedTeams(season, year) {
  const standingsByTeam = new Map(season.standings.map((row) => [row.team, row]));

  return season.teams.map((team) => {
    const authoritative = standingsByTeam.get(team.team) ?? team;

    if (authoritative.name !== team.name) {
      fail(
        `${year} "${team.team}" is ${team.name} in teams[] and ` +
          `${authoritative.name} in standings[]`
      );
    }

    const isSlot = authoritative.name === NOT_A_PLAYER; // note 1
    const status = normalizeStatus(authoritative.state, year, team.team); // note 2

    if (isSlot !== (status === "botted")) {
      fail(`${year} "${team.team}" is ${status} but ${isSlot ? "has" : "lacks"} a player`);
    }

    return {
      team_name: team.team,
      // What the matchups call this team. The botted slot still plays games, so
      // it needs a name to be found by even though it gets no players row.
      json_name: authoritative.name,
      player_name: isSlot ? null : authoritative.name,
      status,
      playoff_rounds: playoffRungs(authoritative, year),
      is_playoff_champ: Boolean(authoritative.playoff.pChampion),
      is_regular_champ: Boolean(authoritative.rChampion),
    };
  });
}

/**
 * The rung actually reached. A champion is 4 here and 3 in the file, where the
 * missing rung is added by the client at render time instead of being stored.
 * See note 4, and the ladder in docs/schema.md.
 */
function playoffRungs(team, year) {
  const { rounds, pChampion } = team.playoff;
  if (!pChampion) return rounds;

  // If the file ever starts storing 4 for a champion, adding one here would
  // silently invent a fifth rung.
  if (rounds !== 3) fail(`${year} champion ${team.name} stores rounds ${rounds}, expected 3`);
  return rounds + 1;
}

function weekNumbers(season) {
  return Object.keys(season.weeks)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Matchup rows for one season, in the order the file lists them. position is
 * that order: PlayoffBracket.jsx slices the week array rather than reading
 * status, so it is data, not bookkeeping.
 */
function matchupRows(season, year) {
  const rows = [];

  for (const week of weekNumbers(season)) {
    season.weeks[week].matchups.forEach((matchup, position) => {
      const team1 = opponent(matchup.team1);
      const team2 = opponent(matchup.team2);

      // 2020 aside, every row names at least one team. A row naming none is an
      // empty placeholder and carries nothing worth storing.
      if (team1 === null && team2 === null) {
        fail(`${year} week ${week} position ${position} names no teams`);
      }

      rows.push({
        week,
        position,
        // Weeks 1-14 omit both keys rather than storing an empty value.
        status: matchup.status || null,
        label: matchup.label || null,
        team1_name: team1,
        team1_score: score(matchup.team1Score),
        team2_name: team2,
        team2_score: score(matchup.team2Score),
      });
    });
  }

  return rows;
}

/** A BYE, an empty slot and a missing key are all "no opponent". */
function opponent(name) {
  if (!name || name === BYE) return null;
  return name;
}

function score(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function standingsRows(season, year) {
  return season.standings.map((row) => ({
    team_name: row.team,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pf: row.pf,
    pa: row.pa,
    place: row.place,
    // Nine of 2020's rows hold an emoji where a place should be, and
    // SeasonTable.jsx:56 subtracts the column. They import as NULL, which is the
    // only intentional difference in the Phase 1.5 diff.
    prev_place: Number.isFinite(row.prevPlace) ? row.prevPlace : null,
    // Absent for all of 2020. NULL is "not recorded"; zeros would claim they
    // played playoff games and lost none.
    playoff_stats: row.playoffStats ? JSON.stringify(row.playoffStats) : null,
    year,
  }));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function truncate(client) {
  // CASCADE reaches seasons, teams, matchups and standings. schema_migrations is
  // untouched — this reloads data, it does not undo migrations.
  await client.query("TRUNCATE leagues, players RESTART IDENTITY CASCADE");
}

async function insertLeague(client) {
  const { rows } = await client.query(
    `INSERT INTO leagues (slug, name, regular_season_weeks, playoff_start_week, team_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      LEAGUE.slug,
      LEAGUE.name,
      LEAGUE.regular_season_weeks,
      LEAGUE.playoff_start_week,
      LEAGUE.team_count,
    ]
  );
  return rows[0].id;
}

/**
 * One row per person, keyed by display name. Keying by name is also what
 * enforces per-league uniqueness of display_name — the constraint the schema
 * cannot express while league membership is implied by teams rather than stored.
 */
async function insertPlayers(client, displayNames) {
  const ids = new Map();

  for (const displayName of displayNames) {
    const { rows } = await client.query(
      `INSERT INTO players (display_name, real_name) VALUES ($1, $2) RETURNING id`,
      [displayName, displayName]
    );
    ids.set(displayName, rows[0].id);
  }

  return ids;
}

async function insertSeason(client, leagueId, year) {
  const shape = seasonShape(year);
  const { rows } = await client.query(
    `INSERT INTO seasons
       (league_id, year, regular_season_weeks, playoff_start_week, standings_are_imported)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      leagueId,
      year,
      shape.regular_season_weeks,
      shape.playoff_start_week,
      IMPORTED_STANDINGS_YEARS.has(year),
    ]
  );
  return rows[0].id;
}

/** Returns team_name -> teams.id for this season, which the matchups need. */
async function insertTeams(client, seasonId, teams, playerIds) {
  const ids = new Map();

  for (const team of teams) {
    // made_playoffs is generated from playoff_rounds and cannot be written.
    const { rows } = await client.query(
      `INSERT INTO teams
         (season_id, player_id, team_name, status,
          playoff_rounds, is_playoff_champ, is_regular_champ)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        seasonId,
        team.player_name === null ? null : playerIds.get(team.player_name),
        team.team_name,
        team.status,
        team.playoff_rounds,
        team.is_playoff_champ,
        team.is_regular_champ,
      ]
    );
    ids.set(team.team_name, rows[0].id);
  }

  return ids;
}

/**
 * The JSON names matchup sides by the entry's `name`, not the team name —
 * recalculateStandings keys its stats object by team.name. Both are unique
 * within a season, so the lookup is exact and there is no fuzzy matching here.
 */
function teamIdByName(teams, teamIds, name, year, where) {
  if (name === null) return null;

  const team = teams.find((candidate) => candidate.json_name === name);
  if (!team) fail(`${year} ${where}: no team for "${name}"`);
  return teamIds.get(team.team_name);
}

async function insertMatchups(client, seasonId, rows, teams, teamIds, year) {
  for (const row of rows) {
    const where = `week ${row.week} position ${row.position}`;
    await client.query(
      `INSERT INTO matchups
         (season_id, week, position, status, label,
          team1_id, team1_score, team2_id, team2_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        seasonId,
        row.week,
        row.position,
        row.status,
        row.label,
        teamIdByName(teams, teamIds, row.team1_name, year, where),
        row.team1_score,
        teamIdByName(teams, teamIds, row.team2_name, year, where),
        row.team2_score,
      ]
    );
  }
}

async function insertStandings(client, seasonId, rows, teamIds) {
  for (const row of rows) {
    const teamId = teamIds.get(row.team_name);
    if (teamId === undefined) fail(`${row.year} standings name no team "${row.team_name}"`);

    await client.query(
      `INSERT INTO standings
         (season_id, team_id, wins, losses, ties, pf, pa, place, prev_place, playoff_stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        seasonId,
        teamId,
        row.wins,
        row.losses,
        row.ties,
        row.pf,
        row.pa,
        row.place,
        row.prev_place,
        row.playoff_stats,
      ]
    );
  }
}

// ---------------------------------------------------------------------------
// Counting what landed
// ---------------------------------------------------------------------------

async function counts(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT count(*) FROM leagues)   AS leagues,
      (SELECT count(*) FROM players)   AS players,
      (SELECT count(*) FROM seasons)   AS seasons,
      (SELECT count(*) FROM teams)     AS teams,
      (SELECT count(*) FROM matchups)  AS matchups,
      (SELECT count(*) FROM standings) AS standings,
      (SELECT count(*) FROM matchups WHERE team1_id IS NULL OR team2_id IS NULL) AS byes,
      (SELECT count(*) FROM teams WHERE player_id IS NULL) AS "teamsWithoutPlayer"
  `);

  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

/** Rolls the whole import back rather than leaving a wrong shape behind. */
function reportCounts(actual) {
  const wrong = [];

  for (const [key, expected] of Object.entries(EXPECTED)) {
    const got = actual[key];
    const ok = got === expected;
    if (!ok) wrong.push(`${key}: expected ${expected}, got ${got}`);
    console.log(`  ${ok ? " " : "!"} ${key.padEnd(19)} ${String(got).padStart(4)}`);
  }

  if (wrong.length > 0) fail(`wrong row counts:\n  ${wrong.join("\n  ")}`);
}

// ---------------------------------------------------------------------------

async function importSeasons(client, data) {
  await truncate(client);

  const leagueId = await insertLeague(client);

  const years = Object.keys(data)
    .map(Number)
    .sort((a, b) => a - b);

  const seasons = years.map((year) => ({ year, teams: mergedTeams(data[year], year) }));

  const displayNames = [
    ...new Set(seasons.flatMap((s) => s.teams.map((t) => t.player_name)).filter(Boolean)),
  ].sort();
  const playerIds = await insertPlayers(client, displayNames);

  for (const { year, teams } of seasons) {
    const seasonId = await insertSeason(client, leagueId, year);
    const teamIds = await insertTeams(client, seasonId, teams, playerIds);

    if (!YEARS_WITHOUT_MATCHUPS.has(year)) {
      const rows = matchupRows(data[year], year);
      await insertMatchups(client, seasonId, rows, teams, teamIds, year);
    }

    await insertStandings(client, seasonId, standingsRows(data[year], year), teamIds);
    console.log(`  imported ${year}`);
  }
}

const client = await pool.connect();
const target = describeTarget();

try {
  // Destructive, and Phase 7 points DATABASE_URL at Neon. Local is a throwaway
  // container, so it stays a one-word command; anything else asks first.
  const isLocal = target.startsWith("localhost:") || target.startsWith("127.0.0.1:");
  if (!isLocal && !process.argv.includes("--yes")) {
    fail(`${target} is not the local container. Re-run with --yes to truncate and reload it.`);
  }

  console.log(`${target}\n`);
  const data = JSON.parse(fs.readFileSync(SEASONS_JSON, "utf-8"));

  await client.query("BEGIN");
  await importSeasons(client, data);

  console.log("");
  reportCounts(await counts(client));
  await client.query("COMMIT");

  console.log("\nImported. Standings are the file's own numbers; Phase 1.4 recomputes");
  console.log("2021-2025 from the matchups, and 2020 stays locked.");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nNothing imported, rolled back: ${err.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
