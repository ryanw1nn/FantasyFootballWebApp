// Renames a player's team within one season.
//
//   npm run db:team -- --year 2026 --rename "Keith John:EPA THI"
//   npm run db:team -- --year 2026 --rename "Ryan Winn:Ginja Ninjas" \
//                                  --rename "Jimmy Beer:Bistro Beverages"
//
// Team names change between seasons, and sometimes a few weeks into one. This
// is the tool for the second case. db/new-season.mjs takes the same --rename
// pairs while it is building a season, but it refuses to rebuild one that has
// been played — so once a score is in, the rename has to happen in place.
//
// It is a one-column update and nothing else, which is worth stating because it
// looks like it should be more:
//
//   * matchups reference teams by id, so no game moves and no score is touched.
//   * standings reference teams by id too, and serialize the name by reading the
//     team row — so the new name appears immediately, with no db:recompute.
//   * a matchup *side* in the legacy payload is the player's display_name, not
//     the team name (server/serialize.mjs), so weeks render identically either
//     way. The team name shows up in teams[] and standings[] and nowhere else.
//
// What it cannot do is rename the person: display_name lives on players and is
// shared across every season they played. That is a different change with a
// different blast radius, and it is not this script.
import { pool, describeTarget } from "./pool.mjs";

const DEFAULT_LEAGUE = "fan-club";

const USAGE = `
  npm run db:team -- --year <YYYY> --rename "<Player>:<New team name>" [options]

    --year <YYYY>                the season to rename within. Required.
    --rename "<Player>:<Name>"   repeatable. Names the player, not the old team.
    --league <slug>              default ${DEFAULT_LEAGUE}
    --dry-run                    report the changes, then roll back.
`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = { rename: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument "${arg}"`);

    const name = arg.slice(2);
    if (name === "dry-run" || name === "help") {
      args[name] = true;
      continue;
    }

    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);

    if (name === "rename") args.rename.push(value);
    else if (["year", "league"].includes(name)) args[name] = value;
    else fail(`unknown option --${name}`);
  }

  return args;
}

/** "Player:New team name" — split on the first colon; team names contain them. */
function parsePair(value) {
  const at = value.indexOf(":");
  if (at < 1) fail(`--rename wants "Player:New team name", got "${value}"`);

  const player = value.slice(0, at).trim();
  const team = value.slice(at + 1).trim();
  if (player === "" || team === "") fail(`--rename wants "Player:New team name", got "${value}"`);

  return { player, team };
}

/**
 * The season's teams with the person attached. Scoped by league as well as year
 * because display_name is not globally unique — the players table is shared.
 */
async function teamsOf(client, slug, year) {
  const { rows } = await client.query(
    `SELECT t.id, t.team_name, p.display_name
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       JOIN leagues l ON l.id = s.league_id
       LEFT JOIN players p ON p.id = t.player_id
      WHERE l.slug = $1 AND s.year = $2
      ORDER BY t.id`,
    [slug, year]
  );
  if (rows.length === 0) fail(`${slug} has no ${year} season`);
  return rows;
}

async function renameTeams(client, args) {
  const slug = args.league ?? DEFAULT_LEAGUE;
  const year = Number(args.year);
  if (!Number.isInteger(year)) fail(`--year must be a year, got "${args.year}"`);

  const pairs = args.rename.map(parsePair);
  const teams = await teamsOf(client, slug, year);

  // Every rename is resolved and checked before any of them is written, so a
  // bad third pair cannot leave the first two applied. The transaction would
  // roll them back anyway; this makes the error name the real problem rather
  // than whichever constraint tripped first.
  const changes = [];
  const taken = new Map(teams.map((team) => [team.team_name, team.id]));

  for (const { player, team: newName } of pairs) {
    const row = teams.find((candidate) => candidate.display_name === player);
    if (row === undefined) {
      fail(`"${player}" has no team in ${slug} ${year}`);
    }
    if (changes.some((change) => change.id === row.id)) {
      fail(`"${player}" is renamed twice in one run`);
    }

    // UNIQUE (season_id, team_name). Renaming onto a name this season already
    // uses is refused here, where the message can say whose it is.
    const holder = taken.get(newName);
    if (holder !== undefined && holder !== row.id) {
      const other = teams.find((candidate) => candidate.id === holder);
      fail(`${year} already has a team called "${newName}" — ${other.display_name}'s`);
    }

    taken.delete(row.team_name);
    taken.set(newName, row.id);

    changes.push({
      id: row.id,
      player,
      from: row.team_name,
      to: newName,
      unchanged: row.team_name === newName,
    });
  }

  for (const change of changes) {
    if (change.unchanged) continue;
    await client.query(`UPDATE teams SET team_name = $1 WHERE id = $2`, [change.to, change.id]);
  }

  return { slug, year, changes };
}

function report({ slug, year, changes }) {
  console.log(`\n  ${slug} ${year}\n`);
  for (const change of changes) {
    console.log(
      `    ${change.player.padEnd(20)} ${change.from}` +
        (change.unchanged ? `   (already)` : `  ->  ${change.to}`)
    );
  }

  const moved = changes.filter((change) => !change.unchanged).length;
  console.log(`\n  ${moved} team(s) renamed. Scores and standings are untouched.`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.year === undefined || args.rename.length === 0) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 1);
}

const client = await pool.connect();

try {
  console.log(`${describeTarget()}`);

  await client.query("BEGIN");
  const result = await renameTeams(client, args);
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
  console.error(`\nNothing renamed, rolled back: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
