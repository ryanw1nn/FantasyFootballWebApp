// ==================================
// AllTimeTable.jsx
// ==================================

import React, { useState, useMemo } from 'react';
import { Trophy, Medal } from 'lucide-react';
import Badge from './ui/Badge';

/**
 * AllTimeTable Component
 *
 * Displays aggregated career statistics for all players across all seasons.
 * Features:
 *  - Aggregates wins, losses, ties, points for/against across all seasons
 *  - Calculates career win percentage and per-game averages
 *  - Tracks championship counts (regular season and playoff)
 *  - Sortable columns
 *  - Toggleable column visibility (owned by the caller, see tableColumns.js)
 *  - Search filtering by player name
 *  - Clickable player names to view detailed stats
 *
 *  @param {Object} props - Component props
 *  @param {Object} props.allData - Object containing all season data, keyed by year
 *  @param {string} props.searchQuery - Search query to filter players by name
 *  @param {Function} props.onPlayerClick - Callback function when player name is clicked
 *  @param {Object} props.visibleColumns - Map of optional column key -> shown/hidden
 */

export default function AllTimeTable({ allData, searchQuery, onPlayerClick, visibleColumns = {} }) {

    // ==================================
    // STATE MANAGEMENT
    // ==================================

    const [sortConfig, setSortConfig] = useState({
        key: "winPct",
        direction: "desc"
    });

    const cols = visibleColumns;

    // ==================================
    // DATA AGGREGATION & FILTERING
    // ==================================

    const allTimeStats = useMemo(() => {
        const stats = {};

        const pfLeadersByYear = {};
        const paLeadersByYear = {};
        const lastPlaceByYear = {};
        Object.entries(allData)
            .filter(([year]) => !isNaN(Number(year)))
            .forEach(([seasonYear, season]) => {
                if (!Array.isArray(season)) return;

                let maxPF = -1;
                let pfLeader = null;
                let maxPA = -1;
                let paLeader = null;
                let maxPlace = -1;
                let lastPlace = null;
                season.forEach((row) => {
                    if ((row.pf || 0) > maxPF) {
                        maxPF = row.pf || 0;
                        pfLeader = row.name;
                    }
                    if ((row.pa || 0) > maxPA) {
                        maxPA = row.pa || 0;
                        paLeader = row.name;
                    }
                    if (row.place != null && row.place > maxPlace) {
                        maxPlace = row.place;
                        lastPlace = row.name;
                    }
                });
                if (pfLeader) {
                    pfLeadersByYear[seasonYear] = pfLeader;
                }
                if (paLeader) {
                    paLeadersByYear[seasonYear] = paLeader;
                }
                if (lastPlace) {
                    lastPlaceByYear[seasonYear] = lastPlace;
                }
            });

        Object.entries(allData)
            .filter(([year]) => !isNaN(Number(year)))
            .forEach(([seasonYear, season]) => {
            if (!Array.isArray(season)) return;
            season.forEach((row) => {
                const name = row.name;

                if (!stats[name]) {
                    stats[name] = {
                        wins: 0,
                        losses: 0,
                        ties: 0,
                        PF: 0,
                        PA: 0,
                        rChampionYears: [],
                        playoffRounds: 0,
                        pChampionYears: [],
                        pfLeaderYears: [],
                        paLeaderYears: [],
                        regLoserYears: []
                    };
                }

                stats[name].wins += row.wins || 0;
                stats[name].losses += row.losses || 0;
                stats[name].ties += row.ties || 0;
                stats[name].PF += row.pf || 0;
                stats[name].PA += row.pa || 0;

                if (row.rChampion) {
                    const shortYear = "'" + seasonYear.toString().slice(-2);
                    stats[name].rChampionYears.push(shortYear);
                }

                if (pfLeadersByYear[seasonYear] === name) {
                    const shortYear = "'" + seasonYear.toString().slice(-2);
                    stats[name].pfLeaderYears.push(shortYear);
                }

                if (paLeadersByYear[seasonYear] === name) {
                    const shortYear = "'" + seasonYear.toString().slice(-2);
                    stats[name].paLeaderYears.push(shortYear);
                }

                if (lastPlaceByYear[seasonYear] === name) {
                    const shortYear = "'" + seasonYear.toString().slice(-2);
                    stats[name].regLoserYears.push(shortYear);
                }

                if (row.playoff?.made) {
                    let rounds = row.playoff.rounds || 0;
                    if (row.playoff.pChampion) rounds += 1;
                    stats[name].playoffRounds += rounds;
                }

                if (row.playoff?.pChampion) {
                    const shortYear = "'" + seasonYear.toString().slice(-2);
                    stats[name].pChampionYears.push(shortYear);
                }
            });
        });

        let players = Object.entries(stats).map(([name, s]) => {
            const totalGames = s.wins + s.losses + s.ties;

            const winPct = totalGames ? (s.wins + 0.5 * s.ties) / totalGames : 0;

            return {
                name,
                ...s,
                totalGames,
                winPct,
                PFPG: totalGames ? s.PF / totalGames : 0,
                PAPG: totalGames ? s.PA / totalGames : 0,
                rChampionCount: s.rChampionYears.length,
                pChampionCount: s.pChampionYears.length,
                pfLeaderCount: s.pfLeaderYears.length,
                paLeaderCount: s.paLeaderYears.length,
                regLoserCount: s.regLoserYears.length
            };
        });

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

    const sortedPlayers = useMemo(() => {
        return [...allTimeStats].sort((a, b) => {
            if (!sortConfig.key) return 0;

            let aValue = a[sortConfig.key];
            let bValue = b[sortConfig.key];

            if (typeof aValue === "string") aValue = aValue.toLowerCase();
            if (typeof bValue === "string") bValue = bValue.toLowerCase();

            if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;

            return (b.PF || 0) - (a.PF || 0);
        });
    }, [allTimeStats, sortConfig]);

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
    const groupTh = "px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-300 whitespace-nowrap";
    const divider = "border-l-2 border-slate-700";
    const dividerCell = "border-l-2 border-slate-200";

    // Visibility per optional column, used both for rendering and for group colSpans/dividers.
    const showL = cols.losses !== false;
    const showT = cols.ties !== false;
    const showGP = cols.gp !== false;
    const showPFPG = cols.pfpg !== false;
    const showPAPG = cols.papg !== false;
    const showPFTotal = cols.pfTotal !== false;
    const showPATotal = cols.paTotal !== false;
    const showMPF = cols.mpf !== false;
    const showRS = cols.rs !== false;
    const showPALdr = cols.paLdr !== false;
    const showRegLoser = cols.regLoser !== false;
    const showRounds = cols.rounds !== false;
    const showPO = cols.po !== false;

    const statsSpan = 2 + [showL, showT, showGP, showPFPG, showPAPG, showPFTotal, showPATotal].filter(Boolean).length; // +2 for always-on WIN% and W
    const regAwardsSpan = [showMPF, showRS, showPALdr, showRegLoser].filter(Boolean).length;
    const postAwardsSpan = [showRounds, showPO].filter(Boolean).length;

    // First visible column in each toggleable group gets the divider so the border survives column toggling.
    const regAwardsFirst = showMPF ? 'mpf' : showRS ? 'rs' : showPALdr ? 'paLdr' : showRegLoser ? 'regLoser' : null;
    const postAwardsFirst = showRounds ? 'rounds' : showPO ? 'po' : null;

    return (
        <div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-[15px]">

                    <thead className="sticky top-0 bg-slate-900 text-white z-10">
                        {/* Group band: separates raw stats from regular-season and postseason awards */}
                        <tr>
                            <th colSpan={1} className="bg-slate-900"></th>
                            <th colSpan={statsSpan} className={`${groupTh} ${divider}`}>Regular Season</th>
                            {regAwardsSpan > 0 && (
                                <th colSpan={regAwardsSpan} className={`${groupTh} ${divider} bg-accent-950/40`}>Reg. Season Awards</th>
                            )}
                            {postAwardsSpan > 0 && (
                                <th colSpan={postAwardsSpan} className={`${groupTh} ${divider} bg-amber-950/30`}>Postseason Awards</th>
                            )}
                        </tr>
                        <tr>
                        <th
                            className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-slate-800 transition-colors whitespace-nowrap"
                            onClick={() => requestSort("name")}
                        >
                            Player {getSortIcon("name")}
                        </th>
                        <th className={`${th} ${divider}`} onClick={() => requestSort("winPct")}>
                            WIN% {getSortIcon("winPct")}
                        </th>
                        <th className={th} onClick={() => requestSort("wins")}>
                            W {getSortIcon("wins")}
                        </th>
                        {showL && (
                            <th className={th} onClick={() => requestSort("losses")}>
                                L {getSortIcon("losses")}
                            </th>
                        )}
                        {showT && (
                            <th className={th} onClick={() => requestSort("ties")}>
                                T {getSortIcon("ties")}
                            </th>
                        )}
                        {showGP && (
                            <th className={th} onClick={() => requestSort("totalGames")}>
                                GP {getSortIcon("totalGames")}
                            </th>
                        )}
                        {showPFPG && (
                            <th className={th} onClick={() => requestSort("PFPG")}>
                                PFPG {getSortIcon("PFPG")}
                            </th>
                        )}
                        {showPAPG && (
                            <th className={th} onClick={() => requestSort("PAPG")}>
                                PAPG {getSortIcon("PAPG")}
                            </th>
                        )}
                        {showPFTotal && (
                            <th className={th} onClick={() => requestSort("PF")} title="Points For (Career Total)">
                                PF {getSortIcon("PF")}
                            </th>
                        )}
                        {showPATotal && (
                            <th className={th} onClick={() => requestSort("PA")} title="Points Against (Career Total)">
                                PA {getSortIcon("PA")}
                            </th>
                        )}
                        {showMPF && (
                            <th
                                className={`${th} ${regAwardsFirst === 'mpf' ? divider : ''}`}
                                onClick={() => requestSort("pfLeaderCount")}
                                title="Points-For Leader (Regular Season)"
                            >
                                PF LDR {getSortIcon("pfLeaderCount")}
                            </th>
                        )}
                        {showRS && (
                            <th
                                className={`${th} ${regAwardsFirst === 'rs' ? divider : ''}`}
                                onClick={() => requestSort("rChampionCount")}
                                title="Regular Season Champion"
                            >
                                Champ {getSortIcon("rChampionCount")}
                            </th>
                        )}
                        {showPALdr && (
                            <th
                                className={`${th} ${regAwardsFirst === 'paLdr' ? divider : ''}`}
                                onClick={() => requestSort("paLeaderCount")}
                                title="Points-Against Leader (Most Points Allowed, Regular Season)"
                            >
                                PA LDR {getSortIcon("paLeaderCount")}
                            </th>
                        )}
                        {showRegLoser && (
                            <th
                                className={`${th} ${regAwardsFirst === 'regLoser' ? divider : ''}`}
                                onClick={() => requestSort("regLoserCount")}
                                title="Regular Season Last Place"
                            >
                                Last {getSortIcon("regLoserCount")}
                            </th>
                        )}
                        {showRounds && (
                            <th
                                className={`${th} ${postAwardsFirst === 'rounds' ? divider : ''}`}
                                onClick={() => requestSort("playoffRounds")}
                                title="Playoff Rounds Won"
                            >
                                Rounds {getSortIcon("playoffRounds")}
                            </th>
                        )}
                        {showPO && (
                            <th
                                className={`${th} ${postAwardsFirst === 'po' ? divider : ''}`}
                                onClick={() => requestSort("pChampionCount")}
                                title="Playoff Champion"
                            >
                                Champ {getSortIcon("pChampionCount")}
                            </th>
                        )}
                        </tr>
                    </thead>

                    <tbody>
                    {sortedPlayers.map((player, idx) => (
                        <tr
                        key={idx}
                        className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${
                            idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                        }`}
                        >
                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                            <button
                                onClick={() => onPlayerClick && onPlayerClick(player.name)}
                                className="text-left w-full hover:text-accent-600 transition-colors cursor-pointer"
                            >
                                {player.name}
                            </button>
                        </td>

                        <td className={`px-4 py-3 text-center ${dividerCell}`}>
                            <span className={`font-semibold ${
                            player.winPct >= 0.5 ? 'text-green-700' : 'text-slate-600'
                            }`}>
                            {(player.winPct * 100).toFixed(1)}%
                            </span>
                        </td>

                        <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded bg-green-50 text-green-700 font-extrabold">
                                {player.wins}
                            </span>
                        </td>

                        {showL && (
                            <td className="px-4 py-3 text-center text-red-700 font-semibold">
                                {player.losses}
                            </td>
                        )}

                        {showT && (
                            <td className="px-4 py-3 text-center text-slate-600 font-medium">
                                {player.ties}
                            </td>
                        )}

                        {showGP && (
                            <td className="px-4 py-3 text-center text-slate-700">
                                {player.totalGames}
                            </td>
                        )}

                        {showPFPG && (
                            <td className="px-4 py-3 text-center text-slate-700">
                                {player.PFPG.toFixed(1)}
                            </td>
                        )}

                        {showPAPG && (
                            <td className="px-4 py-3 text-center text-slate-700">
                                {player.PAPG.toFixed(1)}
                            </td>
                        )}

                        {showPFTotal && (
                            <td className="px-4 py-3 text-center text-slate-700">
                                {player.PF.toFixed(1)}
                            </td>
                        )}

                        {showPATotal && (
                            <td className="px-4 py-3 text-center text-slate-700">
                                {player.PA.toFixed(1)}
                            </td>
                        )}

                        {showMPF && (
                            <td className={`px-4 py-3 text-center ${regAwardsFirst === 'mpf' ? dividerCell : ''}`}>
                                {player.pfLeaderCount > 0 && (
                                    <Badge>{player.pfLeaderYears.join(', ')}</Badge>
                                )}
                            </td>
                        )}

                        {showRS && (
                            <td className={`px-4 py-3 text-center ${regAwardsFirst === 'rs' ? dividerCell : ''}`}>
                                {player.rChampionYears.length > 0 && (
                                    <Badge icon={Medal}>{player.rChampionYears.join(', ')}</Badge>
                                )}
                            </td>
                        )}

                        {showPALdr && (
                            <td className={`px-4 py-3 text-center ${regAwardsFirst === 'paLdr' ? dividerCell : ''}`}>
                                {player.paLeaderCount > 0 && (
                                    <Badge>{player.paLeaderYears.join(', ')}</Badge>
                                )}
                            </td>
                        )}

                        {showRegLoser && (
                            <td className={`px-4 py-3 text-center ${regAwardsFirst === 'regLoser' ? dividerCell : ''}`}>
                                {player.regLoserCount > 0 && (
                                    <Badge>{player.regLoserYears.join(', ')}</Badge>
                                )}
                            </td>
                        )}

                        {showRounds && (
                            <td className={`px-4 py-3 text-center ${postAwardsFirst === 'rounds' ? dividerCell : ''}`}>
                                {player.playoffRounds > 0 && (
                                    <Badge>{player.playoffRounds}</Badge>
                                )}
                            </td>
                        )}

                        {showPO && (
                            <td className={`px-4 py-3 text-center ${postAwardsFirst === 'po' ? dividerCell : ''}`}>
                                {player.pChampionYears.length > 0 && (
                                    <Badge variant="gold" icon={Trophy}>{player.pChampionYears.join(', ')}</Badge>
                                )}
                            </td>
                        )}

                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
