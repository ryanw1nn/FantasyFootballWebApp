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
 * The people who ran a team, in the league's order: one name, two for a
 * co-managed team, none for a botted slot.
 *
 * This is who a team's results are credited to. Every manager of a co-managed
 * team gets all of it, the same as if they had run it alone, so every career
 * total, award and player page asks this rather than reading the label.
 *
 * @param {Object} team - a team row, or a row joined from one
 * @returns {string[]}
 */
export function managersOf(team) {
  return team?.managers ?? [];
}

/**
 * The people behind a team, as one label, or the words for the slot nobody
 * owned: "Alex", "Alex & Blake", or "Botted Season".
 *
 * A botted season has no player: `managers` is empty and `status` is 'botted'.
 * Every screen still reads "Botted Season", but it is a presentation choice
 * made once, here, rather than a player the server invents.
 *
 * @param {Object} team - a team row, or a row joined from one
 * @returns {string|null}
 */
export function ownerLabel(team) {
  if (!team) return null;
  if (team.status === 'botted') return BOTTED_LABEL;
  const managers = managersOf(team);
  return managers.length > 0 ? managers.join(' & ') : null;
}

/** Whether a team row stands for a person at all. */
export function isPlayerTeam(team) {
  return managersOf(team).length > 0;
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

/**
 * A week counts as played when some game in it has both scores above zero —
 * the same rule db/standings.mjs uses, so an unplayed week is never "the last
 * game".
 */
export function weekIsScored(matchups) {
  return matchups.some((m) => m.team1_score > 0 && m.team2_score > 0);
}

/**
 * Whether a season's regular season is over: its final regular-season week, or
 * any playoff week, has been scored. An imported season is a finished one.
 *
 * @param {Object} seasonData - one season of the league payload
 * @returns {boolean}
 */
export function regularSeasonIsOver(seasonData) {
  const shape = seasonData?.season;
  if (!shape) return false;
  if (shape.standings_are_imported) return true;

  return Object.entries(seasonData.weeks ?? {}).some(
    ([week, { matchups }]) =>
      Number(week) >= shape.regular_season_weeks && weekIsScored(matchups)
  );
}
