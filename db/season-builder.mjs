// Builds a season of a league, laid out and empty, ready for scores. Shared by
// db/new-season.mjs (db:season), db:league's first season, and the web route
// that creates a season, so all three write the same shape.
//
// Like db/standings.mjs, everything here takes a client and runs inside the
// caller's transaction: there is no BEGIN or COMMIT, and a refusal is a thrown
// SeasonBuildError the caller rolls back on.
//
// The shape it writes is what the edit page can then fill in:
//
//   seasons    one row, weeks taken from the league template (see 002)
//   teams      the roster it is given, in order
//   matchups   every week of the season, every pairing still empty
//   standings  a zero row per team, so the season renders a table rather than
//              nothing until the first week is scored
//
// The matchups are the point. A week exists in a payload only because some row
// carries its number, so a season with no matchup rows has no weeks, and a week
// with no rows cannot be opened in the editor. Laying all of them out now means
// the season is enterable from the app on day one and nothing has to be re-run
// in October.
//
// Both sides of every seeded row are NULL, which is why something has to tell
// "no opponent" from "nobody picked yet" — the file only ever had the first. The
// rule lives in isBye (src/stats/league.js): exactly one side null is a BYE, and
// the editor renders that as uneditable text; both sides null is a dropdown.
//
// The playoff weeks are copied, not invented: their statuses and labels are the
// bracket's wiring (#1 SEED VS BYE, loser #4/#5 vs loser #3/#6) and
// PlayoffBracket.jsx slices a week by array order, so position has to come
// across with them. Teams and scores do not — nobody has seeded yet.
//
// The roster and the playoff layout are data, not something read here: the
// caller decides where they come from — usually the nearest season, through
// rosterOf, nextRoster and playoffLayout below, but db:league's first season
// has no season to copy and brings its own.

/**
 * A refusal the caller caused: a roster that cannot be built, or a season that
 * cannot be replaced. A script prints the message; a route answers with it.
 */
export class SeasonBuildError extends Error {}

function fail(message) {
  throw new SeasonBuildError(message);
}

// ---------------------------------------------------------------------------
// Reading what already exists
// ---------------------------------------------------------------------------

export async function leagueBySlug(client, slug) {
  const { rows } = await client.query(
    `SELECT id, slug, name, regular_season_weeks, playoff_start_week, team_count
       FROM leagues WHERE slug = $1`,
    [slug]
  );
  if (rows.length === 0) fail(`no league with slug "${slug}"`);
  return rows[0];
}

export async function seasonsOf(client, leagueId) {
  const { rows } = await client.query(
    `SELECT id, year, regular_season_weeks, playoff_start_week
       FROM seasons WHERE league_id = $1 ORDER BY year`,
    [leagueId]
  );
  return rows;
}

/**
 * The season to copy a roster from: the one closest in year, in either
 * direction, so a backfilled 2018 copies 2020 rather than failing, and a season
 * slotted between two others copies its neighbour. On a tie the earlier season
 * wins — a roster carries forward more naturally than it carries back.
 */
export function nearestSeason(seasons, year) {
  let nearest;

  for (const season of seasons) {
    const distance = Math.abs(season.year - year);
    const best = nearest === undefined ? Infinity : Math.abs(nearest.year - year);
    if (distance < best || (distance === best && season.year < nearest.year)) {
      nearest = season;
    }
  }

  if (nearest === undefined) fail(`no other season to copy a roster from — seed the roster by hand`);
  return nearest;
}

export async function rosterOf(client, seasonId) {
  const { rows } = await client.query(
    `SELECT t.player_id, t.team_name, t.status, p.display_name
       FROM teams t
       LEFT JOIN players p ON p.id = t.player_id
      WHERE t.season_id = $1
      ORDER BY t.id`,
    [seasonId]
  );
  return rows;
}

/**
 * The source season's playoff rows, stripped of everything but their shape.
 * A week is identified by its number and a matchup by its position, and both
 * are load-bearing: PlayoffBracket.jsx splits week 15 by slicing the array.
 */
