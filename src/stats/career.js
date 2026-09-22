// ==================================
// stats/career.js
// ==================================

/**
 * One player's games and awards across one league's seasons.
 *
 * Pure: the filtering, the head-to-head table and the notable games stay in
 * the component, and read only the games this module emits.
 */

import { isBye, joinStandings, ownerLabel, teamsById } from './league';

/**
 * The ids a player owned in one season. A team id belongs to a season, not to
 * a person, so this is asked again for every year — and a player who owned two
 * teams in a season is two ids, not the first one found.
 *
 * The match is on `display_name`, never on the label: a botted slot is not a
 * person, so `/players/Botted Season` finds nothing and gets the empty state.
 */
function teamIdsFor(seasonData, playerName) {
  const ids = new Set();
  for (const team of seasonData?.teams ?? []) {
    if (team.display_name === playerName) ids.add(team.id);
  }
  return ids;
}

/**
 * Every game a player played, oldest season first.
 *
 * BYE weeks and games without both scores are skipped, so a game here is
 * always a result.
 *
 * @param {Object} allData - one league's seasons, keyed by year
 * @param {string} playerName
 * @returns {Array} a game per matchup the player appeared in
 */
export function playerGames(allData, playerName) {
  const games = [];

  Object.entries(allData)
  .filter(([year]) => !isNaN(Number(year)))
  .forEach(([year, seasonData]) => {
    const weeks = seasonData?.weeks || {};
    const teams = teamsById(seasonData);
    const mine = teamIdsFor(seasonData, playerName);
    if (mine.size === 0) return; // not in this season at all

    // Process each teams matchups
    Object.entries(weeks).forEach(([weekNum, weekData]) => {
      const matchups = weekData?.matchups || [];

      matchups.forEach((matchup) => {
        const { team1_id, team1_score, team2_id, team2_score, status, label } = matchup;

        // Determine game type
        let gameType = 'regular';
        if (status === 'playoff') gameType = 'playoff';
        else if (status === 'toilet') gameType = 'toilet';
        else if (status === 'out') gameType = 'out';

        // Check if player is in this matchup
        let isTeam1 = team1_id != null && mine.has(team1_id);
        let isTeam2 = team2_id != null && mine.has(team2_id);

        if (!isTeam1 && !isTeam2) return; // Player not involved
        if (isBye(matchup)) return; // Skip BYE weeks

        // The opponent is keyed by its label, not its id: ids are new every
        // season, and a head-to-head record spans them.
        const opponentTeam = teams.get(isTeam1 ? team2_id : team1_id);
        const opponent = ownerLabel(opponentTeam);
        const playerScore = isTeam1 ? team1_score : team2_score;
        const opponentScore = isTeam1 ? team2_score : team1_score;

        // Only include games with valid scores
        if (playerScore == null || opponentScore == null) return;

        // Determine result
        let result = 'tie';
        if (playerScore > opponentScore) result = 'win';
        else if (playerScore < opponentScore) result = 'loss';

        games.push({
          year: Number(year),
          week: Number(weekNum),
          opponent,
          // The opponent's own status, so the page can switch botted seasons
          // off by default without reading its label for the word.
          opponentStatus: opponentTeam?.status ?? null,
          playerScore: Number(playerScore),
          opponentScore: Number(opponentScore),
          result,
          gameType,
          label: label || null,
          margin: Math.abs(playerScore - opponentScore)
        });
      });
    });
  });

  return games;
}

/**
 * A player's championships, playoff rounds and points-for titles.
 *
 * @param {Object} allData - one league's seasons, keyed by year
 * @param {string} playerName
 * @returns {{regularSeasonChampionships: Array, playoffChampionships: Array, playoffRounds: number, pfTitles: Array}}
 */
export function playerAwards(allData, playerName) {
  const awards = {
    regularSeasonChampionships: [],
    playoffChampionships: [],
    playoffRounds: 0,
    pfTitles: [],
  };

  const pfLeadersByYear = {};
  Object.entries(allData)
  .filter(([year]) => !isNaN(Number(year)))
  .forEach(([year, seasonData]) => {
    const standings = joinStandings(seasonData);
    let maxPF = -1;
    let pfLeader = null;

    standings.forEach(team => {
      if((team.pf || 0) > maxPF) {
        maxPF = team.pf || 0;
        pfLeader = team.display_name;
      }
    });

    pfLeadersByYear[year] = pfLeader;
  });

  Object.entries(allData)
  .filter(([year]) => !isNaN(Number(year)))
  .forEach(([year, seasonData]) => {
    const teams = seasonData?.teams || [];
    const playerSeasonData = teams.find(t => t.display_name === playerName);
    if (!playerSeasonData) return;

    if(pfLeadersByYear[year] === playerName) {
      awards.pfTitles.push(Number(year));
    }

    if (playerSeasonData.is_regular_champ) {
      awards.regularSeasonChampionships.push(Number(year));
    }

    // The same key the all-time table now sums, which is what makes the two
    // pages agree about a champion's rounds for the first time.
    awards.playoffRounds += playerSeasonData.playoff_rounds || 0;

    if (playerSeasonData.is_playoff_champ) {
      awards.playoffChampionships.push(Number(year));
    }
  });

  return awards;
}
