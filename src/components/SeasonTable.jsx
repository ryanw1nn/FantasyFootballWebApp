// ==================================
// SeasonTable.jsx
// ==================================

import React, { useState, useMemo } from 'react';
import { Trophy, Medal } from 'lucide-react';
import Badge from './ui/Badge';
import { prepareSeasonRows } from '../stats/season';

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
 *  - Toggleable column visibility (owned by the caller, see tableColumns.js)
 *  - Search filtering by player name or team name
 *  - Clickable player names to view detailed stats
 *
 * @param {Object} props - Component props
 * @param {Array} props.seasonData - Array of team objects for the season
 * @param {string|number} props.year - The year of the season being displayed
 * @param {string} props.searchQuery - Search query to filter teams/players
 * @param {Function} props.onPlayerClick - Callback function when player name is clicked
 * @param {Object} props.visibleColumns - Map of optional column key -> shown/hidden
 */

export default function SeasonTable({ seasonData, year, searchQuery, onPlayerClick, visibleColumns = {} }) {
  // ==================================
  // STATE MANAGEMENT
  // ==================================

  const [sortConfig, setSortConfig] = useState({
    key: "place",
    direction: "asc"
  });

  const cols = visibleColumns;

  // ==================================
  // DATA PREPARATION & FILTERING
  // ==================================

  const preparedData = useMemo(
    () => prepareSeasonRows(seasonData, searchQuery),
    [seasonData, searchQuery]
  );

  // ==================================
  // SORTING
  // ==================================

  const sortedData = useMemo(() => {
    return [...preparedData].sort((a, b) => {
      let key = sortConfig.key;
      const dir = sortConfig.direction === "asc" ? 1 : -1;

      if (key === "place") {
        key = "placeValue";
      }

      let aVal = a[key];
      let bVal = b[key];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;

      return (b.pf || 0) - (a.pf || 0);
    });
  }, [preparedData, sortConfig]);

  const requestSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  // ==================================
  // RENDER
  // ==================================

  const th = "px-4 py-3 text-center font-semibold cursor-pointer hover:bg-slate-800 transition-colors whitespace-nowrap";
  const thLeft = "px-4 py-3 text-left font-semibold cursor-pointer hover:bg-slate-800 transition-colors whitespace-nowrap";
  const thCompact = "px-2.5 py-3 text-center font-semibold cursor-pointer hover:bg-slate-800 transition-colors whitespace-nowrap";
  const thLeftCompact = "px-2.5 py-3 text-left font-semibold cursor-pointer hover:bg-slate-800 transition-colors whitespace-nowrap";

  const showWinPct = cols.winPct !== false;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-[15px]">

          <thead className="sticky top-0 bg-slate-900 text-white z-10">
            <tr>
              <th className={thCompact} onClick={() => requestSort("place")}>
                Rank {getSortIcon("place")}
              </th>

              {cols.change !== false && (
                <th className="px-2 py-3 text-center font-semibold whitespace-nowrap">Δ</th>
              )}

              <th className={thLeftCompact} onClick={() => requestSort("team_name")}>
                Team {getSortIcon("team_name")}
              </th>

              <th className={thLeftCompact} onClick={() => requestSort("ownerName")}>
                Owner {getSortIcon("ownerName")}
              </th>

              {showWinPct && (
                <th className={th} onClick={() => requestSort("winPct")}>
                  WIN% {getSortIcon("winPct")}
                </th>
              )}

              <th className={th} onClick={() => requestSort("wins")}>
                Record {getSortIcon("wins")}
              </th>

              {cols.pf !== false && (
                <th className={th} onClick={() => requestSort("pf")}>
                  PF {getSortIcon("pf")}
                </th>
              )}

              {cols.pa !== false && (
                <th className={th} onClick={() => requestSort("pa")}>
                  PA {getSortIcon("pa")}
                </th>
              )}

              {cols.pfpg !== false && (
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap">PFPG</th>
              )}

              {cols.papg !== false && (
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap">PAPG</th>
              )}
            </tr>
          </thead>

          <tbody>
            {sortedData.map((row, idx) => {
              const winPctDisplay = row.totalGames
                ? (row.winPct * 100).toFixed(1) + "%"
                : "-";
              const pfpg = row.totalGames
                ? (row.pf / row.totalGames).toFixed(1)
                : "-";
              const papg = row.totalGames
                ? (row.pa / row.totalGames).toFixed(1)
                : "-";

              let rowClass = "border-b border-slate-200 hover:bg-slate-50 transition-colors";
              rowClass += idx % 2 === 0 ? " bg-white" : " bg-slate-50/60";

              if (row.place === 1) rowClass += " border-l-4 border-l-amber-400";
              else if (row.place === 2) rowClass += " border-l-4 border-l-slate-400";
              else if (row.place === 3) rowClass += " border-l-4 border-l-amber-700";
              else rowClass += " border-l-4 border-l-transparent";

              return (
                <tr key={idx} className={rowClass}>

                  <td className="px-2.5 py-3 text-center font-bold text-slate-900">
                    <div className="flex items-center justify-center gap-1">
                      {row.placeValue}
                      {row.is_regular_champ && (
                        <Badge icon={Medal} title="Regular Season Champion">RS</Badge>
                      )}
                      {row.is_playoff_champ && (
                        <Badge variant="gold" icon={Trophy} title="Playoff Champion">PO</Badge>
                      )}
                    </div>
                  </td>

                  {cols.change !== false && (
                    <td className="px-2 py-3 text-center">
                      {row.change > 0 && (
                        <span className="text-green-700 font-bold">+{row.change}</span>
                      )}
                      {row.change < 0 && (
                        <span className="text-red-700 font-bold">{row.change}</span>
                      )}
                      {row.change === 0 && (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                  )}

                  <td className="px-2.5 py-3 font-medium text-slate-900 max-w-[160px] truncate">
                    {row.team_name}
                  </td>

                  <td className="px-2.5 py-3 font-medium text-slate-900 max-w-[140px] truncate">
                    {/* A botted season belongs to nobody, so there is no player
                        page to send the reader to: the label is text, not a
                        button that opens an empty page. */}
                    {row.display_name == null ? (
                      <span className="truncate block">{row.ownerName}</span>
                    ) : (
                      <button
                        onClick={() => onPlayerClick && onPlayerClick(row.ownerName)}
                        className="text-left w-full hover:text-accent-600 transition-colors cursor-pointer truncate block"
                      >
                        {row.ownerName}
                      </button>
                    )}
                  </td>

                  {showWinPct && (
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${
                        row.winPct >= 0.5 ? 'text-green-700' : 'text-slate-600'
                      }`}>
                        {winPctDisplay}
                      </span>
                    </td>
                  )}

                  <td className="px-4 py-3 text-center text-slate-700 font-semibold whitespace-nowrap">
                    <span className="text-green-700 font-extrabold">{row.wins}</span>
                    <span className="mx-0.5">-</span>
                    <span className="text-red-700">{row.losses}</span>
                    {row.ties > 0 && (
                      <span>-<span className="text-slate-500">{row.ties}</span></span>
                    )}
                  </td>

                  {cols.pf !== false && (
                    <td className="px-4 py-3 text-center text-slate-700 font-medium">
                      {row.pf?.toFixed(1)}
                    </td>
                  )}

                  {cols.pa !== false && (
                    <td className="px-4 py-3 text-center text-slate-700 font-medium">
                      {row.pa?.toFixed(1)}
                    </td>
                  )}

                  {cols.pfpg !== false && (
                    <td className="px-4 py-3 text-center text-slate-700">
                      {pfpg}
                    </td>
                  )}

                  {cols.papg !== false && (
                    <td className="px-4 py-3 text-center text-slate-700">
                      {papg}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
