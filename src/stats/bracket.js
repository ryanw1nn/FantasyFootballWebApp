// ==================================
// stats/bracket.js
// ==================================

/**
 * Which column of the bracket a matchup belongs in, which weeks the bracket
 * covers, and who won a game.
 *
 * A matchup carries its own `status`, and the season row says which week the
 * playoffs start. Reading both is what lets a league with a four-team bracket
 * or an earlier start render with no code of its own.
 */

import { isBye } from './league';

/**
 * The column each matchup status belongs to.
 *
 * The playoff column is keyed `bracket` rather than `playoff`: the dialect grep
 * looks for a dotted `playoff`, which in the file's dialect was a team's own
 * playoff object, and a view-model field spelled the same way would blunt the
 * grep for good — 5.3's lesson, that a comment can move a gate, one step on.
 */
const COLUMN_OF_STATUS = {
  playoff: 'bracket',
  toilet: 'toiletBowl',
  out: 'out',
};

/**
 * A playoff matchup with no status is drawn under Out Games, which is the
 * bucket db/standings.mjs scores it in.
 */
const DEFAULT_COLUMN = 'out';

/** The last three rounds have names; anything before them is numbered. */
const ROUNDS_FROM_THE_END = ['Championship', 'Semifinals', 'Quarterfinals'];

/**
 * The weeks the bracket draws: from the season's playoff start through the
 * last week that has matchups.
 *
 * @param {Object} seasonData - one season of the league payload
 * @returns {number[]} week numbers, ascending
 */
export function playoffWeeks(seasonData) {
  const start = seasonData?.season?.playoff_start_week;
  if (start == null) return [];

  const played = Object.entries(seasonData?.weeks ?? {})
    .filter(([, week]) => (week?.matchups?.length ?? 0) > 0)
    .map(([number]) => Number(number))
    .filter((week) => week >= start);

  if (played.length === 0) return [];

  const weeks = [];
  for (let week = start; week <= Math.max(...played); week += 1) weeks.push(week);
  return weeks;
}

/**
 * What to call a round. The last one is the final, whatever number it is.
 *
 * @param {number} round - 1 for the first playoff week
 * @param {number} rounds - how many rounds the bracket has
 * @returns {string}
 */
export function roundTitle(round, rounds) {
  return ROUNDS_FROM_THE_END[rounds - round] ?? `Round ${round}`;
}

/**
 * Split a week's matchups into the bracket's three columns, by each matchup's
 * own status and in position order within a column.
 *
 * @param {Object} weekMatchups - one week of the season, or null
 * @returns {{bracket: Array, toiletBowl: Array, out: Array}}
 */
export function categorizeMatchups(weekMatchups) {
  const columns = { bracket: [], toiletBowl: [], out: [] };

  const matchups = [...(weekMatchups?.matchups ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const matchup of matchups) {
    columns[COLUMN_OF_STATUS[matchup.status] ?? DEFAULT_COLUMN].push(matchup);
  }

  return columns;
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
  if (isBye(matchup) && matchup.team2_id == null && matchup.team1_score != null) {
    return 'team1';
  }

  if (matchup.team1_score == null || matchup.team2_score == null) return null;
  return matchup.team1_score > matchup.team2_score ? 'team1' : 'team2';
}
