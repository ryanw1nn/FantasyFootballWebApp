// Creates a season of a league, past or present, laid out and empty, ready for
// scores.
//
//   npm run db:season -- --year 2026
//   npm run db:season -- --year 2026 --drop "Max Strater" \
//                        --add "Patrick O'Donald:Patrick's Perfect Team"
//
// Phase 1's import reads six years out of src/data/seasons.json and stops. Every
// season after that is built by db/season-builder.mjs, which this script, db:league
// and the web's create-season route all share. This file is the terminal's way in:
// it parses the flags, picks the season to copy, and owns the transaction.
// What a built season holds, and why, is written up at the top of the builder.
import { pool, describeTarget } from "./pool.mjs";
import {
  buildSeason,
  leagueBySlug,
  managersLabel,
  nearestSeason,
  nextRoster,
  playoffLayout,
  rosterOf,
  seasonsOf,
} from "./season-builder.mjs";

const DEFAULT_LEAGUE = "fan-club";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const USAGE = `
  npm run db:season -- --year <YYYY> [options]

    --year <YYYY>              the season to create. Required.
    --league <slug>            default ${DEFAULT_LEAGUE}
    --from <YYYY>              roster and playoff layout to copy.
                               Default: the league's nearest season to --year,
                               the earlier one on a tie.
    --drop "<Player>"          leave a player out. Repeatable.
    --add "<Player>:<Team>"    add a player, creating them if new. Repeatable.
    --rename "<Player>:<Team>" carry a player over under a new team name. Repeatable.
    --replace                  delete an existing season of that year first.
                               Refused if any of its matchups carries a score.
    --dry-run                  do everything, report it, then roll back.
`;

function fail(message) {
  throw new Error(message);
}

/** --flag value pairs, with the repeatable ones collected into arrays. */
function parseArgs(argv) {
  const REPEATABLE = new Set(["drop", "add", "rename"]);
  const FLAGS = new Set(["replace", "dry-run", "help"]);
  const args = { drop: [], add: [], rename: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument "${arg}"`);

    const name = arg.slice(2);
    if (FLAGS.has(name)) {
      args[name] = true;
      continue;
    }

    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);

    if (REPEATABLE.has(name)) args[name].push(value);
    else if (["year", "league", "from"].includes(name)) args[name] = value;
    else fail(`unknown option --${name}`);
  }

  return args;
}

/** "Player:Team name" — split on the first colon, because team names hold them. */
function parsePair(value, what) {
  const at = value.indexOf(":");
  if (at < 1) fail(`--${what} wants "Player:Team name", got "${value}"`);

  const player = value.slice(0, at).trim();
  const team = value.slice(at + 1).trim();
  if (player === "" || team === "") fail(`--${what} wants "Player:Team name", got "${value}"`);

  return { player, team };
}

function parseYear(value, what) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    fail(`${what} must be a year between 1900 and 2200, got "${value}"`);
  }
  return year;
}

/** --from if given, otherwise the nearest season in either direction. */
function sourceSeason(seasons, year, explicit) {
  if (explicit !== undefined) {
    const chosen = seasons.find((season) => season.year === explicit);
    if (chosen === undefined) fail(`--from ${explicit} is not a season of this league`);
    return chosen;
  }

  return nearestSeason(seasons, year);
}

// ---------------------------------------------------------------------------

async function createSeason(client, args) {
  const year = parseYear(args.year, "--year");
  const slug = args.league ?? DEFAULT_LEAGUE;
  const edits = {
    drop: args.drop,
    add: args.add.map((value) => parsePair(value, "add")),
    rename: args.rename.map((value) => parsePair(value, "rename")),
  };

  const league = await leagueBySlug(client, slug);
  const seasons = await seasonsOf(client, league.id);

  const existing = seasons.find((season) => season.year === year);
  if (existing !== undefined && !args.replace) {
    fail(`${slug} already has a ${year} season. Pass --replace to rebuild it.`);
  }

  const from = sourceSeason(
    seasons.filter((season) => season.id !== existing?.id),
    year,
    args.from === undefined ? undefined : parseYear(args.from, "--from")
  );

  const previous = await rosterOf(client, from.id);
  const roster = nextRoster(previous, edits);

  const layout = await playoffLayout(client, from.id, from.playoff_start_week);

  const { created, matchups, warnings } = await buildSeason(client, league, {
    year,
    roster,
    layout,
    replacing: existing,
  });

  for (const warning of warnings) console.log(`  ! ${warning}`);
  if (layout.length === 0) {
    console.log(
      `  ! ${from.year} has no playoff rows to copy, so ${year} gets regular-season ` +
        `weeks only. Its bracket has to be laid out by hand.`
    );
  }

  return { league, year, from, roster, created, matchups, layout };
}

function report(result) {
  const { league, year, from, roster, created, matchups, layout } = result;

  console.log(`\n  ${league.name} (${league.slug}) — ${year}, from ${from.year}\n`);
  for (const [index, team] of roster.entries()) {
    const fresh = team.managers.filter((name) => created.includes(name));
    console.log(
      `    ${String(index + 1).padStart(2)}. ${managersLabel(team).padEnd(20)} ` +
        `${team.team_name}${fresh.length > 0 ? `   (new player: ${fresh.join(", ")})` : ""}`
    );
  }

  const regular = matchups - layout.length;
  console.log(
    `\n  ${roster.length} teams, ${matchups} empty matchups ` +
      `(${regular} regular season, ${layout.length} playoff), ` +
      `${roster.length} standings rows at 0-0-0.`
  );
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.year === undefined) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 1);
}

const client = await pool.connect();

try {
  console.log(`${describeTarget()}`);

  await client.query("BEGIN");
  const result = await createSeason(client, args);
  report(result);

  if (args["dry-run"]) {
    await client.query("ROLLBACK");
    console.log("\n  Dry run — rolled back, nothing was written.\n");
  } else {
    await client.query("COMMIT");
    console.log(
      `\n  Created. Open Edit Season Data, pick ${result.year}, and set each week's ` +
        `pairings as they happen.\n`
    );
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nNothing created, rolled back: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
