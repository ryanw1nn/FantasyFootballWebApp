// The Phase 1 gate: proves the database says what src/data/seasons.json says.
//
//   npm run db:verify        fan-club
//   npm run db:verify -- other-league
//
// Read-only. It opens no transaction and writes nothing, so it is safe to point
// at any database, production included.
//
// The comparison is not one comparison, because the six seasons are not one
// kind of data:
//
//   2021-2025  computed vs the file. Standings are recomputed from the matchup
//              rows and diffed against what the JSON stores. This is the real
//              claim — that the imported matchups reproduce the standings.
//   2020       imported vs the file. All 103 of its matchups carry null scores,
//              so its records, points and places are hand-entered numbers that
//              were never derived from anything. Nothing correct can compute
//              them, and a run that "successfully" did would have invented
//              them. Its stored rows are compared instead.
//
// So the check runs after `db:migrate` and `db:import` alone — `db:recompute`
// is not a prerequisite, because the computed side is produced here rather than
// read back.
//
// Two things make the diff honest rather than merely empty:
//
//   * Rounding is applied to the JSON side only. 61 stored PF/PA values carry
//     JavaScript float accumulation artifacts — 2021's leader is
//     pf: 1808.2600000000002. numeric(8,2) and the hundredths arithmetic in
//     standings.mjs both land on exactly 1808.26, so there is nothing on the
//     database side to round and loosening both sides would hide a real defect.
//   * The nine emoji are whitelisted individually, not tolerated as a class.
//     Nine of 2020's prevPlace values are medals rather than places and import
//     as NULL. Those exact nine rows are the only intentional difference in the
//     whole diff; a tenth is a failure.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, describeTarget } from "./pool.mjs";
import { computeStandings, seasonIds } from "./standings.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEASONS_JSON = path.join(repoRoot, "src", "data", "seasons.json");

const BUCKETS = ["playoff", "toilet", "out"];
const BUCKET_FIELDS = ["wins", "losses", "ties", "pf", "pa"];

// Every field of a standings row, so an ordering bug in the sort shows up in
// `place` rather than passing unnoticed.
const ROW_FIELDS = ["wins", "losses", "ties", "pf", "pa", "place", "prev_place"];

// The emoji. Exactly nine rows, all in 2020 — asserted below rather than
// assumed, so the whitelist cannot quietly grow with the data.
const EXPECTED_EMOJI_ROWS = 9;
const EXPECTED_EMOJI_YEAR = 2020;

// ---------------------------------------------------------------------------
// Normalizing the two sides
// ---------------------------------------------------------------------------

/**
 * A points total as a fixed-scale string. This is the only place rounding
 * happens, and it is only ever reached with a JSON number or a numeric column
 * that already has scale 2 — so it changes the JSON side and no other.
 */
function money(value) {
  if (value === null || value === undefined) return null;
  return Number(value).toFixed(2);
}

function whole(value) {
  return value === null || value === undefined ? null : Number(value);
}

/** Buckets, field by field. jsonb comes back key-reordered; this never looks at key order. */
function normalizeBuckets(stats) {
  if (stats === null || stats === undefined) return null;

  return Object.fromEntries(
    BUCKETS.map((bucket) => {
      const values = stats[bucket] ?? {};
      return [
        bucket,
        {
          wins: whole(values.wins ?? 0),
          losses: whole(values.losses ?? 0),
          ties: whole(values.ties ?? 0),
          pf: money(values.pf ?? 0),
          pa: money(values.pa ?? 0),
        },
      ];
    })
  );
}

function normalizeRow(row) {
  return {
    wins: whole(row.wins),
    losses: whole(row.losses),
    ties: whole(row.ties),
    pf: money(row.pf),
    pa: money(row.pa),
    place: whole(row.place),
    prev_place: whole(row.prev_place),
    playoff_stats: normalizeBuckets(row.playoff_stats),
  };
}

