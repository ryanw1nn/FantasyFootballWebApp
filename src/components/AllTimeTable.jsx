// ==================================
// AllTimeTable.jsx
// ==================================

import React, { useState, useMemo } from 'react';

/**
 * AllTimeTable Component
 * 
 * Displays aggregated career statistics for all players across all seasons.
 * Features:
 *  - Aggregates wins, losses, ties, points for/against across all seasons
 *  - Calculates career win percentage and per-game averages
 *  - Tracks championship counts (regular season and playoff)
 *  - Sortable columns
 *  Search filtering by player name
 * 
 *  @param {Object} props - Component props
 *  @param {Object} props.allData - Object containing all season data, keyed by year
 *  @param {string} props.searchQuery - Search query to filter players by name
 */
export default function AllTimeTable({ allData, searchQuery }) {

    // ==================================
    // STATE MANAGEMENT
    // ==================================

    /**
     * Sorting configuration
     * Defaults to sorting by win percentage (decending)
     */
    const [sortConfig, setSortConfig] = useState({
        key: "winPct",
        direction: "desc"
    });

    // ==================================
    // DATA AGGREGATION & FILTERING
    // ==================================

    /**
     * Aggregates all player statistics across all seasons
     * Memoized to prevent recalculation on every render
     */
    
    const allTimeStats = useMemo(() => {
        const stats = {};

        // Loop through each season's data
        Object.values(allData).forEach((season) => {
            season.forEach((row) => {
                const name = row.name;

                // Initialize player stats if this is their first appearance
                if (!stats[name]) {
                    stats[name] = {
                        wins: 0,
                        losses: 0,
                        ties: 0,
                        PF: 0,
                        PA: 0,
                        rChampionCount: 0,
                        playoffRounds: 0,
                        pChampionCount: 0
                    };
                }

                // Accumulate season stats
                stats[name].wins += row.wins || 0;
                stats[name].losses += row.losses || 0;
                stats[name].ties += row.ties || 0;
                stats[name].PF += row.pf || 0;
                stats[name].PA += row.pa || 0;

                // Track championships
                if (row.rChampion) {
                    stats[name].rChampionCount += 1;
                }

                // Track playoff rounds won
                if (row.playoff?.made) {
                    let rounds = row.playoff.rounds || 0;
                    // Add an extra round if they won the championship
                    if (row.playoff.pChampion) rounds += 1;
                    stats[name].playoffRounds += rounds;
                }

                // Track playoff championships
                if (row.playoff?.pChampion) {
                    stats[name].pChampionCount += 1;
                }
            });
        });

        // Convert stats object to array and calculate derived metrics
        let players = Object.entries(stats).map(([name, s]) => {
            const totalGames = s.wins + s.losses + s.ties;

            // Calculate win percentage (ties count as 0.5 wins)
            const winPct = totalGames ? (s.wins + 0.5 * s.ties) / totalGames : 0;

            return {
                name,
                ...s,
                totalGames,
                winPct,
                PFPG: totalGames ? s.PF / totalGames : 0,
                PAPG: totalGames ? s.PA / totalGames : 0,
            };
        });

        // Apply search filter if query exists
        if (searchQuery) {
            players = players.filter(p =>
                p.name.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        return players;
    }, [allData, searchQuery]);

    // ==================================
    // SORTING
    // ==================================

    /**
     * Sorts players based on current sort configuration
     * Memoized to prevent re-sorting on every render
     */
    const sortedPlayers = useMemo(() => {
        return [...allTimeStats].sort((a, b) => {
            if (!sortConfig.key) return 0;

            let aValue = a[sortConfig.key];
            let bValue = b[sortConfig.key];

            // Convert strings to lower case for case-insensitive comparison
            if (typeof aValue == "string") aValue = aValue.toLowerCase();
            if (typeof bValue == "string") bValue = bValue.toLowerCase();

            // Primary sort by selected column
            if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;

            // Tie-breaker: sort by total Points For (descending)
            return (b.PF || 0) - (a.PF || 0);
        });
    }, [allTimeStats, sortConfig]);

    /**
     * Handles column header clicks to change sorting
     * Toggles between ascending and descending on repeated clicks
     * 
     * @param {string} key - The column key to sort by
     */
    const requestSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
        }));
    };

    /**
     * Returns the appropiate sort indicator for a column
     * 
     * @param {string} key - the column key
     * @returns {string} Unicode arrow character or empty string
     */
    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return "↕";
        return sortConfig.direction === "asc" ? "↑" : "↓";
    };

    // ==================================
    // RENDER
    // ==================================

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse">
            
                {/* Table Header - Sticky on scroll */}
                <thead className="sticky top-0 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white z-10">
                    <tr>
                    <th 
                        className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("name")}
                    >
                        Player {getSortIcon("name")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("winPct")}
                    >
                        WIN% {getSortIcon("winPct")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("wins")}
                    >
                        W {getSortIcon("wins")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("losses")}
                    >
                        L {getSortIcon("losses")}
                    </th>
                    <th
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors"
                        onClick={() => requestSort("ties")}
                    >   T {getSortIcon("ties")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("totalGames")}
                    >
                        GP {getSortIcon("totalGames")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("PFPG")}
                    >
                        PFPG {getSortIcon("PFPG")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("rChampionCount")}
                    >
                        RS {getSortIcon("rChampionCount")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("playoffRounds")}
                    >
                        Rounds {getSortIcon("playoffRounds")}
                    </th>
                    <th 
                        className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-indigo-500 transition-colors" 
                        onClick={() => requestSort("pChampionCount")}
                    >
                        PO {getSortIcon("pChampionCount")}
                    </th>
                    </tr>
                </thead>

                {/* Table Body */}
                <tbody>
                {sortedPlayers.map((player, idx) => (
                    <tr 
                    key={idx} 
                    className={`border-b border-gray-200 hover:bg-indigo-50 transition-colors ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    }`}
                    >
                    {/* Player Name */}
                    <td className="px-4 py-3 font-medium text-gray-900">
                        {player.name}
                    </td>
                    
                    {/* Win Percentage - Color coded by performance */}
                    <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${
                        player.winPct >= 0.6 ? 'text-green-600' :   // Great record
                        player.winPct >= 0.5 ? 'text-blue-600' :    // Above .500
                        'text-gray-600'                              // Below .500
                        }`}>
                        {(player.winPct * 100).toFixed(1)}%
                        </span>
                    </td>
                    
                    {/* Wins - Green color */}
                    <td className="px-4 py-3 text-center text-green-600 font-medium">
                        {player.wins}
                    </td>
                    
                    {/* Losses - Red color */}
                    <td className="px-4 py-3 text-center text-red-600 font-medium">
                        {player.losses}
                    </td>

                    {/* Ties - Gray color */}
                    <td className="px-4 py-3 text-center text-gray-600 font-medium">
                        {player.ties}
                    </td>
                    
                    {/* Games Played */}
                    <td className="px-4 py-3 text-center text-gray-700">
                        {player.totalGames}
                    </td>
                    
                    {/* Points For Per Game */}
                    <td className="px-4 py-3 text-center text-gray-700">
                        {player.PFPG.toFixed(1)}
                    </td>
                    
                    
                    {/* Regular Season Championships - Badge display */}
                    <td className="px-4 py-3 text-center">
                        {player.rChampionCount > 0 && (
                        <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-semibold">
                            {player.rChampionCount}
                        </span>
                        )}
                    </td>

                     {/* Playoff Rounds - Badge display */}
                     <td className="px-4 py-3 text-center">
                        {player.pChampionCount > 0 && (
                        <span className="inline-flex items-center justify-center bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-sm font-semibold">
                            {player.playoffRounds}
                        </span>
                        )}
                    </td>   

                    {/* Playoff Championships - Badge display */}
                    <td className="px-4 py-3 text-center">
                        {player.pChampionCount > 0 && (
                        <span className="inline-flex items-center justify-center bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-sm font-semibold">
                            {player.pChampionCount}
                        </span>
                        )}
                    </td>

                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    )
}
