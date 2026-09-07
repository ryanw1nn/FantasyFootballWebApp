// The ten places where the database deliberately disagrees with
// src/data/seasons.json, and what each one is worth in a payload.
//
// Phase 1 did not transcribe the file — it corrected it in ten places, each one
// decided and recorded. The compatibility serializer's job is to speak the
// file's dialect anyway, so six of the ten leave no trace in a response and the
// other four are visible differences that the parity run has to expect.
//
// This module is the single record of all ten. It carries no I/O and opens no
// connection: it is the whitelist and the classifier, and scripts/parity.mjs is
// the run that applies them.
//
// Two rules make the whitelist worth having:
//
//   * Named, not tolerated. A kind matches a specific path in a specific
//     section of a specific year — not "ignore prevPlace" or "allow a float
//     wobble". A whitelist that excuses a column excuses the next bug in it.
//   * Counted. Every kind carries the number of differences it is allowed to
//     produce, per section, per year. Too few is a failure as loudly as too
//     many: a translation that stops being needed is a data change, and a
//     divergence that quietly grows is the thing this exists to catch.
//
// The counts below were measured against the imported database on 2026-09-07,
// not estimated.

/**
 * Which parts of a payload each recorded route carries. A kind that lives in
 * `standings` contributes nothing to the weeks route, which has no standings.
 */
export const ROUTE_SECTIONS = {
  season: ["teams", "weeks", "standings"], // /seasons and /seasons/:year
  weeks: ["teams", "weeks"], // /api/seasons/:year/weeks
};

/** The last segment of a path, which is the field name for every kind here. */
const field = (path) => path[path.length - 1];

/**
 * A points total, rounded on the file's side only. 61 of the file's stored
 * PF/PA values carry JavaScript accumulation artifacts — 1808.2600000000002
 * against numeric(8,2)'s exact 1808.26 — and rounding both sides would let a
 * real defect hide behind a symmetric tolerance.
 */
function samePoints(fromFile, fromDatabase) {
  if (typeof fromFile !== "number" || typeof fromDatabase !== "number") return false;

  // The database side is not rounded, it is checked: numeric(8,2) can only hold
  // two decimals, so a value that does not survive the round trip did not come
  // from the column and is a real difference. Only the file's side is moved.
  if (Number(fromDatabase.toFixed(2)) !== fromDatabase) return false;

  return fromFile.toFixed(2) === fromDatabase.toFixed(2);
}

/** A key the payload does not carry at all, which is not the same as null. */
export const ABSENT = Symbol("absent");

// ---------------------------------------------------------------------------
// The ten
// ---------------------------------------------------------------------------
//
// A `translated` divergence is one the serializer reverses, so its expected
// count is zero everywhere and it appears here to be checked, not excused: if
// the translation regresses, the differences it produces match no kind and the
// run fails. A `whitelisted` divergence is a real payload change, and `counts`
// says exactly how much of one.

