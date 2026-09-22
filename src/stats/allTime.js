// ==================================
// stats/allTime.js
// ==================================

/**
 * Career totals and per-season awards for one league.
 *
 * Pure, and one league by signature: `allData` is one league's seasons and
 * nothing else, so no total here can span two leagues.
 */

/**
 * Each season's points-for leader, points-against leader and last place.
 *
 * @param {Object} allData - one league's seasons, keyed by year, each an array of rows
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
        if ((row.pf || 0) > maxPF) {
          maxPF = row.pf || 0;
          pfLeader = row.name;
        }
        if ((row.pa || 0) > maxPA) {
          maxPA = row.pa || 0;
          paLeader = row.name;
        }
        if (row.place != null && row.place > maxPlace) {
          maxPlace = row.place;
          lastPlace = row.name;
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
 * One row per player: career record, points, championships and award years.
 *
 * @param {Object} allData - one league's seasons, keyed by year, each an array of rows
 * @param {string} [searchQuery] - matches a player name
 * @returns {Array} a row per player, unsorted
 */
export function allTimePlayers(allData, searchQuery) {
  const stats = {};

  const { pfLeadersByYear, paLeadersByYear, lastPlaceByYear } = seasonLeaders(allData);

  Object.entries(allData)
    .filter(([year]) => !isNaN(Number(year)))
    .forEach(([seasonYear, season]) => {
    if (!Array.isArray(season)) return;
    season.forEach((row) => {
      const name = row.name;

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

      if (row.rChampion) {
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

      if (row.playoff?.made) {
        let rounds = row.playoff.rounds || 0;
        if (row.playoff.pChampion) rounds += 1;
        stats[name].playoffRounds += rounds;
      }

      if (row.playoff?.pChampion) {
        const shortYear = "'" + seasonYear.toString().slice(-2);
        stats[name].pChampionYears.push(shortYear);
      }
    });
  });

  let players = Object.entries(stats).map(([name, s]) => {
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