/**
 * The file's side. prevPlace is carried across exactly as the file holds it,
 * emoji included — the nine medals are compared against the database's NULL and
 * come out as differences, which is the point. They are then named one by one
 * by the whitelist rather than the column being excused as a whole.
 */
function jsonRows(season) {
  const hasEmoji = (value) => !Number.isFinite(value);

  return season.standings.map((row) => ({
    team_name: row.team,
    hasEmoji: hasEmoji(row.prevPlace),
    ...normalizeRow({
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pf: row.pf,
      pa: row.pa,
      place: row.place,
      playoff_stats: row.playoffStats ?? null,
    }),
    // Not run through whole(): a medal is not a number and must not become NaN
    // on the way to a comparison that would then pass for the wrong reason.
    prev_place: hasEmoji(row.prevPlace) ? (row.prevPlace ?? null) : Number(row.prevPlace),
  }));
}

// ---------------------------------------------------------------------------
// The database's side
// ---------------------------------------------------------------------------

async function storedRows(client, seasonId) {
  const { rows } = await client.query(
    `SELECT t.team_name, s.wins, s.losses, s.ties, s.pf, s.pa,
            s.place, s.prev_place, s.playoff_stats
       FROM standings s JOIN teams t ON t.id = s.team_id
      WHERE s.season_id = $1`,
    [seasonId]
  );
  return rows.map((row) => ({ team_name: row.team_name, ...normalizeRow(row) }));
}

/** Computed rows carry team ids; names come from the season's teams. */
async function computedRows(client, seasonId) {
  const computed = await computeStandings(client, seasonId);
  if (computed === null) return null;

  const { rows: teams } = await client.query(
    `SELECT id, team_name FROM teams WHERE season_id = $1`,
    [seasonId]
  );
  const names = new Map(teams.map((team) => [team.id, team.team_name]));

  return computed.map((row) => ({ team_name: names.get(row.team_id), ...normalizeRow(row) }));
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

function compareBuckets(expected, actual, report) {
  if (expected === null || actual === null) {
    if (expected !== actual) {
      report("playoff_stats", expected === null ? "absent" : "present", actual === null ? "absent" : "present");
    }
    return;
  }

  for (const bucket of BUCKETS) {
    for (const field of BUCKET_FIELDS) {
      if (expected[bucket][field] !== actual[bucket][field]) {
        report(`playoff_stats.${bucket}.${field}`, expected[bucket][field], actual[bucket][field]);
      }
    }
  }
}

/**
 * One season's rows against the file's. Returns real differences and expected
 * ones separately — an expected difference is one of the nine emoji rows, and
 * only in the prev_place column.
 */
function diffSeason(year, expectedRows, actualRows) {
  const differences = [];
  const expectedDifferences = [];
  const byName = new Map(actualRows.map((row) => [row.team_name, row]));

  for (const expected of expectedRows) {
    const actual = byName.get(expected.team_name);
    if (!actual) {
      differences.push({ year, team: expected.team_name, field: "row", expected: "present", actual: "missing" });
      continue;
    }
    byName.delete(expected.team_name);

    const report = (field, was, is) =>
      differences.push({ year, team: expected.team_name, field, expected: was, actual: is });

    for (const field of ROW_FIELDS) {
      if (expected[field] === actual[field]) continue;

      // The whitelist, applied to exactly one column of exactly the rows the
      // file marks. Anything else on those rows is still a failure.
      if (field === "prev_place" && expected.hasEmoji && actual.prev_place === null) {
        expectedDifferences.push({ year, team: expected.team_name });
        continue;
      }

      report(field, expected[field], actual[field]);
    }

    compareBuckets(expected.playoff_stats, actual.playoff_stats, report);
  }

  for (const leftover of byName.values()) {
    differences.push({ year, team: leftover.team_name, field: "row", expected: "absent", actual: "present" });
  }

  return { differences, expectedDifferences };
}

// ---------------------------------------------------------------------------

function describe(value) {
  return value === null ? "null" : String(value);
}

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith("--")) ?? "fan-club";

