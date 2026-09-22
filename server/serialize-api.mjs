// Rows -> the league-scoped API's shape.
//
// The database's dialect, not the file's: keys are the column names, a team is
// an id, playoff_rounds is the rung actually reached, an absent value is an
// explicit null rather than an absent key, and no opponent is null rather than
// "BYE". None of serialize.mjs's translations belong here — that file exists so
// the four aliases can keep the file's quirks until they are deleted, and a
// quirk taught to both dialects never goes away.
//
// numeric still arrives from pg as a fixed-scale string, so the same Number()
// boundary applies: rows in, JSON-ready values out.

function number(value) {
  return value === null || value === undefined ? null : Number(value);
}

/** A league in the list: enough for a switcher, and nothing else. */
export function apiLeagues(rows) {
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    season_years: row.season_years,
    latest_year: row.season_years.at(-1) ?? null,
  }));
}

/** What a season is configured as. The id stays server-side. */
export function apiSeasonShape(season) {
  return {
    year: season.year,
    regular_season_weeks: season.regular_season_weeks,
    playoff_start_week: season.playoff_start_week,
    standings_are_imported: season.standings_are_imported,
  };
}

export function apiLeague(league, seasons) {
  return {
    slug: league.slug,
    name: league.name,
    seasons: seasons.map(apiSeasonShape),
  };
}

/** display_name is null for a botted slot, which is a team without a person. */
function apiTeam(team) {
  return {
    id: team.id,
    team_name: team.team_name,
    display_name: team.display_name,
    status: team.status,
    playoff_rounds: team.playoff_rounds,
    made_playoffs: team.made_playoffs,
    is_playoff_champ: team.is_playoff_champ,
    is_regular_champ: team.is_regular_champ,
  };
}

/** playoff_stats is null for 2020, where it was never recorded. */
function apiStandingsRow(row) {
  return {
    team_id: row.team_id,
    wins: number(row.wins),
    losses: number(row.losses),
    ties: number(row.ties),
    pf: number(row.pf),
    pa: number(row.pa),
    place: number(row.place),
    prev_place: number(row.prev_place),
    playoff_stats: row.playoff_stats,
  };
}

function apiMatchup(matchup) {
  return {
    position: matchup.position,
    status: matchup.status,
    label: matchup.label,
    team1_id: matchup.team1_id,
    team1_score: number(matchup.team1_score),
    team2_id: matchup.team2_id,
    team2_score: number(matchup.team2_score),
  };
}

function apiTeams(bundle) {
  return bundle.teams.map(apiTeam);
}

export function apiStandings(bundle) {
  return bundle.standings.map(apiStandingsRow);
}

/**
 * Weeks keyed by number, matchups in position order — the order the query
 * returns them in, which is the bracket.
 */
export function apiWeeks(bundle) {
  const weeks = {};

  for (const matchup of bundle.matchups) {
    if (weeks[matchup.week] === undefined) weeks[matchup.week] = { matchups: [] };
    weeks[matchup.week].matchups.push(apiMatchup(matchup));
  }

  return weeks;
}

export function apiSeason(bundle) {
  return {
    season: apiSeasonShape(bundle.season),
    teams: apiTeams(bundle),
    standings: apiStandings(bundle),
    weeks: apiWeeks(bundle),
  };
}

/**
 * Every season of one league, keyed by year — a loop over apiSeason and
 * nothing else. A field derived here rather than there is a second
 * implementation of a season, and the two would drift.
 */
export function apiSeasons(bundles) {
  const seasons = {};

  for (const bundle of bundles) seasons[bundle.season.year] = apiSeason(bundle);

  return seasons;
}
