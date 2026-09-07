// The port of server.js's recalculateStandings, reading matchup rows instead of
// a JSON object. Nothing here is wired into the app yet — server.js still
// serves the JSON, and db/recompute.mjs is the only caller.
//
// The goal is not a better algorithm. It is the same algorithm: what this
// produces gets diffed against the numbers the file already holds, and a "fix"
// applied on the way across makes that diff meaningless. Five behaviours are
// easy to lose by accident, and each is marked below:
//
//   1. A week counts only if some matchup in it has both scores present and
//      both above zero. Unplayed weeks are invisible, which is what stops
//      2025's remaining weeks booking losses for everybody.
//   2. Points accumulate for every matchup in a counted week, but W/L/T only
//      when both scores exceed zero.
//   3. A BYE contributes nothing at all, not even points for the seeded team.
//   4. Playoff weeks route to a playoff / toilet / out bucket by matchup status
//      and never touch the main record — a champion's W-L is regular season only.
//   5. prev_place is a snapshot taken after the second-to-last *scored regular
//      season* week, recomputed from scratch every run rather than stored.
//
// One deliberate departure, and it is arithmetic rather than behaviour: totals
// accumulate in integer hundredths instead of floats. The JSON's stored totals
// carry accumulation artifacts (2021's leader is pf: 1808.2600000000002) that
// numeric(8,2) columns cannot hold and should not be asked to. Summing in
// hundredths lands on exactly 1808.26, which is the number the float was trying
// to be.

const BUCKETS = ["playoff", "toilet", "out"];

// A playoff matchup with no status is scored as 'out', matching the `||` in
// recalculateStandings. matchups_status_known already bounds the column to
// these three plus NULL, so no unknown bucket can arrive here.
const DEFAULT_BUCKET = "out";

// ---------------------------------------------------------------------------
// Reading a season
// ---------------------------------------------------------------------------

/**
 * pg returns numeric as a fixed-scale string ("106.56"), never a float, so it
 * can be split rather than parsed. Scores are non-negative by CHECK.
 */
