// ==================================
// SeasonTable.jsx
// ==================================

import React, { useState, useMemo } from 'react';

/**
 * SeasonTable Component
 * 
 * Displays rankings and statistics for a single season.
 * Features:
 *  - Season standings with place indicators
 *  - Rank change tracking (up/down from previous week)
 *  - Full Statistics (W-L, PF, PA, PFPG, PAPG)
 *  - Championship and playoff indicators
 *  - Sortable columns
 *  - Search filtering by player name or team name
 * 
 * @param {Object} props - Component props
 * @param {Array} props.seasonData - Array of team objects for the season
 * @param {string|number} props.year - The year of the season being displayed
 * @param {string} props.searchQuery - Search query to filter teams/players
 */
export default function SeasonTable({ seasonData, year, searchQuery }) {
  // ==================================
  // STATE MANAGEMENT
  // ==================================

  /**
   * Sorting configuration
   * Defaults to sorting by place (ascending - 1st place at top)
   */
  const [sortConfig, setSortConfig] = useState({
    key: "place",
    direction: "asc"
  });

  // ==================================
  // DATA PREPARATION & FILTERING
  // ==================================

  /**
   * Prepares and enriches season data with calculated fields
   * Memoized to prevent recalculation on every render
   */
  const preparedData = useMemo(() => {
    let data = seasonData.map((row, i) => {
      // ensure numeric values
      const wins = Number(row.wins) || 0;
      const losses = Number(row.losses) || 0;
      const ties = Number (row.ties) || 0;
      const totalGames = wins + losses + ties;

      // Calculates win percentage (ties = 0.5 wins)
      const winPct = totalGames ? (wins + 0.5 * ties) / totalGames : 0;

      // Calculate rank change from previous standings
      // Positive = moved up, Negative = moved down, 0 = no change
      const change = row.prevPlace != null && row.place != null
        ? row.prevPlace - row.place
        : 0;

      // Normalize place to number (handle emoji and string values)
      let placeValue = row.place;

      if (typeof placeValue === 'string') {
        const parsed = parseInt(placeValue);
        if(!isNaN(parsed)) {
          placeValue = parsed;
        }
      }

      return {
        ...row,
        wins,
        losses,
        ties,
        totalGames,
        winPct,
        change,
        placeValue,
        _idx: i, // preserve original index for stable sorting
      };
    });

    // Apply search filter if query exists
    if (searchQuery) {
        data = data.filter(d =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.team.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }

    return data;
  }, [seasonData, searchQuery]);

  // ==================================
  // SORTING
  // ==================================

  /**
   * Sorts teams based on current sort configuration
   * Includes tie-breakers: PF (descending) as primary tie-breaker
   * Memoized to prevent re-sorting on every render
   */
  const sortedData = useMemo(() => {
    return [...preparedData].sort((a, b) => {
      let key = sortConfig.key;
      const dir = sortConfig.direction === "asc" ? 1 : -1;

      // Use placevalue for sorting when sorting by place
      if (key === "place") {
        key = "placeValue";
      }

      let aVal = a[key];
      let bVal = b[key];

      // Handle null/undefined values
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Primary sort by selected column
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;

      // Tie-breaker; sort by PF (desc)
      return (b.pf || 0) - (a.pf || 0);
    });
  }, [preparedData, sortConfig]);

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
   * @param {string} key - The column key
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
        <thead className="sticky top-0 bg-gradient-to-r from-purple-600 to-purple-700 text-white z-10">
          <tr>
            {/* Place/Rank Column */}
            <th 
              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-purple-500 transition-colors" 
              onClick={() => requestSort("place")}
            >
              Rank {getSortIcon("place")}
            </th>
            
            {/* Change (Delta) Column - Not sortable */}
            <th className="px-4 py-3 text-center font-semibold">
              Δ
            </th>
            
            {/* Team Name Column */}
            <th 
              className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-purple-500 transition-colors" 
              onClick={() => requestSort("team")}
            >
              Team {getSortIcon("team")}
            </th>
            
            {/* Owner Name Column */}
            <th 
              className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-purple-500 transition-colors" 
              onClick={() => requestSort("name")}
            >
              Owner {getSortIcon("name")}
            </th>
            
            {/* Win Percentage Column */}
            <th 
              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-purple-500 transition-colors" 
              onClick={() => requestSort("winPct")}
            >
              WIN% {getSortIcon("winPct")}
            </th>
            
            {/* Win-Loss Record Column */}
            <th 
              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-purple-500 transition-colors" 
              onClick={() => requestSort("wins")}
            >
              Record {getSortIcon("wins")}
            </th>
            
            {/* Points For Column */}
            <th 
              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-purple-500 transition-colors" 
              onClick={() => requestSort("pf")}
            >
              PF {getSortIcon("pf")}
            </th>
            
            {/* Points Against Column */}
            <th 
              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-purple-500 transition-colors" 
              onClick={() => requestSort("pa")}
            >
              PA {getSortIcon("pa")}
            </th>
            
            {/* Points For Per Game - Not sortable (calculated field) */}
            <th className="px-4 py-3 text-center font-semibold">
              PFPG
            </th>
            
            {/* Points Against Per Game - Not sortable (calculated field) */}
            <th className="px-4 py-3 text-center font-semibold">
              PAPG
            </th>
          
          </tr>
        </thead>
        
        {/* Table Body */}
        <tbody>
          {sortedData.map((row, idx) => {
            // Calculate display values
            const winPctDisplay = row.totalGames 
              ? (row.winPct * 100).toFixed(1) + "%" 
              : "-";
            const pfpg = row.totalGames 
              ? (row.pf / row.totalGames).toFixed(1) 
              : "-";
            const papg = row.totalGames 
              ? (row.pa / row.totalGames).toFixed(1) 
              : "-";
            
            // Build row classes for styling
            let rowClass = "border-b border-gray-200 hover:bg-purple-50 transition-colors";
            
            // Add zebra striping
            if (idx % 2 === 0) rowClass += " bg-white";
            else rowClass += " bg-gray-50";

            // Add colored left border for top 3 finishers
            if (row.place === 1) rowClass += " border-l-4 border-l-yellow-400";
            else if (row.place === 2) rowClass += " border-l-4 border-l-gray-400";
            else if (row.place === 3) rowClass += " border-l-4 border-l-amber-700";

            return (
              <tr key={idx} className={rowClass}>
                
                {/* Place/Rank - Show medal emojis for top 3 or championship indicators */}
                <td className="px-4 py-3 text-center font-bold text-gray-900">
                  <div className="flex items-center justify-center gap-1">
                    {row.placeValue}
                    {/* Show championship indicators next to place */}
                    {row.rChampion && (
                      <span className="text-lg ml-1" title="Regular Season Champion">RS</span>
                    )}
                    {row.playoff?.pChampion && (
                      <span className="text-lg ml-1" title="Playoff Champion">PO</span>
                    )}
                  </div>
                </td>

                {/* Change Indicator - Green for up, Red for down */}
                <td className="px-4 py-3 text-center">
                  {row.change > 0 && (
                    <span className="text-green-600 font-bold">+{row.change}</span>
                  )}
                  {row.change < 0 && (
                    <span className="text-red-600 font-bold">{row.change}</span>
                  )}
                  {row.change === 0 && (
                    <span className="text-gray-400">-</span>
                  )}
                </td>

                {/* Team Name */}
                <td className="px-4 py-3 font-medium text-gray-900">
                  {row.team}
                </td>
                
                {/* Owner Name */}
                <td className="px-4 py-3 text-gray-700">
                  {row.name}
                </td>
                
                {/* Win Percentage - Color coded by performance */}
                <td className="px-4 py-3 text-center">
                  <span className={`font-semibold ${
                    row.winPct >= 0.6 ? 'text-green-600' :   // Great record
                    row.winPct >= 0.5 ? 'text-blue-600' :    // Above .500
                    'text-gray-600'                          // Below .500
                  }`}>
                    {winPctDisplay}
                  </span>
                </td>
                
                {/* Win-Loss Record - Color coded */}
                <td className="px-4 py-3 text-center text-gray-700">
                  <span className="text-green-600 font-medium">{row.wins}</span>-
                  <span className="text-red-600 font-medium">{row.losses}</span>
                  {row.ties > 0 && (
                    <span>-<span className="text-gray-500">-{row.ties}</span></span>
                  )}
                </td>
                
                {/* Points For */}
                <td className="px-4 py-3 text-center text-gray-700 font-medium">
                  {row.pf?.toFixed(1)}
                </td>
                
                {/* Points Against */}
                <td className="px-4 py-3 text-center text-gray-700 font-medium">
                  {row.pa?.toFixed(1)}
                </td>
                
                {/* Points For Per Game */}
                <td className="px-4 py-3 text-center text-gray-700">
                  {pfpg}
                </td>
                
                {/* Points Against Per Game */}
                <td className="px-4 py-3 text-center text-gray-700">
                  {papg}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}