// ==================================
// stats/season.js
// ==================================

/**
 * One season's numbers, derived from one league's payload.
 *
 * Every function here is pure: it takes the data it needs and returns plain
 * data. Nothing is cached at module level — a cache that outlived a call is
 * the one place two leagues' numbers could meet.
 */

import { joinStandings, ownerLabel } from './league';

/**
 * The rows of a season: its standings joined to its teams, since the payload
 * keeps the record and the team apart and every table wants them together.
 *
 * @param {Object} seasons - one league's seasons, keyed by year
 * @param {string|number} year
 * @returns {Array} the season's rows, or an empty array
 */
export function getSeasonArray(seasons, year) {
  return joinStandings(seasons?.[year]);
}

/**
 * The three stats cards above the season table.
 *
 * @param {Object} seasons - one league's seasons, keyed by year
 * @param {string|number} year
 * @returns {{totalGames: number, avgPFPG: number, activeTeams: number}}
 */
export function seasonStatsCards(seasons, year) {
  const season = getSeasonArray(seasons, year);

  const totalGames = season.reduce(
    (sum, team) => sum + ((team.wins || 0) + (team.losses || 0) + (team.ties || 0)),
    0
  );

  const avgPFPG = season.length > 0
    ? season.reduce((sum, team) => {
      const games = (team.wins || 0) + (team.losses || 0) + (team.ties || 0);
      return sum + (games > 0 ? (team.pf || 0) / games : 0);
      }, 0) / season.length
    : 0;

  const activeTeams = season.filter(team => team.status === 'active').length;

  return {
    totalGames,
    avgPFPG,
    activeTeams
  };
}

/**
 * The season table's rows: records totalled, rank change derived, place
 * coerced to a number where it is a numeric string.
 *
 * @param {Array} seasonData - the season's joined rows, already filtered by the caller
 * @param {string} [searchQuery] - matches an owner label or a team name
 * @returns {Array} a row per team, in the order it was given
 */
export function prepareSeasonRows(seasonData, searchQuery) {
  let data = seasonData.map((row, i) => {
    const wins = Number(row.wins) || 0;
    const losses = Number(row.losses) || 0;
    const ties = Number(row.ties) || 0;
    const totalGames = wins + losses + ties;

    const winPct = totalGames ? (wins + 0.5 * ties) / totalGames : 0;

    const change = row.prev_place != null && row.place != null
      ? row.prev_place - row.place
      : 0;

    let placeValue = row.place;

    if (typeof placeValue === 'string') {
      const parsed = parseInt(placeValue);
      if (!isNaN(parsed)) {
        placeValue = parsed;
      }
    }

    return {
      ...row,
      // A view-model field, like winPct and change: the label the table shows
      // and sorts on, derived once rather than at every cell.
      ownerName: ownerLabel(row),
      wins,
      losses,
      ties,
      totalGames,
      winPct,
      change,
      placeValue,
      _idx: i,
    };
  });

  if (searchQuery) {
    const needle = searchQuery.toLowerCase();
    data = data.filter(d =>
      (d.ownerName && d.ownerName.toLowerCase().includes(needle)) ||
      (d.team_name && d.team_name.toLowerCase().includes(needle))
    );
  }

  return data;
}
