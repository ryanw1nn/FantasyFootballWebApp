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
    `SELECT year, playoff_start_week, regular_season_weeks FROM seasons WHERE id = $1`,
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
  return standingsFrom(await loadSeason(client, seasonId));
}

function standingsFrom({ season, teams, matchups }) {
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
// Results: the rung each team reached and the two titles
// ---------------------------------------------------------------------------
//
// playoff_rounds, is_playoff_champ and is_regular_champ used to be imported
// from the JSON and never derived, so a season created here kept every team at
// 0 and no champion however far it was played. They are now derived from the
// same matchup rows as the standings, on the ladder in docs/schema.md:
//
//   A round is a week from playoff_start_week on with a 'playoff' matchup in
//   it. The last round is the final, so losing in round r of R rounds is rung
//   r + 3 - R: 3 in the final, 2 in the semi, 1 in the round before, and 0 in
//   any play-in earlier than that. Advancing past a round adds one, a BYE
//   advances, and only the final's winner reaches 4.
//
// Only scored weeks count, so the results describe the season as played so
// far: a round not yet scored moves nobody up.

const FINAL_RUNG = 3;

/** Whether teamId came through a playoff matchup: won a game both teams scored in, or had a BYE. */
function advanced(matchup, teamId) {
  if (matchup.team1_id === null || matchup.team2_id === null) return true;

  const score1 = hundredths(matchup.team1_score);
  const score2 = hundredths(matchup.team2_score);
  if (score1 <= 0 || score2 <= 0 || score1 === score2) return false;

  return (score1 > score2 ? matchup.team1_id : matchup.team2_id) === teamId;
}

function playoffMatchups(matchups, week) {
  return matchups.filter((m) => m.week === week && m.status === "playoff");
}

/** The playoff champion's team id, or null until the final has a winner. */
function championOf(finalMatchups) {
  const games = finalMatchups.filter((m) => m.team1_id !== null && m.team2_id !== null);
  // More than one game in the last round means there is no single final.
  if (games.length !== 1) return null;

  const [game] = games;
  if (advanced(game, game.team1_id)) return game.team1_id;
  if (advanced(game, game.team2_id)) return game.team2_id;
  return null;
}

/** The rung each team reached so far, keyed by team id. Teams that never appear reach 0. */
function playoffRungs(season, matchups, scored) {
  const rounds = [...new Set(matchups.filter((m) => m.status === "playoff").map((m) => m.week))]
    .filter((week) => week >= season.playoff_start_week)
    .sort((a, b) => a - b);

  const rungs = new Map();
  let champion = null;

  rounds.forEach((week, index) => {
    if (!scored.has(week)) return;
    const round = index + 1;
    const reached = round + FINAL_RUNG - rounds.length;

    for (const matchup of playoffMatchups(matchups, week)) {
      for (const teamId of [matchup.team1_id, matchup.team2_id]) {
        if (teamId === null) continue;
        const rung = reached + (advanced(matchup, teamId) ? 1 : 0);
        rungs.set(teamId, Math.max(0, Math.min(rung, FINAL_RUNG)));
      }
    }

    if (round === rounds.length) champion = championOf(playoffMatchups(matchups, week));
  });

  if (champion !== null) rungs.set(champion, FINAL_RUNG + 1);
  return { rungs, champion };
}

/**
 * Each team's playoff rung and titles, keyed by team id. The regular season
 * champion is first place once every regular season week is scored — playoff
 * games never touch the main record, so that place cannot move afterwards.
 */
function resultsFrom({ season, teams, matchups }, standings) {
  const scored = new Set(scoredWeeks(matchups).map(([week]) => week));
  const { rungs, champion } = playoffRungs(season, matchups, scored);

  const regularScored = [...scored].filter((week) => week < season.playoff_start_week).length;
  const regularChampion =
    standings !== null && regularScored >= season.regular_season_weeks
      ? standings[0].team_id
      : null;

  return new Map(
    teams.map(({ id }) => [
      id,
      {
        playoff_rounds: rungs.get(id) ?? 0,
        is_playoff_champ: id === champion,
        is_regular_champ: id === regularChampion,
      },
    ])
  );
}

/** Computes one season's playoff rungs and titles without writing anything. */
export async function computeResults(client, seasonId) {
  const loaded = await loadSeason(client, seasonId);
  return resultsFrom(loaded, standingsFrom(loaded));
}

async function writeResults(client, results) {
  for (const [teamId, result] of results) {
    await client.query(
      `UPDATE teams SET playoff_rounds = $2, is_playoff_champ = $3, is_regular_champ = $4
        WHERE id = $1`,
      [teamId, result.playoff_rounds, result.is_playoff_champ, result.is_regular_champ]
    );
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Recomputes one season, replaces its standings rows, and rewrites each team's
 * playoff rung and titles.
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

  const loaded = await loadSeason(client, seasonId);
  const computed = standingsFrom(loaded);

  // Results are written even with no scored week, so clearing every score
  // takes the titles away with it.
  await writeResults(client, resultsFrom(loaded, computed));
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
