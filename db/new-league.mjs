// Creates a league and its first season, or removes a league again.
//
//   npm run db:league -- --file ~/leagues/league-two.json --dry-run
//   npm run db:league -- --file ~/leagues/league-two.json
//   npm run db:league -- --remove league-two --dry-run
//
// The league row is the one thing the website can never create, so it is made
// here, by hand, from a JSON file kept outside the repo. Its first season is
// built by db/season-builder.mjs, the same code db:season and the web's
// create-season route use; every season after it is created on the website.
//
// The file names the league, its weeks, its playoff layout and its first roster.
// It never holds a passphrase: db:passphrase prompts for that afterwards, so the
// secret is never written to disk. Until it is set, the league reads like any
// other and cannot be unlocked.
//
// --remove is the reverse, and the reason a creation can be tried in production
// at all: it deletes the league's matchups, standings, teams, seasons and row,
// plus the player rows that league alone was using. It refuses fan-club by name.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pool, describeTarget } from "./pool.mjs";
import {
  MAX_MANAGERS,
  buildSeason,
  deleteOrphanedPlayers,
  managersLabel,
  nextRoster,
} from "./season-builder.mjs";

// The one league no script may remove. Its history is the reason any of this
// exists, and a slug typed wrong should not be able to reach it.
const PROTECTED_LEAGUE = "fan-club";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

// The server's own shape for a slug (validate.mjs), narrowed by 001's
// leagues_slug_shape: no leading, trailing or doubled hyphen.
const SLUG = /^(?=[a-z0-9-]{1,40}$)[a-z0-9]+(-[a-z0-9]+)*$/;

// validate.mjs answers 400 for a week above 30, so a season laid out past it
// could never be edited.
const MAX_WEEK = 30;
const MAX_NAME = 120;

const USAGE = `
  npm run db:league -- --file <path> [--dry-run] [--yes]
  npm run db:league -- --remove <slug> [--dry-run] [--yes] [--including-scores]

    --file <path>        create the league that file describes, and its first
                         season. The file lives outside the repo.
    --remove <slug>      delete that league and everything under it.
                         Refuses ${PROTECTED_LEAGUE}.
    --including-scores   let --remove delete a league with scored matchups.
    --dry-run            do everything, report it, then roll back.
    --yes                required when the target is not localhost.

  The passphrase is not part of this. Set it afterwards with
  npm run db:passphrase -- --league <slug>
`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const FLAGS = new Set(["dry-run", "yes", "including-scores", "help"]);
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument "${arg}"`);

    const name = arg.slice(2);
    if (FLAGS.has(name)) {
      args[name] = true;
      continue;
    }
    if (name.startsWith("passphrase")) {
      fail("db:league never takes a passphrase — set it afterwards with db:passphrase");
    }

    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);

    if (name === "file" || name === "remove") args[name] = value;
    else fail(`unknown option --${name}`);
  }

  if (args.file !== undefined && args.remove !== undefined) {
    fail("--file and --remove do opposite things — pass one of them");
  }
  if (args["including-scores"] && args.remove === undefined) {
    fail("--including-scores only means something with --remove");
  }

  return args;
}

// ---------------------------------------------------------------------------
// The input file
// ---------------------------------------------------------------------------

/** "~/x" as the shell would have it, since npm passes the argument through quoted. */
function resolvePath(file) {
  const expanded = file === "~" || file.startsWith("~/") ? path.join(homedir(), file.slice(1)) : file;
  return path.resolve(expanded);
}

/** Every required key present, nothing unknown, and nothing that looks like a secret. */
function checkKeys(object, required, where, optional = []) {
  for (const key of Object.keys(object)) {
    if (/pass|secret|hash/i.test(key)) {
      fail(`${where} has a "${key}" key. The file never holds a passphrase — db:passphrase prompts for it.`);
    }
    if (!required.includes(key) && !optional.includes(key)) fail(`${where} has an unknown key "${key}"`);
  }
  for (const key of required) {
    if (object[key] === undefined) fail(`${where} is missing "${key}"`);
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value, where) {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_NAME) {
    fail(`${where} must be text of 1 to ${MAX_NAME} characters`);
  }
  return value.trim();
}

function whole(value, where, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${where} must be a whole number from ${min} to ${max}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The playoff weeks as the builder wants them: one row per game, carrying the
 * week, its position in the week, and the status and label that wire the
 * bracket. The file lists them week by week from playoff_start_week on, each
 * week an array of { status, label } in the order the bracket draws them —
 * PlayoffBracket.jsx keeps array order within a column, so position is data.
 *
 * The rows are spelled out rather than generated from a team count and a number
 * of byes because the labels and the consolation games are each league's own:
 * Fan Club's week 17 has a third-place game and three "out" games no rule would
 * have produced.
 */
function parseLayout(weeks, playoffStartWeek) {
  if (!Array.isArray(weeks)) fail(`"playoffs" must be an array of weeks`);

  const lastWeek = playoffStartWeek + weeks.length - 1;
  if (weeks.length > 0 && lastWeek > MAX_WEEK) {
    fail(`the playoffs would run to week ${lastWeek}, past the editor's week ${MAX_WEEK}`);
  }

  const layout = [];
  for (const [index, games] of weeks.entries()) {
    const week = playoffStartWeek + index;
    if (!Array.isArray(games) || games.length === 0) {
      fail(`playoffs[${index}] (week ${week}) must be a non-empty array of games`);
    }

    for (const [position, game] of games.entries()) {
      const where = `playoffs[${index}][${position}] (week ${week})`;
      if (!isObject(game)) fail(`${where} must be { "status": ..., "label": ... }`);
      checkKeys(game, ["status", "label"], where);
      if (!["playoff", "toilet", "out"].includes(game.status)) {
        fail(`${where} has status "${game.status}" — it must be playoff, toilet or out`);
      }
      layout.push({ week, position, status: game.status, label: text(game.label, `${where} label`) });
    }
  }

  return layout;
}

