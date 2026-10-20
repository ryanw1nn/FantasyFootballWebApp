// ==================================
// stats/allTime.js
// ==================================

/**
 * Career totals and per-season awards for one league.
 *
 * Pure, and one league by signature: `allData` is one league's seasons and
 * nothing else, so no total here can span two leagues.
 */

import { isPlayerTeam, joinStandings, managersOf, teamsById, weekIsScored } from './league';

/**
 * Each season's points-for leader, points-against leader and last place, each
 * as the team's managers: a co-managed team's title is both of theirs.
 *
 * Every one of them is only handed out once a season's regular season is over,
 * so a leader part way through the year does not yet hold the title and the
 * team at the bottom is not yet last.
 *
 * @param {Object} allData - one league's seasons, keyed by year, each an array of joined rows
 * @param {Set<string>} [finishedYears] - years whose regular season is over; absent counts every year
 * @returns {{pfLeadersByYear: Object, paLeadersByYear: Object, lastPlaceByYear: Object}}
 */
export function seasonLeaders(allData, finishedYears) {
  const pfLeadersByYear = {};
  const paLeadersByYear = {};
  const lastPlaceByYear = {};

  Object.entries(allData)
    .filter(([year]) => !isNaN(Number(year)))
    .forEach(([seasonYear, season]) => {
      if (!Array.isArray(season)) return;

      let maxPF = -1;
      let pfLeader = null;
      let maxPA = -1;
      let paLeader = null;
      let maxPlace = -1;
      let lastPlace = null;
      season.forEach((row) => {
        // A botted slot is not a player, so it cannot hold an award. It is
        // still a row of the season, which is why it is skipped here rather
        // than filtered out of the season first.
        if (!isPlayerTeam(row)) return;

        if ((row.pf || 0) > maxPF) {
          maxPF = row.pf || 0;
          pfLeader = managersOf(row);
        }
        if ((row.pa || 0) > maxPA) {
          maxPA = row.pa || 0;
          paLeader = managersOf(row);
        }
        if (row.place != null && row.place > maxPlace) {
          maxPlace = row.place;
          lastPlace = managersOf(row);
        }
      });
      if (pfLeader && (!finishedYears || finishedYears.has(seasonYear))) {
        pfLeadersByYear[seasonYear] = pfLeader;
      }
      if (paLeader && (!finishedYears || finishedYears.has(seasonYear))) {
        paLeadersByYear[seasonYear] = paLeader;
      }
      if (lastPlace && (!finishedYears || finishedYears.has(seasonYear))) {
        lastPlaceByYear[seasonYear] = lastPlace;
      }
    });

  return { pfLeadersByYear, paLeadersByYear, lastPlaceByYear };
}

/**
 * The seasons a status filter leaves standing, year by year.
 *
 * Only ever used to decide *which players are listed*. No number on this table
 * is computed from what it returns.
 *
 * @param {Object} allData - one league's seasons, keyed by year
 * @param {Object} [statusFilter] - status -> shown; absent shows everything
 * @returns {Object} the same shape, with hidden rows dropped
 */
function onlyShown(allData, statusFilter) {
  if (!statusFilter) return allData;

  return Object.fromEntries(
    Object.entries(allData).map(([year, season]) => [
      year,
      Array.isArray(season) ? season.filter((row) => statusFilter[row.status]) : season,
    ])
  );
}

/** The players named anywhere in these seasons. */
function playersIn(allData) {
  const names = new Set();
  for (const season of Object.values(allData)) {
    if (!Array.isArray(season)) continue;
    for (const row of season) {
      for (const name of managersOf(row)) names.add(name);
    }
  }
  return names;
}

/**
 * Players whose whole careers are the same team-seasons, keyed by each name.
 *
 * Two people who have only ever run a team together have identical careers, so
 * the all-time table lists them as one row. A player who has also run a team
 * without the other has a career of their own and keeps their own row.
 *
 * @param {Object} allData - one league's seasons, keyed by year, each an array of joined rows
 * @returns {Map<string, string[]>} name -> everyone sharing that career, the name included
 */
function sharedCareers(allData) {
  const careers = new Map();
  for (const [year, season] of Object.entries(allData)) {
    if (isNaN(Number(year)) || !Array.isArray(season)) continue;
    for (const row of season) {
      for (const name of managersOf(row)) {
        const career = careers.get(name) ?? [];
        career.push(`${year}:${row.team_id}`);
        careers.set(name, career);
      }
    }
  }

  const namesByCareer = new Map();
  for (const [name, career] of careers) {
    const key = career.sort().join('|');
    namesByCareer.set(key, [...(namesByCareer.get(key) ?? []), name]);
  }

  const groups = new Map();
  for (const names of namesByCareer.values()) {
    for (const name of names) groups.set(name, names);
  }
  return groups;
}

/** The row label for a player: theirs alone, or "Alex & Blake" for a shared career. */
function careerLabel(groups, name) {
  return (groups.get(name) ?? [name]).join(' & ');
}