const client = await pool.connect();

try {
  console.log(`${describeTarget()}\n`);

  const data = JSON.parse(fs.readFileSync(SEASONS_JSON, "utf-8"));
  const seasons = await seasonIds(client, slug);

  const differences = [];
  const expectedDifferences = [];
  const beyondTheFile = [];
  let compared = 0;

  for (const season of seasons) {
    const fromFile = data[season.year];

    // A season the file does not hold postdates it. seasons.json froze at 2025
    // and the database keeps going — db/new-season.mjs creates the years after
    // it, and the import can never reproduce them. This check is Phase 1's:
    // "the imported history matches the file", and a season that was never
    // imported is outside it. Named in the output rather than passed over
    // silently, so a year that goes missing from the file still shows up.
    if (!fromFile) {
      beyondTheFile.push(season.year);
      console.log(`  ${season.year}      -       skipped  created after seasons.json`);
      continue;
    }

    const expectedRows = jsonRows(fromFile);

    // The split. A locked season is compared against what was imported; every
    // other season against what its matchups produce.
    let actualRows;
    let source;

    if (season.standings_are_imported) {
      actualRows = await storedRows(client, season.id);
      source = "imported";
    } else {
      actualRows = await computedRows(client, season.id);
      source = "computed";
      if (actualRows === null) {
        throw new Error(
          `${season.year} has no scored weeks, so nothing can be computed for it. ` +
            `A season in that state needs standings_are_imported set, not a silent pass.`
        );
      }
    }

    const result = diffSeason(season.year, expectedRows, actualRows);
    differences.push(...result.differences);
    expectedDifferences.push(...result.expectedDifferences);
    compared += expectedRows.length;

    const note =
      result.differences.length === 0
        ? "identical"
        : `${result.differences.length} difference(s)`;
    console.log(
      `  ${season.year}  ${String(expectedRows.length).padStart(2)} rows  ${source.padEnd(8)} ${note}`
    );
  }

  console.log(`\n${compared} team-seasons compared.`);
  if (beyondTheFile.length > 0) {
    console.log(`${beyondTheFile.length} season(s) not in the file, so not compared: ${beyondTheFile.join(", ")}`);
  }

  const failures = [];

  if (differences.length > 0) {
    console.log(`\n${differences.length} unexpected difference(s):`);
    for (const row of differences) {
      console.log(
        `  ${row.year}  ${row.team.padEnd(28)} ${row.field.padEnd(24)} ` +
          `file ${describe(row.expected)} / db ${describe(row.actual)}`
      );
    }
    failures.push(`${differences.length} unexpected difference(s)`);
  }

  if (expectedDifferences.length > 0) {
    console.log(
      `\nExpected differences — ${expectedDifferences.length} prev_place emoji imported as NULL:`
    );
    for (const row of expectedDifferences) console.log(`  ${row.year}  ${row.team}`);
  }

  // The whitelist is checked as a whole: nine rows, all 2020, prev_place only.
  // A season that grows a tenth emoji is a data change worth failing over, and
  // so is one that loses an emoji it should still have.
  const strays = expectedDifferences.filter((row) => row.year !== EXPECTED_EMOJI_YEAR);
  if (expectedDifferences.length !== EXPECTED_EMOJI_ROWS || strays.length > 0) {
    failures.push(
      `expected exactly ${EXPECTED_EMOJI_ROWS} whitelisted prev_place nulls, all in ` +
        `${EXPECTED_EMOJI_YEAR} — got ${expectedDifferences.length}` +
        (strays.length > 0 ? `, ${strays.length} outside ${EXPECTED_EMOJI_YEAR}` : "")
    );
  }

  // One throw with everything, rather than the first check silencing the rest.
  if (failures.length > 0) throw new Error(failures.join("; "));

  console.log("\nVerified. Every season matches seasons.json, with only the nine");
  console.log("whitelisted prev_place nulls differing.");
} catch (err) {
  console.error(`\nNot verified: ${err.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
