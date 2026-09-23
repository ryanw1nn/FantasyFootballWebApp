// ==================================
// stats/allTime.js
// ==================================

/**
 * Career totals and per-season awards for one league.
 *
 * Pure, and one league by signature: `allData` is one league's seasons and
 * nothing else, so no total here can span two leagues.
 */

import { isPlayerTeam, ownerLabel } from './league';

/**
 * Each season's points-for leader, points-against leader and last place.
 *
 * @param {Object} allData - one league's seasons, keyed by year, each an array of joined rows
 * @returns {{pfLeadersByYear: Object, paLeadersByYear: Object, lastPlaceByYear: Object}}
 */
export function seasonLeaders(allData) {
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
          pfLeader = ownerLabel(row);
        }
        if ((row.pa || 0) > maxPA) {
          maxPA = row.pa || 0;
          paLeader = ownerLabel(row);
        }
        if (row.place != null && row.place > maxPlace) {
          maxPlace = row.place;
          lastPlace = ownerLabel(row);
        }
      });
      if (pfLeader) {
        pfLeadersByYear[seasonYear] = pfLeader;
      }
      if (paLeader) {
        paLeadersByYear[seasonYear] = paLeader;
      }
      if (lastPlace) {
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
      if (isPlayerTeam(row)) names.add(ownerLabel(row));
    }
  }
  return names;
}

/**
 * One row per player: career record, points, championships and award years.
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
 * @returns {Array} a row per listed player, unsorted
 */
export function allTimePlayers(allData, searchQuery, statusFilter) {
  const stats = {};

  const listed = playersIn(onlyShown(allData, statusFilter));
  const { pfLeadersByYear, paLeadersByYear, lastPlaceByYear } = seasonLeaders(allData);

  Object.entries(allData)
    .filter(([year]) => !isNaN(Number(year)))
    .forEach(([seasonYear, season]) => {
    if (!Array.isArray(season)) return;
    season.forEach((row) => {
      // The all-time table lists players. A botted season belongs to nobody,
      // so it has no career to total (6.2(d)).
      if (!isPlayerTeam(row)) return;

      const name = ownerLabel(row);

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

      if (pfLeadersByYear[seasonYear] === name) {
        const shortYear = "'" + seasonYear.toString().slice(-2);
        stats[name].pfLeaderYears.push(shortYear);
      }

      if (paLeadersByYear[seasonYear] === name) {
        const shortYear = "'" + seasonYear.toString().slice(-2);
        stats[name].paLeaderYears.push(shortYear);
      }

      if (lastPlaceByYear[seasonYear] === name) {
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
    });
  });

  let players = Object.entries(stats)
    .filter(([name]) => listed.has(name))
    .map(([name, s]) => {
      const totalGames = s.wins + s.losses + s.ties;

      const winPct = totalGames ? (s.wins + 0.5 * s.ties) / totalGames : 0;

      return {
        name,
        ...s,
        totalGames,
        winPct,
        PFPG: totalGames ? s.PF / totalGames : 0,
        PAPG: totalGames ? s.PA / totalGames : 0,
        rChampionCount: s.rChampionYears.length,
        pChampionCount: s.pChampionYears.length,
        pfLeaderCount: s.pfLeaderYears.length,
        paLeaderCount: s.paLeaderYears.length,
        regLoserCount: s.regLoserYears.length
      };
    });

  if (searchQuery) {
    players = players.filter(p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  return players;
}
