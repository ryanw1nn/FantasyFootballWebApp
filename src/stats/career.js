// ==================================
// stats/career.js
// ==================================

/**
 * One player's games and awards across one league's seasons.
 *
 * Pure: the filtering, the head-to-head table and the notable games stay in
 * the component, and read only the games this module emits.
 */

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
    // Handle both old array format and new object format with teams
    const weeks = seasonData?.weeks || {};

    // Process each teams matchups
    Object.entries(weeks).forEach(([weekNum, weekData]) => {
      const matchups = weekData?.matchups || [];

      matchups.forEach((matchup) => {
        const {team1, team1Score, team2, team2Score, status, label } = matchup;

        // Determine game type
        let gameType = 'regular';
        if (status === 'playoff') gameType = 'playoff';
        else if (status === 'toilet') gameType = 'toilet';
        else if (status === 'out') gameType = 'out';

        // Check if player is in this matchup
        let isTeam1 = team1 === playerName;
        let isTeam2 = team2 === playerName;

        if (!isTeam1 && !isTeam2) return; // Player not involved
        if (team1 === 'BYE' || team2 === 'BYE') return; // Skip BYE weeks

        // Determine opponent and scores
        const opponent = isTeam1 ? team2 : team1;
        const playerScore = isTeam1 ? team1Score : team2Score;
        const opponentScore = isTeam1 ? team2Score : team1Score;

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
    const standings = Array.isArray(seasonData) ? seasonData : seasonData?.standings || [];
    let maxPF = -1;
    let pfLeader = null;

    standings.forEach(team => {
      if((team.pf || 0) > maxPF) {
        maxPF = team.pf || 0;
        pfLeader = team.name;
      }
    });

    pfLeadersByYear[year] = pfLeader;
  });

  Object.entries(allData)
  .filter(([year]) => !isNaN(Number(year)))
  .forEach(([year, seasonData]) => {
    const teams = Array.isArray(seasonData) ? seasonData : seasonData?.teams || [];
    const playerSeasonData = teams.find(t => t.name === playerName);
    if (!playerSeasonData) return;

    if(pfLeadersByYear[year] === playerName) {
      awards.pfTitles.push(Number(year));
    }

    if (playerSeasonData.rChampion) {
      awards.regularSeasonChampionships.push(Number(year));
    }

    if(playerSeasonData.playoff) {
      if(playerSeasonData.playoff.made) {
        let rounds = playerSeasonData.playoff.rounds || 0;
        awards.playoffRounds += rounds;
      }
      if (playerSeasonData.playoff.pChampion) {
        awards.playoffChampionships.push(Number(year));
      }
    }
  });

  return awards;
}