/**
 * One manager in a roster entry: a name, or `{ name, real_name }`. real_name
 * defaults to the display name, which is what the builder writes.
 */
function parseOwner(owner, where) {
  if (typeof owner === "string") return { name: text(owner, where), realName: null };
  if (!isObject(owner)) fail(`${where} must be a name or { "name": ..., "real_name": ... }`);

  checkKeys(owner, ["name"], where, ["real_name"]);
  return {
    name: text(owner.name, `${where} name`),
    realName: owner.real_name === undefined ? null : text(owner.real_name, `${where} real_name`),
  };
}

/**
 * The roster as the builder wants it, in file order — which is the order the
 * season lists its teams forever, since standings break a final tie by team id.
 * Duplicates are refused by nextRoster, the same check db:season runs.
 *
 * An entry has `owner` (one manager, with an optional `real_name` beside it) or
 * `owners` (a co-managed team, each a name or `{ name, real_name }`), not both.
 * Every manager of a team is credited with all of it.
 */
function parseRoster(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail(`"roster" must be a non-empty array`);

  const realNames = new Map();
  const add = entries.map((entry, index) => {
    const where = `roster[${index}]`;
    if (!isObject(entry)) fail(`${where} must be { "owner": ..., "team": ... }`);

    let owners;
    if (entry.owners !== undefined) {
      if (entry.owner !== undefined) fail(`${where} has both "owner" and "owners" — use one`);
      if (entry.real_name !== undefined) {
        fail(`${where} real_name goes on each owner: "owners": [{ "name": ..., "real_name": ... }]`);
      }
      checkKeys(entry, ["owners", "team"], where);
      if (!Array.isArray(entry.owners) || entry.owners.length === 0) {
        fail(`${where} owners must be a non-empty array`);
      }
      if (entry.owners.length > MAX_MANAGERS) {
        fail(`${where} has ${entry.owners.length} owners; a team can have ${MAX_MANAGERS}`);
      }
      owners = entry.owners.map((owner, i) => parseOwner(owner, `${where} owners[${i}]`));
    } else {
      checkKeys(entry, ["owner", "team"], where, ["real_name"]);
      owners = [parseOwner({ name: entry.owner, real_name: entry.real_name }, where)];
    }

    for (const owner of owners) {
      if (owner.realName !== null) realNames.set(owner.name, owner.realName);
    }
    return { players: owners.map((owner) => owner.name), team: text(entry.team, `${where} team`) };
  });

  const roster = nextRoster([], { drop: [], add, rename: [] });
  return { roster, realNames };
}