function hundredths(value) {
  if (value === null || value === undefined) return 0;
  const [whole, fraction = ""] = String(value).split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

function fromHundredths(total) {
  return (total / 100).toFixed(2);
}

async function loadSeason(client, seasonId) {
  const { rows: seasons } = await client.query(
    `SELECT year, playoff_start_week FROM seasons WHERE id = $1`,
    [seasonId]
  );
  if (seasons.length === 0) throw new Error(`no season with id ${seasonId}`);

  // id order is the order the teams appear in for the season, which is the
  // tiebreak both sorts below inherit — see rankTeams.
  const { rows: teams } = await client.query(
    `SELECT id FROM teams WHERE season_id = $1 ORDER BY id`,
    [seasonId]
  );

  const { rows: matchups } = await client.query(
    `SELECT week, status, team1_id, team1_score, team2_id, team2_score
       FROM matchups WHERE season_id = $1 ORDER BY week, position`,
    [seasonId]
  );

  return { season: seasons[0], teams, matchups };
}

// ---------------------------------------------------------------------------
// Computing
// ---------------------------------------------------------------------------

function emptyBucket() {
  return { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
}

function emptyStats() {
  return {
    ...emptyBucket(),
    playoffStats: Object.fromEntries(BUCKETS.map((name) => [name, emptyBucket()])),
  };
}

/** Behaviour 1: a week with no real scores in it does not exist. */
function weekIsScored(matchups) {
  return matchups.some(
    (m) =>
      m.team1_score !== null &&
      m.team2_score !== null &&
      hundredths(m.team1_score) > 0 &&
      hundredths(m.team2_score) > 0
  );
}

function scoredWeeks(matchups) {
  const byWeek = new Map();
  for (const matchup of matchups) {
    if (!byWeek.has(matchup.week)) byWeek.set(matchup.week, []);
    byWeek.get(matchup.week).push(matchup);
  }

  return [...byWeek.entries()]
    .filter(([, weekMatchups]) => weekIsScored(weekMatchups))
    .sort(([a], [b]) => a - b);
}

function applyMatchup(stats, matchup, isPlayoffWeek) {
  // Behaviour 3. Both sides null is 2020's team-less row; one side null is a
  // BYE. Either way there is nothing to book, and the seeded team gets no
  // points for the week it sat out.
  if (matchup.team1_id === null || matchup.team2_id === null) return;

  const score1 = hundredths(matchup.team1_score);
  const score2 = hundredths(matchup.team2_score);

  // Behaviour 4. The season-scoped foreign keys guarantee both teams belong to
  // this season, so both ids are present in stats.
  const [side1, side2] = isPlayoffWeek
    ? [
        stats.get(matchup.team1_id).playoffStats[matchup.status ?? DEFAULT_BUCKET],
        stats.get(matchup.team2_id).playoffStats[matchup.status ?? DEFAULT_BUCKET],
      ]
    : [stats.get(matchup.team1_id), stats.get(matchup.team2_id)];

  // Behaviour 2: points always, record only for a game both teams showed up to.
  side1.pf += score1;
  side1.pa += score2;
  side2.pf += score2;
  side2.pa += score1;

  if (score1 <= 0 || score2 <= 0) return;

  if (score1 > score2) {
    side1.wins++;
    side2.losses++;
  } else if (score2 > score1) {
    side2.wins++;
    side1.losses++;
  } else {
    side1.ties++;
    side2.ties++;
  }
}

/**
 * Wins descending, then points for descending, and no further tiebreak. Array
 * sort is stable, so teams level on both keep the order they were handed in —
 * team id order, which is the order the season lists them. Letting the database
 * decide instead would make places non-deterministic.
 */
function rankTeams(teamIds, stats) {
  return [...teamIds].sort((a, b) => {
    const left = stats.get(a);
    const right = stats.get(b);
    return right.wins - left.wins || right.pf - left.pf;
  });
}

/**
 * Computes one season's standings without writing anything.
 *
 * Returns rows in place order, or null when no week has been scored yet — the
 * early return that keeps a season with no data from having an all-zero table
 * written over it.
 */
export async function computeStandings(client, seasonId) {
  const { season, teams, matchups } = await loadSeason(client, seasonId);

  const teamIds = teams.map((team) => team.id);
  const stats = new Map(teamIds.map((id) => [id, emptyStats()]));

  const weeks = scoredWeeks(matchups);
  if (weeks.length === 0) return null;

  const playoffStart = season.playoff_start_week;

  // Behaviour 5. The snapshot week is the second-to-last *scored regular
  // season* week, not the second-to-last week overall — a season part way
  // through its playoffs still shows movement from the regular season.
  const regularWeeks = weeks.map(([week]) => week).filter((week) => week < playoffStart);
  const snapshotWeek = regularWeeks.length >= 2 ? regularWeeks.at(-2) : null;
  let previousPlaces = new Map();

  for (const [week, weekMatchups] of weeks) {
    const isPlayoffWeek = week >= playoffStart;
    for (const matchup of weekMatchups) applyMatchup(stats, matchup, isPlayoffWeek);

    if (week === snapshotWeek) {
      previousPlaces = new Map(rankTeams(teamIds, stats).map((id, index) => [id, index + 1]));
    }
  }

  return rankTeams(teamIds, stats).map((teamId, index) => {
    const team = stats.get(teamId);
    const place = index + 1;

    return {
      team_id: teamId,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pf: fromHundredths(team.pf),
      pa: fromHundredths(team.pa),
      place,
      // A team never ranked yet sits still rather than jumping from nowhere.
      prev_place: previousPlaces.get(teamId) ?? place,
      playoff_stats: Object.fromEntries(
        BUCKETS.map((name) => {
          const bucket = team.playoffStats[name];
          return [
            name,
            {
              wins: bucket.wins,
              losses: bucket.losses,
              ties: bucket.ties,
              pf: fromHundredths(bucket.pf),
              pa: fromHundredths(bucket.pa),
            },
          ];
        })
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Recomputes one season and replaces its standings rows.
 *
 * The caller owns the transaction — this issues no BEGIN and no COMMIT, which
 * is the whole point of the port: the caller writes a matchup and recomputes
 * the standings it changed in a single transaction, so a reader never sees a
 * score that the table has not caught up with.
 *
 * Returns the rows written, or null when the season was skipped.
 */
export async function writeStandings(client, seasonId) {
  const { rows } = await client.query(
    `SELECT year, standings_are_imported FROM seasons WHERE id = $1`,
    [seasonId]
  );
  if (rows.length === 0) throw new Error(`no season with id ${seasonId}`);

  // 2020's standings were entered by hand and there is nothing to derive them
  // from. Refusing here rather than at the call site means an edit to one of
  // its matchups cannot quietly replace twelve real records with a table
  // computed from that single week.
  if (rows[0].standings_are_imported) return null;

  const computed = await computeStandings(client, seasonId);
  if (computed === null) return null;

  // Replace rather than upsert: a team dropped from the season should lose its
  // row, not keep a stale one.
  await client.query(`DELETE FROM standings WHERE season_id = $1`, [seasonId]);

  for (const row of computed) {
    await client.query(
      `INSERT INTO standings
         (season_id, team_id, wins, losses, ties, pf, pa, place, prev_place, playoff_stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        seasonId,
        row.team_id,
        row.wins,
        row.losses,
        row.ties,
        row.pf,
        row.pa,
        row.place,
        row.prev_place,
        JSON.stringify(row.playoff_stats),
      ]
    );
  }

  return computed;
}

/** Every season of a league, oldest first. Locked seasons included — they are skipped by writeStandings. */
export async function seasonIds(client, slug) {
  const { rows } = await client.query(
    `SELECT s.id, s.year, s.standings_are_imported
       FROM seasons s JOIN leagues l ON l.id = s.league_id
      WHERE l.slug = $1 ORDER BY s.year`,
    [slug]
  );
  if (rows.length === 0) throw new Error(`no league with slug "${slug}"`);
  return rows;
}
