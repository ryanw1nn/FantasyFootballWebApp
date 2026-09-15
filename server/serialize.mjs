// Rows -> the shape the JSON file had.
//
// The client is untouched, so this speaks the file's dialect rather than the
// database's: a season is { teams, weeks, standings }, a side of a matchup is a
// player's display name, and an absent value is an absent key.
//
// numeric arrives from pg as a fixed-scale string and every number below goes
// through Number() here. This is the only place that conversion happens — a
// global type parser would also reach db/standings.mjs, which needs the string
// for its hundredths arithmetic.

/** An abandoned slot has no player row, and the file names it in every list. */
const BOTTED = "Botted Season";

/** No opponent is spelled "BYE" in the file, and the client tests for it. */
const NO_OPPONENT = "BYE";

/** What the file calls this team: the person, or the slot. */
export function nameOf(team) {
  return team.status === "botted" ? BOTTED : team.display_name;
}

function number(value) {
  return value === null || value === undefined ? null : Number(value);
}

function buckets(stats) {
  return Object.fromEntries(
    Object.entries(stats).map(([bucket, values]) => [
      bucket,
      {
        wins: number(values.wins),
        losses: number(values.losses),
        ties: number(values.ties),
        pf: number(values.pf),
        pa: number(values.pa),
      },
    ])
  );
}

/**
 * The file stores 3 for a champion and AllTimeTable adds the missing rung at
 * render time; the database stores the rung actually reached. Emitting the
 * stored 4 here would render a champion at five rounds.
 */
function playoff(team) {
  return {
    made: team.made_playoffs,
    rounds: team.is_playoff_champ ? team.playoff_rounds - 1 : team.playoff_rounds,
    pChampion: team.is_playoff_champ,
  };
}

function teamEntry(team) {
  return {
    team: team.team_name,
    name: nameOf(team),
    state: team.status,
    playoff: playoff(team),
    rChampion: team.is_regular_champ,
  };
}

/** A standings row is a team entry plus its record, in the file's key order. */
function standingsEntry(row, team) {
  const entry = {
    ...teamEntry(team),
    wins: number(row.wins),
    losses: number(row.losses),
    pf: number(row.pf),
    pa: number(row.pa),
    place: number(row.place),
    prevPlace: number(row.prev_place),
    ties: number(row.ties),
  };

  // 2020's rows have no playoffStats key at all. A bucket of zeros would claim
  // it played playoff games and lost none.
  if (row.playoff_stats !== null) entry.playoffStats = buckets(row.playoff_stats);

  return entry;
}

function matchupEntry(matchup, teamsById) {
  // A row with neither side filled in is a slot nobody has been put in yet, not
  // a BYE. A season is created with its weeks laid out and its pairings still
  // empty (db/new-season.mjs), and EditSeasonPage renders the literal "BYE" as
  // uneditable text — emitting it here would make a fresh season impossible to
  // fill in from the app.
  //
  // One side null is the real thing and keeps saying "BYE": the #1 and #2 seeds
  // in week 15. Nothing imported from the file is null on both sides, so this
  // branch is invisible to the parity gate and reachable only by a season the
  // file never held.
  const unassigned = matchup.team1_id === null && matchup.team2_id === null;
  const side = (id) => {
    if (id !== null) return nameOf(teamsById.get(id));
    return unassigned ? null : NO_OPPONENT;
  };

  const entry = {
    team1: side(matchup.team1_id),
    team1Score: number(matchup.team1_score),
    team2: side(matchup.team2_id),
    team2Score: number(matchup.team2_score),
  };

  // Weeks before the playoffs omit both keys rather than storing an empty
  // value, which is what the file does and what parity compares against.
  if (matchup.status !== null) entry.status = matchup.status;
  if (matchup.label !== null) entry.label = matchup.label;

  return entry;
}

export function legacyWeeks(bundle) {
  const teamsById = new Map(bundle.teams.map((team) => [team.id, team]));
  const weeks = {};

  for (const matchup of bundle.matchups) {
    if (weeks[matchup.week] === undefined) weeks[matchup.week] = { matchups: [] };
    weeks[matchup.week].matchups.push(matchupEntry(matchup, teamsById));
  }

  return weeks;
}

export function legacyStandings(bundle) {
  const teamsById = new Map(bundle.teams.map((team) => [team.id, team]));

  return bundle.standings.map((row) => standingsEntry(row, teamsById.get(row.team_id)));
}

export function legacySeason(bundle) {
  return {
    teams: bundle.teams.map(teamEntry),
    weeks: legacyWeeks(bundle),
    standings: legacyStandings(bundle),
  };
}

/** Every season of the league, keyed by year, as the whole-league payload was. */
export function legacySeasons(bundles) {
  const payload = {};

  for (const bundle of bundles) payload[bundle.season.year] = legacySeason(bundle);

  return payload;
}
