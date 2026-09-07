// Recomputes stored standings from the matchup rows, for every season of a
// league.
//
//   npm run db:recompute                 fan-club, write the results
//   npm run db:recompute -- --dry-run    compute and report, write nothing
//   npm run db:recompute -- other-league
//
// db:import loads the file's own standings verbatim; this replaces 2021-2025
// with the numbers the matchups actually produce. 2020 is locked and stays as
// imported — it has no scores anywhere, so there is nothing to derive.
//
// Everything runs in one transaction, so a season that fails leaves every
// season's previous rows intact. --dry-run rolls back on purpose, which makes
// it safe to point at any database including a production one.
import { pool, describeTarget } from "./pool.mjs";
import { writeStandings, seasonIds } from "./standings.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slug = args.find((arg) => !arg.startsWith("--")) ?? "fan-club";

async function storedRows(client, seasonId) {
  const { rows } = await client.query(
    `SELECT team_id, wins, losses, ties, pf, pa, place, prev_place
       FROM standings WHERE season_id = $1`,
    [seasonId]
  );
  return new Map(rows.map((row) => [row.team_id, row]));
}

/**
 * How many rows the recompute changed. A summary for the operator, not a
 * verification: playoff_stats is left out, because comparing it means surviving
 * jsonb key reordering and that belongs in a dedicated check.
 */
function countChanges(byTeam, computed) {
  return computed.filter((row) => {
    const was = byTeam.get(row.team_id);
    if (!was) return true;
    // pf and pa are compared as numbers: the stored value is a numeric string
    // with the same scale, so this is an exact comparison, not a tolerance.
    return (
      was.wins !== row.wins ||
      was.losses !== row.losses ||
      was.ties !== row.ties ||
      Number(was.pf) !== Number(row.pf) ||
      Number(was.pa) !== Number(row.pa) ||
      was.place !== row.place ||
      was.prev_place !== row.prev_place
    );
  }).length;
}

const client = await pool.connect();

try {
  console.log(`${describeTarget()}${dryRun ? "  (dry run)" : ""}\n`);

  await client.query("BEGIN");

  const seasons = await seasonIds(client, slug);
  let written = 0;

  for (const season of seasons) {
    if (season.standings_are_imported) {
      console.log(`  ${season.year}  locked — standings stay as imported`);
      continue;
    }

    // A dry run writes too, and rolls the whole transaction back at the end —
    // so it exercises the real writer rather than a read-only imitation of it.
    const before = await storedRows(client, season.id);
    const computed = await writeStandings(client, season.id);

    if (computed === null) {
      console.log(`  ${season.year}  no scored weeks — standings left alone`);
      continue;
    }

    const changed = countChanges(before, computed);
    written += 1;

    const note = changed === 0 ? "unchanged" : `${changed} row(s) differ from stored`;
    console.log(`  ${season.year}  ${String(computed.length).padStart(2)} rows — ${note}`);
  }

  if (dryRun) {
    await client.query("ROLLBACK");
    console.log(`\nDry run — nothing written. ${written} season(s) would be replaced.`);
  } else {
    await client.query("COMMIT");
    console.log(`\n${written} season(s) recomputed.`);
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nNothing written, rolled back: ${err.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
