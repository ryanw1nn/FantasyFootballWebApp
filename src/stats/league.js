// ==================================
// stats/league.js
// ==================================

/**
 * The three things every view needs from the league's own dialect: what to
 * call a team's owner, what a missing opponent means, and how a standings row
 * finds its team.
 *
 * Nothing here renames a key. A join that emitted `name`, `state` and
 * `rChampion` would be the server's old translation layer rebuilt in the
 * browser, and a quirk taught to both ends never goes away.
 */

/** What a botted slot is called on screen. It is a label, not a player. */
export const BOTTED_LABEL = 'Botted Season';

/**
 * What an empty side is called on screen.
 *
 * The file's dialect stored this word as the opponent's *name*, which is why
 * the dialect grep looks for it. Here it is only ever a label: the payload says
 * null, and the word is chosen once, at the edge, like BOTTED_LABEL.
 */
export const BYE_LABEL = 'BYE';

/**
 * The person behind a team, or the words for the slot nobody owned.
 *
 * A botted season has no player: `display_name` is null and `status` is
 * 'botted'. Every screen still reads "Botted Season", but it is a presentation
 * choice made once, here, rather than a player the server invents.
 *
 * @param {Object} team - a team row, or a row joined from one
 * @returns {string|null}
 */
export function ownerLabel(team) {
  if (!team) return null;
  if (team.status === 'botted') return BOTTED_LABEL;
  return team.display_name ?? null;
}

/** Whether a team row stands for a person at all. */
export function isPlayerTeam(team) {
  return Boolean(team) && team.display_name != null;
}

/**
 * A BYE: exactly one side empty. Both sides empty is a slot nobody has filled
 * yet, which is a different thing and renders as two blanks.
 *
 * @param {Object} matchup
 * @returns {boolean}
 */
export function isBye(matchup) {
  if (!matchup) return false;
  const one = matchup.team1_id == null;
  const two = matchup.team2_id == null;
  return one !== two;
}

/**
 * A season's teams, keyed by id. A matchup names a side by id, and ids are
 * unique to a season, so this map is built per season and never shared.
 *
 * @param {Object} seasonData - one season of the league payload
 * @returns {Map<number, Object>}
 */
export function teamsById(seasonData) {
  return new Map((seasonData?.teams ?? []).map((team) => [team.id, team]));
}

/**
 * One row per team with its record: `teams` and `standings` joined on
 * `team_id`, in standings order, with every key left as the payload spells it.
 *
 * @param {Object} seasonData - one season of the league payload
 * @returns {Array} a row per standings entry
 */
export function joinStandings(seasonData) {
  const teams = teamsById(seasonData);

  return (seasonData?.standings ?? []).flatMap((row) => {
    const team = teams.get(row.team_id);
    // A standings row whose team is missing is a payload that cannot be
    // rendered; dropping it is better than a row of blanks with no name.
    return team === undefined ? [] : [{ ...team, ...row }];
  });
}
