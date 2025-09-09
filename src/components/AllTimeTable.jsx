import React from "react";

export default function AllTimeTable({ allData }) {

    // aggregate data by player name
    const allTimeStats = {};

    Object.values(allData).forEach((season) => {
        season.forEach((row) => {
            const name = row.name;
            if(!allTimeStats[name]) {
                allTimeStats[name] = { wins: 0, losses: 0, ties: 0, PF: 0, PA: 0 };
            }

            allTimeStats[name].wins += row.wins || 0;
            allTimeStats[name].losses += row.losses || 0;
            allTimeStats[name].ties += row.ties || 0;
            allTimeStats[name].PF += row.pf || 0;
            allTimeStats[name].PA += row.pa || 0;

        });
    });

    // convert to array and sort by WIN% descending
    const sortedPlayers = Object.entries(allTimeStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a,b) => {
            const totalA = a.wins + a.losses + a.ties;
            const totalB = b.wins + b.losses + b.ties;
            const winPctA = totalA ? a.wins / totalA : 0;
            const winPctB = totalB ? b.wins / totalB : 0;
            return winPctB - winPctA;
        });

    return (
        <div>
            <h2>All-Time Rankings</h2>
            <table border="1" cellPadding="8">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>WIN%</th>
                        <th>Wins</th>
                        <th>Losses</th>
                        <th>Ties</th>
                        <th>Total Games</th>
                        <th>PF</th>
                        <th>PA</th>
                        <th>Points Diff</th>
                    </tr>
                </thead>
                <tbody>
                    {sortedPlayers.map((player, idx) => {
                        const totalGames = player.wins + player.losses + player.ties;
                        const winPct = totalGames
                        ? ((player.wins / totalGames) * 100).toFixed(1) + "%"
                        : "-";
                        const pointDiff = player.PF - player.PA;
                        return (
                            <tr key={idx}>
                                <td>{player.name}</td>
                                <td>{winPct}</td>
                                <td>{player.wins}</td>
                                <td>{player.losses}</td>
                                <td>{player.ties}</td>
                                <td>{totalGames}</td>
                                <td>{player.PF.toFixed(2)}</td>
                                <td>{player.PA.toFixed(2)}</td>
                                <td>{pointDiff.toFixed(2)}</td>
                            </tr>
                    );
                })}
                </tbody>
            </table>
        </div>
    );
}