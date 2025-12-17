// ==================================
// PlayerStatsPage.jsx
// ==================================

import React, { useState, useMemo } from 'react';
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
    const [showOpponentFilters, setShowOpponentFilters] = useState(false);
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

            return {
                ...record,
                totalGames,
                winPct,
                pfpg
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
            const teams = Array.isArray(seasonData) ? seasonData : seasonData?.teams || [];
            let maxPF = -1;
            let pfLeader = null;
            
            teams.forEach(team => {
                if((team.pf || 0) > maxPF) {
                    maxPF = team.pf || 0;
                    pfLeader = team.name;
                }
            });
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

            if (playerSeasonData.regularSeasonChampion) {
                playerAwards.regularSeasonChampionships.push(Number(year));
            }
            
            if(playerSeasonData.playoff) {
                if(playerSeasonData.playoff.made) {
                    let rounds = playerSeasonData.playoff.rounds || 0;
                    if (playerSeasonData.playoff.pChampion)
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
        setGameTypeFilters(prev => 
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

    // ==================================
    // RENDER SECTION ONLY - PlayerStatsPage.jsx
    // ==================================

    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-7xl mx-auto p-6">
        
        {/* Header with Back Button */}
        <div className="mb-6">
            <button
            onClick={onBack}
            className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-medium mb-4 transition-colors"
            >
            <ArrowLeft size={20} />
            Back to Tables
            </button>
            
            <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-3">
                <Trophy className="text-yellow-500" size={40}/>
                {playerName}
            </h1>
            <p className="text-gray-600">Career Statistics & Achievements</p>
            </div>
        </div>

        {/* Game Type Filters */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
            <h3 className="font-semibold text-gray-900">Filter by Game Type:</h3>
            <div className="flex gap-4">
                {Object.entries(gameTypeFilters).map(([type, enabled]) => (
                <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleGameTypeFilter(type)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-gray-700 capitalize">
                    {type === 'regular' ? 'Regular Season' : 
                    type === 'playoff' ? 'Playoffs' :
                    type === 'toilet' ? 'Toilet Bowl' : 
                    'Out Games'}
                    </span>
                </label>
                ))}
            </div>
            </div>
        </div>

        {/* Overall Statistics */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Overall Record</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
                <div className="text-3xl font-bold text-blue-600">
                {overallStats.wins}-{overallStats.losses}-{overallStats.ties}
                </div>
                <div className="text-sm text-gray-600 mt-1">Record</div>
            </div>
            
            <div className="text-center p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
                <div className="text-3xl font-bold text-green-600">
                {(overallStats.winPct * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-gray-600 mt-1">Win Percentage</div>
            </div>
            
            <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg">
                <div className="text-3xl font-bold text-purple-600">
                {overallStats.pfpg.toFixed(1)}
                </div>
                <div className="text-sm text-gray-600 mt-1">PFPG</div>
            </div>
            
            <div className="text-center p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg">
                <div className="text-3xl font-bold text-orange-600">
                {overallStats.totalGames}
                </div>
                <div className="text-sm text-gray-600 mt-1">Games Played</div>
            </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-center text-sm text-gray-600">
            <div>
                <span className="font-semibold">Total Points For:</span> {overallStats.totalPF.toFixed(1)}
            </div>
            <div>
                <span className="font-semibold">Total Points Against:</span> {overallStats.totalPA.toFixed(1)}
            </div>
            </div>
        </div>

        {/* Awards Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Award className="text-yellow-500" size={28} />
            Awards & Achievements
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Regular Season Championships */}
            <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                <Trophy className="text-blue-600" size={20} />
                <h3 className="font-semibold text-gray-900">Regular Season Championships</h3>
                </div>
                {awards.regularSeasonChampionships.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {awards.regularSeasonChampionships.map(year => (
                    <span key={year} className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                        {year}
                    </span>
                    ))}
                </div>
                ) : (
                <p className="text-gray-500 text-sm">No championships yet</p>
                )}
            </div>

            {/* Playoff Championships */}
            <div className="p-4 bg-yellow-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                <Trophy className="text-yellow-600" size={20} />
                <h3 className="font-semibold text-gray-900">Playoff Championships</h3>
                </div>
                {awards.playoffChampionships.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {awards.playoffChampionships.map(year => (
                    <span key={year} className="bg-yellow-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                        {year}
                    </span>
                    ))}
                </div>
                ) : (
                <p className="text-gray-500 text-sm">No championships yet</p>
                )}
            </div>

            {/* Playoff Rounds Won */}
            <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                <Target className="text-green-600" size={20} />
                <h3 className="font-semibold text-gray-900">Total Playoff Rounds Won</h3>
                </div>
                <div className="text-3xl font-bold text-green-600">{awards.playoffRounds}</div>
            </div>
            </div>
        </div>

        {/* Head-to-Head Records */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Head-to-Head Records</h2>
            
            <div className="overflow-x-auto">
            <table className="w-full">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                    <th 
                    className="px-4 py-3 text-left text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleH2HSort('opponent')}
                    >
                    Opponent{renderSortIcon('opponent')}
                    </th>
                    <th 
                    className="px-4 py-3 text-center text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleH2HSort('winPct')}
                    >
                    Win %{renderSortIcon('winPct')}
                    </th>
                    <th 
                    className="px-4 py-3 text-center text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleH2HSort('wins')}
                    >
                    Wins{renderSortIcon('wins')}
                    </th>
                    <th 
                    className="px-4 py-3 text-center text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleH2HSort('losses')}
                    >
                    Losses{renderSortIcon('losses')}
                    </th>
                    <th 
                    className="px-4 py-3 text-center text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleH2HSort('ties')}
                    >
                    Ties{renderSortIcon('ties')}
                    </th>
                    <th 
                    className="px-4 py-3 text-center text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleH2HSort('totalGames')}
                    >
                    Games{renderSortIcon('totalGames')}
                    </th>
                    <th 
                    className="px-4 py-3 text-center text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleH2HSort('pfpg')}
                    >
                    PFPG{renderSortIcon('pfpg')}
                    </th>
                </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                {headToHeadStats.map((record, idx) => (
                    <tr key={record.opponent} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-900">{record.opponent}</td>
                    <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${
                        record.winPct >= 0.6 ? 'text-green-600' :
                        record.winPct >= 0.5 ? 'text-blue-600' :
                        'text-gray-600'
                        }`}>
                        {(record.winPct * 100).toFixed(1)}%
                        </span>
                    </td>
                    <td className="px-4 py-3 text-center text-green-600 font-medium">{record.wins}</td>
                    <td className="px-4 py-3 text-center text-red-600 font-medium">{record.losses}</td>
                    <td className="px-4 py-3 text-center text-gray-600 font-medium">{record.ties}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{record.totalGames}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{record.pfpg.toFixed(1)}</td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>
        </div>

        {/* Notable Games */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            
            {/* Closest Games */}
            <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Target className="text-blue-500" size={24} />
                Closest Games
            </h2>
            
            {notableGames.closestGames.length > 0 ? (
                <div className="space-y-3">
                {notableGames.closestGames.map((game, idx) => (
                    <div key={idx} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-gray-900">
                        vs {game.opponent}
                        </span>
                        <span className={`text-sm font-medium px-2 py-1 rounded ${
                        game.result === 'win' ? 'bg-green-100 text-green-700' :
                        game.result === 'loss' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                        }`}>
                        {game.result.toUpperCase()}
                        </span>
                    </div>
                    <div className="text-sm text-gray-600">
                        {game.playerScore.toFixed(2)} - {game.opponentScore.toFixed(2)} 
                        <span className="ml-2 font-semibold text-blue-600">
                        (Margin: {game.margin.toFixed(2)})
                        </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Week {game.week}, {game.year} • {game.gameType.charAt(0).toUpperCase() + game.gameType.slice(1)}
                        {game.label && ` • ${game.label}`}
                    </div>
                    </div>
                ))}
                </div>
            ) : (
                <p className="text-gray-500 text-sm">No games recorded</p>
            )}
            </div>

            {/* Biggest Blowouts */}
            <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="text-purple-500" size={24} />
                Biggest Blowouts
            </h2>
            
            {notableGames.biggestBlowouts.length > 0 ? (
                <div className="space-y-3">
                {notableGames.biggestBlowouts.map((game, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border ${
                    game.result === 'win' 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-red-50 border-red-200'
                    }`}>
                    <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-gray-900">
                        vs {game.opponent}
                        </span>
                        <span className={`text-sm font-medium px-2 py-1 rounded ${
                        game.result === 'win' ? 'bg-green-100 text-green-700' :
                        'bg-red-100 text-red-700'
                        }`}>
                        {game.result.toUpperCase()}
                        </span>
                    </div>
                    <div className="text-sm text-gray-600">
                        {game.playerScore.toFixed(2)} - {game.opponentScore.toFixed(2)} 
                        <span className={`ml-2 font-semibold ${
                        game.result === 'win' ? 'text-green-600' : 'text-red-600'
                        }`}>
                        (Margin: {game.margin.toFixed(2)})
                        </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Week {game.week}, {game.year} • {game.gameType.charAt(0).toUpperCase() + game.gameType.slice(1)}
                        {game.label && ` • ${game.label}`}
                    </div>
                    </div>
                ))}
                </div>
            ) : (
                <p className="text-gray-500 text-sm">No games recorded</p>
            )}
            </div>

            {/* Best Performances */}
            <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="text-green-500" size={24} />
                Best Performances
            </h2>
            
            {notableGames.bestPerformances.length > 0 ? (
                <div className="space-y-3">
                {notableGames.bestPerformances.map((game, idx) => (
                    <div key={idx} className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-gray-900">
                        vs {game.opponent}
                        </span>
                        <span className="text-2xl font-bold text-green-600">
                        {game.playerScore.toFixed(2)}
                        </span>
                    </div>
                    <div className="text-sm text-gray-600">
                        Opponent: {game.opponentScore.toFixed(2)} 
                        <span className={`ml-2 font-medium ${
                        game.result === 'win' ? 'text-green-600' : 'text-red-600'
                        }`}>
                        ({game.result.toUpperCase()})
                        </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Week {game.week}, {game.year} • {game.gameType.charAt(0).toUpperCase() + game.gameType.slice(1)}
                        {game.label && ` • ${game.label}`}
                    </div>
                    </div>
                ))}
                </div>
            ) : (
                <p className="text-gray-500 text-sm">No games recorded</p>
            )}
            </div>

            {/* Worst Performances */}
            <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingDown className="text-red-500" size={24} />
                Worst Performances
            </h2>
            
            {notableGames.worstPerformances.length > 0 ? (
                <div className="space-y-3">
                {notableGames.worstPerformances.map((game, idx) => (
                    <div key={idx} className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-gray-900">
                        vs {game.opponent}
                        </span>
                        <span className="text-2xl font-bold text-red-600">
                        {game.playerScore.toFixed(2)}
                        </span>
                    </div>
                    <div className="text-sm text-gray-600">
                        Opponent: {game.opponentScore.toFixed(2)} 
                        <span className={`ml-2 font-medium ${
                        game.result === 'win' ? 'text-green-600' : 'text-red-600'
                        }`}>
                        ({game.result.toUpperCase()})
                        </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Week {game.week}, {game.year} • {game.gameType.charAt(0).toUpperCase() + game.gameType.slice(1)}
                        {game.label && ` • ${game.label}`}
                    </div>
                    </div>
                ))}
                </div>
            ) : (
                <p className="text-gray-500 text-sm">No games recorded</p>
            )}
            </div>
        </div>

        </div>
    </div>
    );
}