export async function playoffLayout(client, seasonId, playoffStartWeek) {
  const { rows } = await client.query(
    `SELECT week, position, status, label
       FROM matchups
      WHERE season_id = $1 AND week >= $2
      ORDER BY week, position`,
    [seasonId, playoffStartWeek]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Working out the new roster
// ---------------------------------------------------------------------------

/**
 * The source season's teams with the three edits applied, in the order they
 * will be inserted. Order is not cosmetic: db/standings.mjs ranks by team id as
 * its final tiebreak, so it is the order the season lists its teams in forever.
 *
 * A dropped player keeps every row they ever had — a season is a record of who
 * played that year, and leaving the league does not unplay it. Only this year's
 * row goes away. Marking their history inactive is db/player-status.mjs's job.
 */
export function nextRoster(previous, { drop, add, rename }) {
  const dropped = new Set(drop);
  const renamed = new Map(rename.map(({ player, team }) => [player, team]));

  for (const name of dropped) {
    if (!previous.some((team) => team.display_name === name)) {
      fail(`cannot drop "${name}": not on the source season's roster`);
    }
  }
  for (const [name] of renamed) {
    if (!previous.some((team) => team.display_name === name)) {
      fail(`cannot rename "${name}": not on the source season's roster`);
    }
    if (dropped.has(name)) fail(`"${name}" is both dropped and renamed`);
  }

  // A botted slot is last season's abandonment, not this season's roster. It
  // has no player to carry forward, so it is never inherited.
  const carried = previous
    .filter((team) => team.player_id !== null && !dropped.has(team.display_name))
    .map((team) => ({
      display_name: team.display_name,
      team_name: renamed.get(team.display_name) ?? team.team_name,
      // Status is this season's, not last season's: somebody marked inactive in
      // their final year is active again the year they come back.
      status: "active",
    }));

  const added = add.map(({ player, team }) => ({
    display_name: player,
    team_name: team,
    status: "active",
  }));

  const roster = [...carried, ...added];

  const names = new Set();
  for (const team of roster) {
    if (names.has(team.display_name)) fail(`"${team.display_name}" appears twice on the roster`);
    names.add(team.display_name);
  }

  const teamNames = new Set();
  for (const team of roster) {
    if (teamNames.has(team.team_name)) {
      fail(`two teams are both called "${team.team_name}"`);
    }
    teamNames.add(team.team_name);
  }

  return roster;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * A player id per roster name, creating a row for anyone new.
 *
 * display_name is not globally unique — the table is shared across leagues and
 * two different people may share a name — so a lookup is scoped to the league
 * by only ever considering players who already have a team in it. Someone who
 * appears nowhere in this league is new *to this league* and gets a row, which
 * is exactly what the import's per-league rule does.
 */
export async function playerIds(client, leagueId, roster) {
  const { rows: known } = await client.query(
    `SELECT DISTINCT p.id, p.display_name
       FROM players p
       JOIN teams t ON t.player_id = p.id
       JOIN seasons s ON s.id = t.season_id
      WHERE s.league_id = $1`,
    [leagueId]
  );

  const ids = new Map(known.map((row) => [row.display_name, row.id]));
  const created = [];

  for (const team of roster) {
    if (ids.has(team.display_name)) continue;

    // A player row attached to no team in any league is left over from a
    // --replace that deleted the only season they had, and reusing it is both
    // safe and necessary: it belongs to no league, so the name cannot be
    // ambiguous, and inserting alongside it would make the same person two rows
    // — which is what "Patrick O'Donald x2" looked like the first time.
    const { rows: orphans } = await client.query(
      `SELECT p.id FROM players p
        WHERE p.display_name = $1
          AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.player_id = p.id)
        ORDER BY p.id
        LIMIT 1`,
      [team.display_name]
    );

    if (orphans.length > 0) {
      ids.set(team.display_name, orphans[0].id);
      created.push(team.display_name);
      continue;
    }

    const { rows } = await client.query(
      `INSERT INTO players (display_name, real_name) VALUES ($1, $2) RETURNING id`,
      [team.display_name, team.display_name]
    );
    ids.set(team.display_name, rows[0].id);
    created.push(team.display_name);
  }

  return { ids, created };
}

async function insertSeason(client, league, year) {
  // 002 demoted the league's week columns to "the template a new season is
  // created from". This is the one place that reads them.
  const { rows } = await client.query(
    `INSERT INTO seasons
       (league_id, year, regular_season_weeks, playoff_start_week, standings_are_imported)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [league.id, year, league.regular_season_weeks, league.playoff_start_week]
  );
  return rows[0].id;
}

async function insertTeams(client, seasonId, roster, ids) {
  const teamIds = [];

  for (const team of roster) {
    // playoff_rounds and the two champion flags are the season's results and
    // stay at their defaults. made_playoffs is generated and cannot be written.
    const { rows } = await client.query(
      `INSERT INTO teams (season_id, player_id, team_name, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [seasonId, ids.get(team.display_name), team.team_name, team.status]
    );
    teamIds.push(rows[0].id);
  }

  return teamIds;
}

/**
 * Every week of the season, every pairing empty.
 *
 * Regular season: one row per game, so an even roster fills the week. An odd
 * roster leaves one team out every week, and the extra empty row it would need
 * is not something the builder can place — buildSeason refuses rather than
 * guessing.
 *
 * Playoffs: the layout's rows, carrying week, position, status and label and
 * nothing else.
 */
async function insertMatchups(client, seasonId, weeks, gamesPerWeek, layout) {
  let count = 0;

  for (let week = 1; week <= weeks; week++) {
    for (let position = 0; position < gamesPerWeek; position++) {
      await client.query(
        `INSERT INTO matchups (season_id, week, position) VALUES ($1, $2, $3)`,
        [seasonId, week, position]
      );
      count++;
    }
  }

  for (const row of layout) {
    await client.query(
      `INSERT INTO matchups (season_id, week, position, status, label)
       VALUES ($1, $2, $3, $4, $5)`,
      [seasonId, row.week, row.position, row.status, row.label]
    );
    count++;
  }

  return count;
}

/**
 * A zero row per team, in team id order.
 *
 * Without them the season has no standings at all: computeStandings returns
 * null until some week is scored, so nothing writes a table and every view
 * renders an empty one. Twelve teams at 0-0-0 is what a season that has not
 * been played looks like, and the first PUT replaces all of it.
 *
 * playoff_stats stays NULL rather than three zeroed buckets, for the reason
 * 001 gives: zeros claim the team played playoff games and lost none.
 */
async function insertStandings(client, seasonId, teamIds) {
  for (const [index, teamId] of teamIds.entries()) {
    const place = index + 1;
    await client.query(
      `INSERT INTO standings (season_id, team_id, place, prev_place) VALUES ($1, $2, $3, $4)`,
      [seasonId, teamId, place, place]
    );
  }
}

/**
 * Removes an existing season of this year, but never one that has been played.
 * --replace is for fixing a roster typed wrong ten minutes ago; a season with a
 * score in it is the only copy of that score.
 */
async function replaceSeason(client, existing) {
  const { rows } = await client.query(
    `SELECT count(*) AS scored FROM matchups
      WHERE season_id = $1 AND (team1_score IS NOT NULL OR team2_score IS NOT NULL)`,
    [existing.id]
  );

  const scored = Number(rows[0].scored);
  if (scored > 0) {
    fail(
      `${existing.year} already has ${scored} scored matchup(s). --replace will not ` +
        `delete a season that has been played — remove it by hand if that is really what you want.`
    );
  }

  await client.query(`DELETE FROM seasons WHERE id = $1`, [existing.id]);
}

// ---------------------------------------------------------------------------

/**
 * Writes one season: its row, the roster's teams, every week's empty matchups
 * plus the playoff layout, and a zero standings row per team.
 *
 *   league     a leagueBySlug row; the weeks come from its template columns
 *   roster     [{ display_name, team_name, status }], in insertion order
 *   layout     playoff rows to copy, [{ week, position, status, label }]
 *   replacing  optional: an existing season of this year to delete first.
 *              Only db:season --replace passes it; the web never replaces.
 *
 * Returns what was written, plus warnings for the caller to show — things that
 * are allowed but probably not intended. An empty layout is allowed too, but
 * only the caller knows where the layout came from, so it warns about that.
 */
export async function buildSeason(client, league, { year, roster, layout, replacing }) {
  if (roster.length % 2 !== 0) {
    fail(
      `${roster.length} teams is an odd roster, so one team would sit out every week. ` +
        `Only a full week of games can be laid out — add or drop a team to make it ` +
        `even, or create the season even and add the odd team afterwards.`
    );
  }

  const warnings = [];
  if (roster.length !== league.team_count) {
    warnings.push(
      `roster is ${roster.length} teams, league.team_count says ${league.team_count}. ` +
        `Creating it anyway — the column is a template, not a constraint.`
    );
  }

  // Players are resolved before anything is deleted. A --replace rebuilding the
  // season somebody was added in would otherwise drop their only team first,
  // leaving the lookup — which scopes a name by the league's teams — unable to
  // see them, and inserting a second row for the same person.
  const { ids, created } = await playerIds(client, league.id, roster);

  if (replacing !== undefined) await replaceSeason(client, replacing);

  const seasonId = await insertSeason(client, league, year);
  const teamIds = await insertTeams(client, seasonId, roster, ids);
  const matchups = await insertMatchups(
    client,
    seasonId,
    league.regular_season_weeks,
    roster.length / 2,
    layout
  );
  await insertStandings(client, seasonId, teamIds);

  return { seasonId, teamIds, created, matchups, warnings };
}
