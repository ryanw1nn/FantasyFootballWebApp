// Marks a player active or inactive across the seasons they played.
//
//   npm run db:player -- --player "Max Strater" --status inactive
//   npm run db:player -- --player "Max Strater" --status active --year 2025
//
// teams.status is stored per team-season, but the league has always used it to
// say something about the person rather than the year: Michael Cassidy carries
// inactive on all five of his rows and Aaron Griffith on all three, in every
// season they played, because they left. The flag is what App.jsx:96 filters on,
// and inactive is off by default — so marking someone inactive is how they stop
// crowding the season and all-time tables once they are gone.
//
// Setting that by hand is six UPDATEs and a chance to miss one, which is the
// whole reason this is a script. It is also the repeatable record of a change
// the import cannot make: db/import.mjs reproduces src/data/seasons.json exactly
// and that file stopped being written in Phase 1. A correction decided after
// that lives here instead, and is re-run after any db:import that rebuilds the
// database.
//
// 'botted' is not offered. A botted row is a slot with no player at all, so
// there is nothing here to name it by, and 001's teams_botted_has_no_player
// would refuse the pairing anyway.
import { pool, describeTarget } from "./pool.mjs";

const DEFAULT_LEAGUE = "fan-club";
const STATUSES = ["active", "inactive"];

const USAGE = `
  npm run db:player -- --player "<Display name>" --status <${STATUSES.join("|")}> [options]

    --player "<name>"    the player, by display name. Required.
    --status <status>    ${STATUSES.join(" | ")}. Required.
    --league <slug>      default ${DEFAULT_LEAGUE}
    --year <YYYY>        just that season. Default: every season they played.
    --dry-run            report the rows, then roll back.
`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const VALUES = new Set(["player", "status", "league", "year"]);
  const FLAGS = new Set(["dry-run", "help"]);
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument "${arg}"`);

    const name = arg.slice(2);
    if (FLAGS.has(name)) {
      args[name] = true;
      continue;
    }
    if (!VALUES.has(name)) fail(`unknown option --${name}`);

    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);
    args[name] = value;
  }

  return args;
}

/**
 * Every team row this player holds in the league, oldest first. Scoped by
 * league because players are shared across them and display_name is not
 * globally unique — a name that means two people must never be updated as one.
 */
async function rowsFor(client, slug, player, year) {
  const { rows } = await client.query(
    `SELECT t.id, t.team_name, t.status, s.year
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       JOIN leagues l ON l.id = s.league_id
       JOIN players p ON p.id = t.player_id
      WHERE l.slug = $1 AND p.display_name = $2 AND ($3::smallint IS NULL OR s.year = $3)
      ORDER BY s.year`,
    [slug, player, year ?? null]
  );
  return rows;
}

/** Two people sharing a display name inside one league would break the update. */
async function requireOnePerson(client, slug, player) {
  const { rows } = await client.query(
    `SELECT count(DISTINCT p.id) AS people
       FROM players p
       JOIN teams t ON t.player_id = p.id
       JOIN seasons s ON s.id = t.season_id
       JOIN leagues l ON l.id = s.league_id
      WHERE l.slug = $1 AND p.display_name = $2`,
    [slug, player]
  );

  const people = Number(rows[0].people);
  if (people > 1) {
    fail(`"${player}" is ${people} different players in ${slug} — this script cannot tell them apart`);
  }
}

async function setStatus(client, args) {
  const slug = args.league ?? DEFAULT_LEAGUE;
  const player = args.player;
  const status = args.status;

  if (!STATUSES.includes(status)) {
    fail(`--status must be one of ${STATUSES.join(", ")}, got "${status}"`);
  }

  let year;
  if (args.year !== undefined) {
    year = Number(args.year);
    if (!Number.isInteger(year)) fail(`--year must be a year, got "${args.year}"`);
  }

  await requireOnePerson(client, slug, player);

  const rows = await rowsFor(client, slug, player, year);
  if (rows.length === 0) {
    fail(
      year === undefined
        ? `"${player}" has no teams in ${slug}`
        : `"${player}" has no team in ${slug} in ${year}`
    );
  }

  const changing = rows.filter((row) => row.status !== status);

  if (changing.length > 0) {
    await client.query(
      `UPDATE teams SET status = $1 WHERE id = ANY($2)`,
      [status, changing.map((row) => row.id)]
    );
  }

  return { slug, player, status, rows, changing };
}

function report({ slug, player, status, rows, changing }) {
  const changed = new Set(changing.map((row) => row.id));

  console.log(`\n  ${player} in ${slug} — ${rows.length} season(s)\n`);
  for (const row of rows) {
    const moved = changed.has(row.id);
    console.log(
      `    ${row.year}  ${row.team_name.padEnd(28)} ` +
        (moved ? `${row.status} -> ${status}` : `${status} (already)`)
    );
  }
  console.log(`\n  ${changing.length} row(s) updated, ${rows.length - changing.length} already ${status}.`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.player === undefined || args.status === undefined) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 1);
}

const client = await pool.connect();

try {
  console.log(`${describeTarget()}`);

  await client.query("BEGIN");
  const result = await setStatus(client, args);
  report(result);

  if (args["dry-run"]) {
    await client.query("ROLLBACK");
    console.log("\n  Dry run — rolled back, nothing was written.\n");
  } else {
    await client.query("COMMIT");
    console.log("");
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nNothing changed, rolled back: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
