// ==================================
// stats/bracket.js
// ==================================

/**
 * Which column of the bracket a matchup belongs in, and who won it.
 *
 * The categorising below splits a week by array position rather than by the
 * matchup's own status. That is kept exactly as it was: 6.8 is the step that
 * changes it.
 */

/**
 * Split a week's matchups into the bracket's three columns.
 *
 * @param {Object} weekMatchups - one week of the season, or null
 * @param {number} weekNum
 * @returns {{playoff: Array, toiletBowl: Array, out: Array}}
 */
export function categorizeMatchups(weekMatchups, weekNum) {
  if (!weekMatchups || !weekMatchups.matchups) {
    return { playoff: [], toiletBowl: [], out: [] };
  }

  const matchups = weekMatchups.matchups;

  if (weekNum === 15) {
    return {
      playoff: matchups.slice(0, 4),
      toiletBowl: matchups.slice(4, 6),
      out: matchups.slice(6)
    };
  } else if (weekNum === 16) {
    return {
      playoff: matchups.slice(0, 2),
      toiletBowl: matchups.slice(2, 3),
      out: matchups.slice(3)
    };
  } else if(weekNum === 17) {
    return {
      playoff: matchups.slice(0, 1),
      toiletBowl: [],
      out: matchups.slice(1)
    };
  }

  return {
    playoff: matchups.slice(0, 2),
    toiletBowl: matchups.slice(2, 4),
    out: matchups.slice(4)
  };
}

/**
 * The side that won a matchup, or null while it is undecided.
 *
 * A side with a score and no opponent is a BYE, and wins.
 *
 * @param {Object} matchup
 * @returns {'team1'|'team2'|null}
 */
export function getWinner(matchup) {
  if ((!matchup.team2 || matchup.team2 === '') && matchup.team1Score != null) {
    return 'team1';
  }

  if (matchup.team1Score == null || matchup.team2Score == null) return null;
  return matchup.team1Score > matchup.team2Score ? 'team1' : 'team2';
}