/**
 * One row per player: career record, points, championships and award years.
 *
 * A co-managed team's season counts in full toward each of its managers, so two
 * people who ran a team together each carry its record, and keep their own
 * careers when they later run teams apart. Players who have only ever played
 * together share one row, with every name in `names`.
 *
 * The filter chooses rows; it does not change what a row says (6.2(g)). Every
 * award and every total here is computed over the whole league — each season's
 * leaders from all of that season's players, each career from every season its
 * player played, whatever their status was that year — and only then are the
 * players the filter hides dropped from the list.
 *
 * @param {Object} allData - one league's seasons, keyed by year, each an array of joined rows
 * @param {string} [searchQuery] - matches a player name
 * @param {Object} [statusFilter] - status -> shown, deciding who is listed
 * @param {Set<string>} [finishedYears] - years whose regular season is over, passed to seasonLeaders
 * @param {Object} [toiletChampionsByYear] - year -> toilet bowl champion's managers, from toiletBowlChampions
 * @returns {Array} a row per listed player, unsorted
 */
export function allTimePlayers(allData, searchQuery, statusFilter, finishedYears, toiletChampionsByYear = {}) {
  const stats = {};

  const listed = playersIn(onlyShown(allData, statusFilter));
  const { pfLeadersByYear, paLeadersByYear, lastPlaceByYear } = seasonLeaders(allData, finishedYears);

  Object.entries(allData)
    .filter(([year]) => !isNaN(Number(year)))
    .forEach(([seasonYear, season]) => {
    if (!Array.isArray(season)) return;
    season.forEach((row) => {
      // The all-time table lists players. A botted season belongs to nobody,
      // so it has no career to total (6.2(d)).
      if (!isPlayerTeam(row)) return;

      for (const name of managersOf(row)) {
        if (!stats[name]) {
          stats[name] = {
            wins: 0,
            losses: 0,
            ties: 0,
            PF: 0,
            PA: 0,
            rChampionYears: [],
            playoffRounds: 0,
            pChampionYears: [],
            toiletChampionYears: [],
            pfLeaderYears: [],
            paLeaderYears: [],
            regLoserYears: []
          };
        }

        stats[name].wins += row.wins || 0;
        stats[name].losses += row.losses || 0;
        stats[name].ties += row.ties || 0;
        stats[name].PF += row.pf || 0;
        stats[name].PA += row.pa || 0;

        if (row.is_regular_champ) {
          const shortYear = "'" + seasonYear.toString().slice(-2);
          stats[name].rChampionYears.push(shortYear);
        }

        if (pfLeadersByYear[seasonYear]?.includes(name)) {
          const shortYear = "'" + seasonYear.toString().slice(-2);
          stats[name].pfLeaderYears.push(shortYear);
        }

        if (paLeadersByYear[seasonYear]?.includes(name)) {
          const shortYear = "'" + seasonYear.toString().slice(-2);
          stats[name].paLeaderYears.push(shortYear);
        }

        if (lastPlaceByYear[seasonYear]?.includes(name)) {
          const shortYear = "'" + seasonYear.toString().slice(-2);
          stats[name].regLoserYears.push(shortYear);
        }

        // playoff_rounds is the rung actually reached, so the champion's own
        // final is already in it: the +1 the file's dialect needed comes out in
        // the same change that puts this key in. And made_playoffs is generated
        // from playoff_rounds >= 1, so the gate it used to stand behind adds
        // nothing to a sum.
        stats[name].playoffRounds += row.playoff_rounds || 0;

        if (row.is_playoff_champ) {
          const shortYear = "'" + seasonYear.toString().slice(-2);
          stats[name].pChampionYears.push(shortYear);
        }

        if (toiletChampionsByYear[seasonYear]?.includes(name)) {
          const shortYear = "'" + seasonYear.toString().slice(-2);
          stats[name].toiletChampionYears.push(shortYear);
        }
      }
    });
  });

  const groups = sharedCareers(allData);

  let players = Object.entries(stats)
    .filter(([name]) => listed.has(name))
    // A shared career is one row, so only its first name emits it: the others'
    // totals are the same numbers.
    .filter(([name]) => (groups.get(name) ?? [name])[0] === name)
    .map(([name, s]) => {
      const totalGames = s.wins + s.losses + s.ties;

      const winPct = totalGames ? (s.wins + 0.5 * s.ties) / totalGames : 0;

      return {
        name: careerLabel(groups, name),
        names: groups.get(name) ?? [name],
        ...s,
        totalGames,
        winPct,
        PFPG: totalGames ? s.PF / totalGames : 0,
        PAPG: totalGames ? s.PA / totalGames : 0,
        rChampionCount: s.rChampionYears.length,
        pChampionCount: s.pChampionYears.length,
        toiletChampionCount: s.toiletChampionYears.length,
        pfLeaderCount: s.pfLeaderYears.length,
        paLeaderCount: s.paLeaderYears.length,
        regLoserCount: s.regLoserYears.length
      };
    });

  if (searchQuery) {
    players = players.filter(p =>
      p.names.some((name) => name.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }

  return players;
}

// ==================================
// Rank change since the last game
// ==================================

/**
 * The most recent scored regular-season week across the league, newest season
 * first. Playoff weeks are skipped: the all-time record is regular season
 * only, so a playoff game cannot move anyone.
 *
 * @param {Object} seasons - one league's payload, keyed by year
 * @returns {{year: string, week: number, matchups: Array, teams: Map}|null}
 */
function latestScoredWeek(seasons) {
  const years = Object.keys(seasons ?? {})
    .filter((year) => !isNaN(Number(year)))
    .sort((a, b) => Number(b) - Number(a));

  for (const year of years) {
    const season = seasons[year];
    const playoffStart = season?.season?.playoff_start_week ?? Infinity;

    const played = Object.entries(season?.weeks ?? {})
      .filter(([week, { matchups }]) => Number(week) < playoffStart && weekIsScored(matchups))
      .map(([week, { matchups }]) => ({ week: Number(week), matchups }))
      .sort((a, b) => b.week - a.week);

    if (played.length > 0) {
      return { year, ...played[0], teams: teamsById(season) };
    }
  }
  return null;
}

/** Career wins, losses, ties and points for, per player, from the standings. */
function careerRecords(seasons) {
  const records = new Map();
  for (const year of Object.keys(seasons ?? {})) {
    if (isNaN(Number(year))) continue;
    for (const row of joinStandings(seasons[year])) {
      for (const name of managersOf(row)) {
        const record = records.get(name) ?? { wins: 0, losses: 0, ties: 0, pf: 0 };
        record.wins += row.wins || 0;
        record.losses += row.losses || 0;
        record.ties += row.ties || 0;
        record.pf += row.pf || 0;
        records.set(name, record);
      }
    }
  }
  return records;
}

/** Takes one game back out of both sides' records, as standings booked it. */
function removeGame(records, matchup, teams) {
  const team1 = teams.get(matchup.team1_id);
  const team2 = teams.get(matchup.team2_id);
  // A BYE books nothing, so there is nothing to take back.
  if (!team1 || !team2) return;

  const sides = [
    [team1, matchup.team1_score || 0, matchup.team2_score || 0],
    [team2, matchup.team2_score || 0, matchup.team1_score || 0],
  ];
  const counted = sides[0][1] > 0 && sides[0][2] > 0;

  for (const [team, scored, allowed] of sides) {
    for (const name of managersOf(team)) {
      const record = records.get(name);
      if (!record) continue;
      record.pf -= scored;
      if (!counted) continue;
      if (scored > allowed) record.wins--;
      else if (scored < allowed) record.losses--;
      else record.ties--;
    }
  }
}

/** Records keyed by row label; a shared career's members hold the same record, so one stands for all. */
function byCareerLabel(records, groups) {
  const labelled = new Map();
  for (const [name, record] of records) {
    const label = careerLabel(groups, name);
    if (!labelled.has(label)) labelled.set(label, record);
  }
  return labelled;
}

/** Place per player by the table's default order: win % first, then points for. */
function placesByWinPct(records, listed) {
  const ranked = [...records.entries()]
    .filter(([name]) => listed.has(name))
    .map(([name, r]) => {
      const games = r.wins + r.losses + r.ties;
      return { name, games, winPct: games ? (r.wins + 0.5 * r.ties) / games : 0, pf: r.pf };
    })
    .filter((r) => r.games > 0)
    .sort((a, b) => b.winPct - a.winPct || b.pf - a.pf);

  return new Map(ranked.map((r, index) => [r.name, index + 1]));
}

/**
 * How many places each player moved in the all-time order because of the
 * league's most recent game week: positive is up.
 *
 * Ranked among the players the status filter lists, so a place is a place on
 * the table as shown: passing a hidden player is not a move. Each player's
 * record is still their whole career, whatever their status was each season —
 * the filter chooses who is ranked, not what their numbers are (6.2(g)). A
 * player whose first game was that week has no previous place and so no entry.
 *
 * @param {Object} seasons - one league's payload, keyed by year
 * @param {Object} [statusFilter] - status -> shown; absent ranks everyone
 * @returns {{year: string|null, week: number|null, changes: Map<string, number>}}
 */
export function lastGameRankChange(seasons, statusFilter) {
  const latest = latestScoredWeek(seasons);
  if (!latest) return { year: null, week: null, changes: new Map() };

  const current = careerRecords(seasons);
  const previous = new Map([...current].map(([name, r]) => [name, { ...r }]));
  for (const matchup of latest.matchups) removeGame(previous, matchup, latest.teams);

  const joined = Object.fromEntries(
    Object.keys(seasons).map((year) => [year, joinStandings(seasons[year])])
  );
  // Ranked by row, as the table lists them: a shared career is one place.
  const groups = sharedCareers(joined);
  const listed = new Set(
    [...playersIn(onlyShown(joined, statusFilter))].map((name) => careerLabel(groups, name))
  );

  const now = placesByWinPct(byCareerLabel(current, groups), listed);
  const before = placesByWinPct(byCareerLabel(previous, groups), listed);

  const changes = new Map();
  for (const [name, place] of now) {
    if (before.has(name)) changes.set(name, before.get(name) - place);
  }
  return { year: latest.year, week: latest.week, changes };
}
