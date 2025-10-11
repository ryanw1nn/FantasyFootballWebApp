import React, {useState} from "react";
import styles from "./Table.module.css";

export default function AllTimeTable({ allData }) {
    const [sortConfig, setSortConfig] = useState({ key: "winPct", direction: "desc" });

    if (!allData) return null;

    // aggregate data by player name
    const allTimeStats = {};
    Object.values(allData).forEach((season) => {
        season.forEach((row) => {
            const name = row.name;
            if(!allTimeStats[name]) {
                allTimeStats[name] = { wins: 0, losses: 0, ties: 0, PF: 0, PA: 0, rChampionCount: 0, playoffRounds: 0, pChampionCount: 0 };
            }

            allTimeStats[name].wins += row.wins || 0;
            allTimeStats[name].losses += row.losses || 0;
            allTimeStats[name].ties += row.ties || 0;
            allTimeStats[name].PF += row.pf || 0;
            allTimeStats[name].PA += row.pa || 0;

            if (row.rChampion) allTimeStats[name].rChampionCount += 1;
            if (row.playoff?.made){
                let rounds = row.playoff.rounds || 0;
                if (row.playoff.pChampion) rounds += 1;
                allTimeStats[name].playoffRounds += rounds;
            }

            if (row.playoff?.pChampion) allTimeStats[name].pChampionCount += 1;

        });
    });

    // convert into array with computed fields
    const players = Object.entries(allTimeStats).map(([name, stats]) => {
        const totalGames = stats.wins + stats.losses + stats.ties;
        const winPct = totalGames ? (stats.wins + 0.5 * stats.ties) / totalGames : 0;
        const pfpg = totalGames ? stats.PF / totalGames : 0;
        const papg = totalGames ? stats.PA / totalGames : 0;

        const regSeasonChamps = stats.rChampionCount || 0;
        const playoffRounds = stats.playoffRounds || 0;
        const postSeasonChamps = stats.pChampionCount || 0;

        return {
            name,
            ...stats,
            totalGames,
            winPct,
            PFPG: pfpg,
            PAPG: papg,
            regSeasonChamps,
            playoffRounds,
            postSeasonChamps,
        };
    });

    // apply sorting
    const sortedPlayers = [...players].sort((a, b) => {
        if (!sortConfig.key) return 0;
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (typeof aValue === "string" && typeof bValue ==="string") {
            aValue = aValue.toLowerCase();
            bValue = bValue.toLowerCase();
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;

        let aPF = a.PF ?? 0;
        let bPF = b.PF ?? 0;
        if (aPF < bPF) return sortConfig.direction === "asc" ? -1 : 1;
        if (aPF > bPF) return sortConfig.direction === "asc" ? 1 : -1;

        return 0;
    });

    // handle header click
    const requestSort = (key) => {
        let direction = "asc";
        if (sortConfig.key === key && sortConfig.direction === "asc") {
            direction = "desc";
        }
        setSortConfig({ key, direction });
    };

    // arrow indicator
    const getSortIndicator = (key) => {
        if (sortConfig.key !== key) return null;
        return sortConfig.direction === "asc" ? " ▲" : " ▼";
    };

    return (
        <div className={styles.tableContainer}>
            <h2 className={styles.title}>All-Time Rankings</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={styles.stickyHeader} onClick={() => requestSort("name")}>Player{getSortIndicator("name")}</th>
                        <th onClick={() => requestSort("winPct")}>WIN%{getSortIndicator("winPct")}</th>
                        <th onClick={() => requestSort("wins")}>Wins{getSortIndicator("wins")}</th>
                        <th onClick={() => requestSort("losses")}>Losses{getSortIndicator("losses")}</th>
                        <th onClick={() => requestSort("ties")}>Ties{getSortIndicator("ties")}</th>
                        <th onClick={() => requestSort("totalGames")}>Total Games{getSortIndicator("totalGames")}</th>
                        <th onClick={() => requestSort("PF")}>PF{getSortIndicator("PF")}</th>
                        <th onClick={() => requestSort("PA")}>PA{getSortIndicator("PA")}</th>
                        <th onClick={() => requestSort("PFPG")}>PFPG{getSortIndicator("PFPG")}</th>
                        <th onClick={() => requestSort("PAPG")}>PAPG{getSortIndicator("PAPG")}</th>
                        <th onClick={() => requestSort("regSeasonChamps")}>Reg-Champs{getSortIndicator("regSeasonChamps")}</th>
                        <th onClick={() => requestSort("playoffRounds")}>Playoff Rounds{getSortIndicator("playoffRounds")}</th>
                        <th onClick={() => requestSort("postSeasonChamps")}>Post-Champs{getSortIndicator("postSeasonChamps")}</th>

                    </tr>
                </thead>
                <tbody>
                    {sortedPlayers.map((player, idx) => {
                        return (
                            <tr key={idx}>
                                <td className={styles.stickyColumn}>{player.name}</td>
                                <td>{(player.winPct * 100).toFixed(1)}%</td>
                                <td>{player.wins}</td>
                                <td>{player.losses}</td>
                                <td>{player.ties}</td>
                                <td>{player.totalGames}</td>
                                <td>{player.PF.toFixed(2)}</td>
                                <td>{player.PA.toFixed(2)}</td>
                                <td>{player.PFPG.toFixed(1)}</td>
                                <td>{player.PAPG.toFixed(1)}</td>
                                <td>{player.regSeasonChamps}</td>
                                <td>{player.playoffRounds}</td>
                                <td>{player.postSeasonChamps}</td>
                            </tr>
                    );
                })}
                </tbody>
            </table>
        </div>
    );
}