export const DIVERGENCES = [
  {
    key: "champion-rounds",
    title: "Champion rounds",
    expected: "translated",
    note:
      "The database stores the rung actually reached, 4. The file stores 3 and " +
      "AllTimeTable.jsx:139 adds the missing one at render time, so the " +
      "serializer emits playoff_rounds - 1 for a champion or champions render " +
      "at five rounds. The +1 is deleted in Phase 4/6, not here.",
  },
  {
    key: "botted-slot",
    title: "The botted slot",
    expected: "translated",
    note:
      "2023's abandoned slot has player_id NULL, so there is no display_name to " +
      "read. A team with status = 'botted' emits the literal \"Botted Season\" " +
      "in teams[], standings[] and both matchup sides. Miss it and 2023 renders " +
      "with a blank opponent.",
  },
  {
    key: "matchup-sides",
    title: "Matchup sides",
    expected: "translated",
    note:
      "The file names a side by the player's display name, not the team name. " +
      "The serializer emits players.display_name via the team, with the botted " +
      "rule above.",
  },
  {
    key: "bye",
    title: "BYE",
    expected: "translated",
    note:
      "A NULL team2_id emits the string \"BYE\" with team2Score: null, because " +
      "PlayerStatsPage.jsx:60 skips on that exact string and PlayoffBracket's " +
      "getWinner keys on a falsy team2. Ten rows, two per season 2021-2025.",
  },
  {
    key: "absent-keys",
    title: "Absent keys",
    expected: "translated",
    note:
      "Weeks 1-14 omit status and label entirely rather than storing \"\". A " +
      "NULL column emits no key — not null and not \"\" — or every " +
      "regular-season matchup fails parity.",
  },

  {
    key: "state",
    title: "status -> state",
    expected: "whitelisted",
    note:
      "2020's nine jake2020 teams now say active, so App.jsx:143 goes from 0 " +
      "active teams to 9. Whitelisted, and the point of the exercise.",
    counts: { teams: { 2020: 9 }, standings: { 2020: 9 } },
    matches: (diff) =>
      field(diff.path) === "state" && diff.expected === "jake2020" && diff.actual === "active",
  },
  {
    key: "made-playoffs",
    title: "made_playoffs",
    expected: "whitelisted",
    note:
      "made_playoffs is generated from playoff_rounds >= 1 and emitted as " +
      "playoff.made. 2021 Josh Whelan flips false -> true — the bug 1.2b found. " +
      "A genuine payload difference, and one the gate whitelists rather than fixes.",
    counts: { teams: { 2021: 1 }, standings: { 2021: 1 } },
    matches: (diff) =>
      field(diff.path) === "made" &&
      diff.path[diff.path.length - 2] === "playoff" &&
      diff.expected === false &&
      diff.actual === true,
  },
  {
    key: "weeks-2020",
    title: "2020 has no weeks",
    expected: "whitelisted",
    note:
      "All 103 rows were dropped in 1.3 as template boilerplate, so weeks for " +
      "2020 is {} against 17 weeks of empty rows in the file. The single largest " +
      "whitelisted difference, and the reason it is safe: every one of those rows " +
      "carried null scores and contributed nothing to any view.",
    counts: { weeks: { 2020: 17 } },
    // One difference per absent week key, not per dropped row: the whole week
    // object goes missing, and a diff stops descending where a key is absent.
    matches: (diff) => diff.path.length === 1 && diff.actual === ABSENT,
  },
  {
    key: "split-2025",
    title: "The 2025 split-brain",
    expected: "whitelisted",
    note:
      "teams[] and standings[] disagree in 2025 and standings[] won. Both arrays " +
      "now serialize from the same row, so teams[]'s copy changes: TJ Cairney at " +
      "3 rounds and champion, Max Strater at 3. Two rows, three fields — " +
      "PlayerStatsPage reads teams[] and has been showing the wrong 2025 " +
      "champion; it stops.",
    counts: { teams: { 2025: 3 } },
    // The exact two moves, not the two columns: a champion rung that drifts to
    // 4 lands on the same path and must not be absorbed here.
    matches: (diff) =>
      diff.path[diff.path.length - 2] === "playoff" &&
      ((field(diff.path) === "rounds" && diff.expected === 2 && diff.actual === 3) ||
        (field(diff.path) === "pChampion" &&
          diff.expected === false &&
          diff.actual === true)),
  },
  {
    key: "float-artifacts",
    title: "Float artifacts",
    expected: "whitelisted",
    note:
      "Stored PF/PA values in the file carry JavaScript accumulation artifacts — " +
      "1808.2600000000002 against the database's exact 1808.26. Compared " +
      "numerically at two decimals with only the file's side rounded. 61 sit " +
      "directly on a standings row and 9 more inside playoffStats' buckets, which " +
      "db:verify's count of 61 does not reach.",
    counts: { standings: { 2021: 24, 2022: 14, 2023: 10, 2024: 10, 2025: 12 } },
    matches: (diff) =>
      (field(diff.path) === "pf" || field(diff.path) === "pa") &&
      samePoints(diff.expected, diff.actual),
  },
  {
    key: "prev-place-nulls",
    title: "Nine emoji become nulls",
    expected: "whitelisted",
    note:
      "2020's prevPlace medals imported as NULL and emit as null. " +
      "SeasonTable.jsx:56 already guards with prevPlace != null, so the nine " +
      "cells go from blank (\"🥇\" - 1 is NaN, which matches none of the three " +
      "render branches) to the neutral dash. No client guard is owed in Phase 6.",
    counts: { standings: { 2020: 9 } },
    matches: (diff) =>
      field(diff.path) === "prevPlace" &&
      typeof diff.expected === "string" &&
      diff.actual === null,
  },
];

const WHITELISTED = DIVERGENCES.filter((d) => d.expected === "whitelisted");

/**
 * The kind a single difference belongs to, or null when it belongs to none —
 * which is a parity failure. A difference is
 *
 *   { year, section, path, expected, actual }
 *
 * where `path` is what is left after the year and section are stripped, and
 * either value may be ABSENT.
 */
export function classify(diff) {
  for (const divergence of WHITELISTED) {
    const years = divergence.counts[diff.section];
    if (years === undefined || years[diff.year] === undefined) continue;
    if (divergence.matches(diff)) return divergence.key;
  }
  return null;
}

/**
 * How many differences of each kind one route's payload is allowed to produce.
 * Returns a Map of key -> count, with every whitelisted kind present so a kind
 * that produced nothing is still reported and still fails.
 */
export function expectedCounts(routeKind, years) {
  const sections = ROUTE_SECTIONS[routeKind];
  const totals = new Map(WHITELISTED.map((d) => [d.key, 0]));

  for (const divergence of WHITELISTED) {
    let total = 0;
    for (const section of sections) {
      const perYear = divergence.counts[section] ?? {};
      for (const year of years) total += perYear[year] ?? 0;
    }
    totals.set(divergence.key, total);
  }

  return totals;
}

/** The title to print a kind under, so a run reads as the table it came from. */
export function titleOf(key) {
  return DIVERGENCES.find((d) => d.key === key)?.title ?? key;
}
