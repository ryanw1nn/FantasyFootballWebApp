// ==================================
// PlayerStatsPage.jsx
// ==================================

import React, { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Trophy, TrendingUp, TrendingDown, Award, Target, ChevronDown } from 'lucide-react';

/**
 * PlayerStatsPage Component
 * Displays statistics for an individual player across all seasons.
 */

export default function PlayerStatsPage({ playerName, allData, onBack }) {
    // ==================================
    // STATE MANAGEMENT
    // ==================================

    const [selectedGameTypes, setSelecetedGameTypes] = useState(['regular', 'playoff', 'toilet']);
    const [showGameTypeDropdown, setShowGameTypeDropdown] = useState(false);
    const [opponentFilters, setOpponentFilters] = useState({});
    const [showOpponentDropdown, setShowOpponentDropdown] = useState(false);
    const [h2hSortConfig, setH2hSortConfig] = useState({ key: 'winPct', direction: 'desc' });

    // ==================================
    // DATA CALCULATION - ALL GAMES
    // ==================================

    /**
     * Processes all games across all seasons to extract player-specific data
     * Returns comprehensive game history with opponent info, scores, and metadata
    */

    const playerGames = useMemo(() => {
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
    }, [allData, playerName]);

    // Initialize opponent filters
    useEffect(() => {
        if (playerGames.length > 0 && Object.keys(opponentFilters).length === 0) {
            const opponents = [...new Set(playerGames.map(g => g.opponent))];
            const initialFilters = {};
            opponents.forEach(opp => {
                initialFilters[opp] = !opp.toLowerCase().includes('botted');
            });
            setOpponentFilters(initialFilters);
        }       
    }, [playerGames]);

    // ==================================
    // DATA CALCULATION - FILTERED GAMES
    // ==================================

    /**
     * Filters games based on selected game type filters
     */
    const filteredGames = useMemo(() => {
        return playerGames.filter(game => 
        selectedGameTypes.includes(game.gameType) &&
        opponentFilters[game.opponent] !== false
        );
    }, [playerGames, selectedGameTypes, opponentFilters]);

    // ==================================
    // DATA CALCULATION - OVERALL STATS
    // ==================================

    /**
     * Calcualtes overall career statistics from filtered games
     */
    const overallStats = useMemo(() => {
        const wins = filteredGames.filter(g => g.result === 'win').length;
        const losses = filteredGames.filter(g => g.result === 'loss').length;
        const ties = filteredGames.filter(g => g.result === 'tie').length;
        const totalGames = wins + losses + ties;
        
        const totalPF = filteredGames.reduce((sum, g) => sum + g.playerScore, 0);
        const totalPA = filteredGames.reduce((sum, g) => sum + g.opponentScore, 0);

        const winPct = totalGames > 0 ? (wins / totalGames) : 0;
        const pfpg = totalGames > 0 ? (totalPF / totalGames) : 0;
        const papg = totalGames > 0 ? (totalPA / totalGames) : 0;

        return {
            wins,
            losses,
            ties,
            totalGames,
            totalPF,
            totalPA,
            winPct,
            pfpg,
            papg
        };
    }, [filteredGames]);
        
    // ==================================
    // DATA CALCULATION - HEAD-TO-HEAD STATS
    // ==================================

    /**
     * Calculates head-to-head statistics against each opponent
     */
    const headToHeadStats = useMemo(() => {
        const h2h = {};

        filteredGames.forEach(game => {
            if (!h2h[game.opponent]) {
                h2h[game.opponent] = {
                    opponent: game.opponent,
                    wins: 0,
                    losses: 0,
                    ties: 0,
                    pf: 0,
                    pa: 0
                };
            }

            const record = h2h[game.opponent];
            if (game.result === 'win') record.wins += 1;
            else if (game.result === 'loss') record.losses += 1;
            else record.ties++;

            record.pf += game.playerScore;
            record.pa += game.opponentScore;
        });

        // Convert to array and add calculated fields
        let h2hArray = Object.values(h2h).map(record => {
            const totalGames = record.wins + record.losses + record.ties;
            const winPct = totalGames > 0 ? (record.wins + 0.5 * record.ties) / totalGames : 0;
            const pfpg = totalGames > 0 ? record.pf / totalGames : 0;
            const papg = totalGames > 0 ? record.pa / totalGames : 0;

            return {
                ...record,
                totalGames,
                winPct,
                pfpg,
                papg
            };
        });

        // Apply sorting
        h2hArray.sort((a, b) => {
            const aVal = a[h2hSortConfig.key];
            const bVal = b[h2hSortConfig.key];

            if (aVal === bVal) return 0;
            if (h2hSortConfig.direction === 'asc') {
                return aVal < bVal ? -1 : 1;
            } else {
                return aVal > bVal ? -1 : 1;
            }
        });
            
        return h2hArray;
    }, [filteredGames, h2hSortConfig]);

    // ==================================
    // DATA CALCULATION - AWARDS
    // ==================================
            
    /**
     * Extracts all awards and achievements from season data
     */

    const awards = useMemo(() => {
        const playerAwards = {
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
                playerAwards.pfTitles.push(Number(year));
            }

            if (playerSeasonData.rChampion) {
                playerAwards.regularSeasonChampionships.push(Number(year));
            }

            if(playerSeasonData.playoff) {
                if(playerSeasonData.playoff.made) {
                    let rounds = playerSeasonData.playoff.rounds || 0;
                    playerAwards.playoffRounds += rounds;
                }
                if (playerSeasonData.playoff.pChampion) {
                    playerAwards.playoffChampionships.push(Number(year));
                }
            }
        });

        return playerAwards;
    }, [allData, playerName]);

    // ==================================
    // DATA CALCULATION - NOTABLE GAMES
    // ==================================

    const notableGames = useMemo(() => {
        if (filteredGames.length === 0) {
            return {
                closestGames: [],
                biggestBlowouts: [],
                bestPerformances: [],
                worstPerformances: []
            };
        }

        // Sort by margin (ascending for closest, descending for blowouts)
        const sortedByMargin = [...filteredGames].sort((a, b) => a.margin - b.margin);
        const closestGames = sortedByMargin.slice(0, 5);

        const sortedByMarginDesc = [...filteredGames].sort((a, b) => b.margin - a.margin);
        const biggestBlowouts = sortedByMarginDesc.slice(0, 5);

        // Best performances and worst performances by score
        const sortedByScore = [...filteredGames].sort((a, b) => b.playerScore - a.playerScore);
        const bestPerformances = sortedByScore.slice(0, 5);
        const worstPerformances = [...filteredGames].sort((a, b) => a.playerScore - b.playerScore).slice(0, 5);  

        return {
            closestGames,
            biggestBlowouts,
            bestPerformances,
            worstPerformances
        };
    }, [filteredGames]);

  
    // ==================================
    // EVENT HANDLERS
    // ==================================

    /**
     * Toggles a game type filter on/off
     */
    const toggleGameTypeFilter = (type) => {
        setSelecetedGameTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    };

    const toggleOpponentFilter = (opponent) => {
        setOpponentFilters(prev => ({
            ...prev,
            [opponent]: !(prev[opponent] !== false)
        }));
    }

    const selectAllOpponents = () => {
        const newFilters = {};
        Object.keys(opponentFilters).forEach(opp => {
            newFilters[opp] = true;
        });
        setOpponentFilters(newFilters);
    }

    const deselectAllOpponents = () => {
        const newFilters = {};
        Object.keys(opponentFilters).forEach(opp => {
            newFilters[opp] = false;
        });
        setOpponentFilters(newFilters);
    }

    /**
     * Handles column header click for head-to-head sorting
     */
    const handleH2HSort = (key) => {
        setH2hSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    /**
     * Renders a sort indicator icon for table headers
     */
    const renderSortIcon = (key) => {
        if (h2hSortConfig.key !== key) return null;
        return h2hSortConfig.direction === 'asc' ? ' ▲' : ' ▼';
    }

    const gameTypeFilters = { regular: 'Regular', playoff: 'Playoff', toilet: 'Toilet Bowl', out: 'Out' }

    // Close dropdowns when clicking outside
    useEffect(() => {
    const handleClickOutside = (e) => {
        if (!e.target.closest('.dropdown-container')) {
        setShowGameTypeDropdown(false);
        setShowOpponentDropdown(false);
        }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
    }, []);


    // ==================================
    // RENDER
    // ==================================


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto p-3">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={onBack} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-sm">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Trophy className="text-yellow-500" size={24}/> {playerName}
          </h1>
          <div className="w-16"></div>
        </div>

        {/* Filters Row */}
        <div className="bg-white rounded-lg shadow p-2 mb-3 flex flex-wrap gap-2 items-center">
          {/* Game Type Dropdown */}
          <div className="relative dropdown-container" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setShowGameTypeDropdown(!showGameTypeDropdown); setShowOpponentDropdown(false); }}
              className="px-2 py-1.5 border border-gray-300 rounded flex items-center gap-1 hover:bg-gray-50 text-xs"
            >
              Games ({selectedGameTypes.length}) <ChevronDown size={14} />
            </button>
            {showGameTypeDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-50 min-w-[140px]">
                {Object.entries(gameTypeFilters).map(([type, label]) => (
                  <label key={type} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
                    <input type="checkbox" checked={selectedGameTypes.includes(type)} onChange={() => toggleGameTypeFilter(type)} className="rounded border-gray-300 text-indigo-600" />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Opponent Filter Dropdown */}
          <div className="relative dropdown-container" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setShowOpponentDropdown(!showOpponentDropdown); setShowGameTypeDropdown(false); }}
              className="px-2 py-1.5 border border-gray-300 rounded flex items-center gap-1 hover:bg-gray-50 text-xs"
            >
              Opponents ({Object.values(opponentFilters).filter(Boolean).length}) <ChevronDown size={14} />
            </button>
            {showOpponentDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-50 min-w-[180px] max-h-[250px] overflow-y-auto">
                <div className="flex gap-2 p-1.5 border-b bg-gray-50">
                  <button onClick={selectAllOpponents} className="text-xs text-indigo-600 hover:underline">All</button>
                  <button onClick={deselectAllOpponents} className="text-xs text-indigo-600 hover:underline">None</button>
                </div>
                {Object.keys(opponentFilters).sort().map(opponent => (
                  <label key={opponent} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer text-xs">
                    <input type="checkbox" checked={opponentFilters[opponent]} onChange={() => toggleOpponentFilter(opponent)} className="rounded border-gray-300 text-indigo-600" />
                    {opponent}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stats + Awards Row */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
          <div className="bg-white rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-blue-600">{overallStats.wins}-{overallStats.losses}-{overallStats.ties}</div>
            <div className="text-[10px] text-gray-500">Record</div>
          </div>
          <div className="bg-white rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-green-600">{(overallStats.winPct * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-gray-500">Win%</div>
          </div>
          <div className="bg-white rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-purple-600">{overallStats.pfpg.toFixed(1)}</div>
            <div className="text-[10px] text-gray-500">PFPG</div>
          </div>
          <div className="bg-white rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-orange-600">{overallStats.totalGames}</div>
            <div className="text-[10px] text-gray-500">Games</div>
          </div>
          <div className="bg-green-50 rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-green-700">{awards.pfTitles.length > 0 ? awards.pfTitles.join(', ') : '-'}</div>
            <div className="text-[10px] text-gray-500">PF Titles</div>
          </div>
          <div className="bg-blue-50 rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-blue-700">{awards.regularSeasonChampionships.length > 0 ? awards.regularSeasonChampionships.join(', ') : '-'}</div>
            <div className="text-[10px] text-gray-500">RS Champ</div>
          </div>
          <div className="bg-yellow-50 rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-yellow-700">{awards.playoffChampionships.length > 0 ? awards.playoffChampionships.join(', ') : '-'}</div>
            <div className="text-[10px] text-gray-500">PO Champ</div>
          </div>
          <div className="bg-purple-50 rounded shadow p-2 text-center">
            <div className="text-lg font-bold text-purple-700">{awards.playoffRounds}</div>
            <div className="text-[10px] text-gray-500">PO Rounds</div>
          </div>
        </div>

        {/* Head-to-Head */}
        <div className="bg-white rounded-lg shadow p-3 mb-3">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Head-to-Head Records</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-2 py-1.5 text-left cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('opponent')}>Opp{renderSortIcon('opponent')}</th>
                  <th className="px-2 py-1.5 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('winPct')}>Win%{renderSortIcon('winPct')}</th>
                  <th className="px-2 py-1.5 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('wins')}>W{renderSortIcon('wins')}</th>
                  <th className="px-2 py-1.5 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('losses')}>L{renderSortIcon('losses')}</th>
                  <th className="px-2 py-1.5 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('ties')}>T{renderSortIcon('ties')}</th>
                  <th className="px-2 py-1.5 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('totalGames')}>GP{renderSortIcon('totalGames')}</th>
                  <th className="px-2 py-1.5 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('pfpg')}>PFPG{renderSortIcon('pfpg')}</th>
                  <th className="px-2 py-1.5 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleH2HSort('papg')}>PAPG{renderSortIcon('papg')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {headToHeadStats.map((record, idx) => (
                  <tr key={record.opponent} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-2 py-1.5 font-medium">{record.opponent}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`font-semibold ${record.winPct >= 0.6 ? 'text-green-600' : record.winPct >= 0.5 ? 'text-blue-600' : 'text-gray-600'}`}>
                        {(record.winPct * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center text-green-600">{record.wins}</td>
                    <td className="px-2 py-1.5 text-center text-red-600">{record.losses}</td>
                    <td className="px-2 py-1.5 text-center text-gray-500">{record.ties}</td>
                    <td className="px-2 py-1.5 text-center">{record.totalGames}</td>
                    <td className="px-2 py-1.5 text-center">{record.pfpg.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-center">{record.papg.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Notable Games - 2x2 Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Closest Games */}
          <div className="bg-white rounded-lg shadow p-3">
            <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1">
              <Target className="text-blue-500" size={16} /> Closest Games
            </h3>
            <div className="space-y-1.5">
              {notableGames.closestGames.map((game, idx) => (
                <div key={idx} className="p-2 bg-blue-50 rounded text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">vs {game.opponent}</span>
                    <span className={`font-semibold ${game.result === 'win' ? 'text-green-600' : game.result === 'loss' ? 'text-red-600' : 'text-gray-600'}`}>
                      {game.result.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-gray-600">
                    {game.playerScore.toFixed(1)} - {game.opponentScore.toFixed(1)} 
                    <span className="ml-1 text-blue-600 font-medium">({game.margin.toFixed(1)})</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Wk {game.week}, {game.year}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Biggest Blowouts */}
          <div className="bg-white rounded-lg shadow p-3">
            <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1">
              <TrendingUp className="text-purple-500" size={16} /> Biggest Blowouts
            </h3>
            <div className="space-y-1.5">
              {notableGames.biggestBlowouts.map((game, idx) => (
                <div key={idx} className={`p-2 rounded text-xs ${game.result === 'win' ? 'bg-green-50' : 'bg-red-50'}`}>
                  <div className="flex justify-between">
                    <span className="font-medium">vs {game.opponent}</span>
                    <span className={`font-semibold ${game.result === 'win' ? 'text-green-600' : 'text-red-600'}`}>
                      {game.result.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-gray-600">
                    {game.playerScore.toFixed(1)} - {game.opponentScore.toFixed(1)} 
                    <span className={`ml-1 font-medium ${game.result === 'win' ? 'text-green-600' : 'text-red-600'}`}>({game.margin.toFixed(1)})</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Wk {game.week}, {game.year}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Best Performances */}
          <div className="bg-white rounded-lg shadow p-3">
            <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1">
              <TrendingUp className="text-green-500" size={16} /> Best Performances
            </h3>
            <div className="space-y-1.5">
              {notableGames.bestPerformances.map((game, idx) => (
                <div key={idx} className="p-2 bg-green-50 rounded text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">vs {game.opponent}</span>
                    <span className="text-xl font-bold text-green-600">{game.playerScore.toFixed(1)}</span>
                  </div>
                  <div className="text-gray-600">
                    Opp: {game.opponentScore.toFixed(1)}
                    <span className={`ml-1 ${game.result === 'win' ? 'text-green-600' : 'text-red-600'}`}>({game.result.toUpperCase()})</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Wk {game.week}, {game.year}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Worst Performances */}
          <div className="bg-white rounded-lg shadow p-3">
            <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1">
              <TrendingDown className="text-red-500" size={16} /> Worst Performances
            </h3>
            <div className="space-y-1.5">
              {notableGames.worstPerformances.map((game, idx) => (
                <div key={idx} className="p-2 bg-red-50 rounded text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">vs {game.opponent}</span>
                    <span className="text-xl font-bold text-red-600">{game.playerScore.toFixed(1)}</span>
                  </div>
                  <div className="text-gray-600">
                    Opp: {game.opponentScore.toFixed(1)}
                    <span className={`ml-1 ${game.result === 'win' ? 'text-green-600' : 'text-red-600'}`}>({game.result.toUpperCase()})</span>
                  </div>
                  <div className="text-[10px] text-gray-400">Wk {game.week}, {game.year}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}