function readLeagueFile(file) {
  const full = resolvePath(file);

  // The file is a roster of real people and lives with the other things that
  // stay off GitHub. Refusing it here is cheaper than noticing it in a diff.
  if (full === REPO_ROOT || full.startsWith(REPO_ROOT + path.sep)) {
    fail(`${file} is inside the repo. Keep the league file outside it, e.g. ~/fantasy-football-leagues/.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(full, "utf8"));
  } catch (err) {
    fail(`could not read ${file}: ${err.message}`);
  }
  if (!isObject(parsed)) fail(`${file} must hold one JSON object`);

  checkKeys(
    parsed,
    ["name", "slug", "first_season", "regular_season_weeks", "playoff_start_week", "playoffs", "roster"],
    file
  );
  const { playoffs, roster: rosterEntries, ...league } = parsed;

  const slug = league.slug;
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    fail(`slug "${slug}" must be 1-40 lowercase letters, digits and single hyphens, like "league-two"`);
  }

  const regularSeasonWeeks = whole(league.regular_season_weeks, "regular_season_weeks", 1, MAX_WEEK - 1);
  const playoffStartWeek = whole(league.playoff_start_week, "playoff_start_week", 2, MAX_WEEK);
  if (playoffStartWeek <= regularSeasonWeeks) {
    fail(
      `playoff_start_week (${playoffStartWeek}) must be greater than regular_season_weeks ` +
        `(${regularSeasonWeeks}) — leagues_weeks_ordered refuses anything else`
    );
  }

  return {
    name: text(league.name, "name"),
    slug,
    year: whole(league.first_season, "first_season", 1900, 2200),
    regularSeasonWeeks,
    playoffStartWeek,
    layout: parseLayout(playoffs, playoffStartWeek),
    ...parseRoster(rosterEntries),
  };
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

async function createLeague(client, spec) {
  const { rows: taken } = await client.query(`SELECT 1 FROM leagues WHERE slug = $1`, [spec.slug]);
  if (taken.length > 0) fail(`a league with slug "${spec.slug}" already exists`);

  // team_count is the template a later season's warning compares against, so it
  // starts as the first roster's size. write_secret_hash stays NULL: no
  // passphrase, so nobody can unlock it until db:passphrase runs.
  const { rows } = await client.query(
    `INSERT INTO leagues (slug, name, playoff_start_week, regular_season_weeks, team_count)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, slug, name, regular_season_weeks, playoff_start_week, team_count`,
    [spec.slug, spec.name, spec.playoffStartWeek, spec.regularSeasonWeeks, spec.roster.length]
  );
  const [league] = rows;

  const { seasonId, created, matchups, warnings } = await buildSeason(client, league, {
    year: spec.year,
    roster: spec.roster,
    layout: spec.layout,
  });

  // The builder writes real_name as the display name. Where the file gave one,
  // set it on the player row that manager now is.
  for (const [name, realName] of spec.realNames) {
    await client.query(
      `UPDATE players p SET real_name = $1
         FROM team_managers m
        WHERE m.season_id = $2 AND m.player_id = p.id AND p.display_name = $3`,
      [realName, seasonId, name]
    );
  }

  return { league, created, matchups, warnings };
}

function reportCreated(spec, { league, created, matchups, warnings }) {
  for (const warning of warnings) console.log(`  ! ${warning}`);
  if (spec.layout.length === 0) {
    console.log(
      `  ! "playoffs" is empty, so ${spec.year} gets regular-season weeks only and ` +
        `every later season copies none.`
    );
  }

  console.log(`\n  ${league.name} (${league.slug}) — first season ${spec.year}\n`);
  for (const [index, team] of spec.roster.entries()) {
    const reused = team.managers.filter((name) => !created.includes(name));
    console.log(
      `    ${String(index + 1).padStart(2)}. ${managersLabel(team).padEnd(20)} ` +
        `${team.team_name}${reused.length > 0 ? `   (existing player row: ${reused.join(", ")})` : ""}`
    );
  }

  const playoffWeeks = new Set(spec.layout.map((row) => row.week)).size;
  console.log(
    `\n  Weeks 1-${spec.regularSeasonWeeks} regular season, ` +
      (playoffWeeks === 0
        ? `no playoff weeks.`
        : `weeks ${spec.playoffStartWeek}-${spec.playoffStartWeek + playoffWeeks - 1} playoffs.`) +
      `\n  ${spec.roster.length} teams, ${matchups} empty matchups ` +
      `(${matchups - spec.layout.length} regular season, ${spec.layout.length} playoff), ` +
      `${spec.roster.length} standings rows at 0-0-0. No passphrase.`
  );
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

/**
 * Deletes one league, child tables first. The foreign keys would cascade most
 * of this from the league row, but matchups reference teams ON DELETE RESTRICT,
 * and naming each table makes the count of what went away exact.
 *
 * Players have no league of their own, so the ones removed are the ones this
 * league had a team for and nothing else does once its teams are gone. An
 * orphan left behind by some other script is not this league's to delete.
 */
async function removeLeague(client, slug, { includingScores }) {
  if (slug === PROTECTED_LEAGUE) fail(`${PROTECTED_LEAGUE} is never removed by a script`);

  const { rows: leagues } = await client.query(`SELECT id, name FROM leagues WHERE slug = $1`, [slug]);
  if (leagues.length === 0) fail(`no league with slug "${slug}"`);
  const [league] = leagues;

  const { rows: scoredRows } = await client.query(
    `SELECT count(*) AS scored FROM matchups m JOIN seasons s ON s.id = m.season_id
      WHERE s.league_id = $1 AND (m.team1_score IS NOT NULL OR m.team2_score IS NOT NULL)`,
    [league.id]
  );
  const scored = Number(scoredRows[0].scored);
  if (scored > 0 && !includingScores) {
    fail(
      `${slug} has ${scored} scored matchup(s), and this would delete the only copy. ` +
        `Take a dump first, then re-run with --including-scores.`
    );
  }

  const { rows: playerRows } = await client.query(
    `SELECT DISTINCT m.player_id FROM team_managers m JOIN seasons s ON s.id = m.season_id
      WHERE s.league_id = $1`,
    [league.id]
  );
  const playerIds = playerRows.map((row) => row.player_id);

  const seasonsOfLeague = `SELECT id FROM seasons WHERE league_id = $1`;
  const deleted = {};
  deleted.matchups = (
    await client.query(`DELETE FROM matchups WHERE season_id IN (${seasonsOfLeague})`, [league.id])
  ).rowCount;
  deleted.standings = (
    await client.query(`DELETE FROM standings WHERE season_id IN (${seasonsOfLeague})`, [league.id])
  ).rowCount;
  // team_managers goes with its teams, by cascade.
  deleted.teams = (
    await client.query(`DELETE FROM teams WHERE season_id IN (${seasonsOfLeague})`, [league.id])
  ).rowCount;
  deleted.seasons = (await client.query(`DELETE FROM seasons WHERE league_id = $1`, [league.id])).rowCount;
  deleted.leagues = (await client.query(`DELETE FROM leagues WHERE id = $1`, [league.id])).rowCount;
  deleted.players = await deleteOrphanedPlayers(client, playerIds);

  return { league, scored, deleted, kept: playerIds.length - deleted.players };
}

function reportRemoved(slug, { league, scored, deleted, kept }) {
  console.log(`\n  ${league.name} (${slug}) — removed\n`);
  for (const [table, count] of Object.entries(deleted)) {
    console.log(`    ${table.padEnd(10)} ${count}`);
  }
  if (scored > 0) console.log(`\n  ${scored} of those matchups carried scores.`);
  if (kept > 0) console.log(`\n  ${kept} player row(s) kept: they still have a team in another league.`);
}

// ---------------------------------------------------------------------------

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`\n${err.message}\n${USAGE}`);
  process.exit(1);
}

if (args.help || (args.file === undefined && args.remove === undefined)) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 1);
}

const target = describeTarget();
const client = await pool.connect();

try {
  // Production is one env var away. Local stays one command; anything else asks.
  const isLocal = target.startsWith("localhost:") || target.startsWith("127.0.0.1:");
  if (!isLocal && !args.yes) {
    fail(`${target} is not the local container. Re-run with --yes to write there.`);
  }

  console.log(target);

  // Read and checked before the transaction opens, so a bad file costs nothing.
  const spec = args.file === undefined ? null : readLeagueFile(args.file);

  await client.query("BEGIN");
  if (spec === null) {
    reportRemoved(
      args.remove,
      await removeLeague(client, args.remove, { includingScores: args["including-scores"] })
    );
  } else {
    reportCreated(spec, await createLeague(client, spec));
  }

  if (args["dry-run"]) {
    await client.query("ROLLBACK");
    console.log("\n  Dry run — rolled back, nothing was written.\n");
  } else {
    await client.query("COMMIT");
    console.log(
      spec === null
        ? "\n  Removed.\n"
        : `\n  Created. Next: npm run db:passphrase -- --league ${spec.slug}` +
            `${isLocal ? "" : " --yes"}, with the commissioner typing.\n`
    );
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nNothing written, rolled back: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
