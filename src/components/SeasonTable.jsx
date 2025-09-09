import React from "react";

export default function SeasonTable({ seasonData, year }) {
    if (!seasonData) return null;
    

    // copy and sort data by descending win percentage
    const sorteddata = [...seasonData].sort((a,b) => {
        const totalA = a.wins + a.losses + (a.ties || 0);
        const totalB = b.wins + b.losses + (b.ties || 0);

        const winPctA = totalA ? a.wins + 0.5 * (a.ties || 0) : 0;
        const winPctB = totalB ? b.wins + 0.5 * (b.ties || 0) : 0;

        return (winPctB / totalB) - (winPctA / totalA);
    });


    return (
        <div>
            <h2>Season {year}</h2>
            <table border="1" cellPadding="8">
                <thead>
                    <tr>
                        <th>Team</th>
                        <th>WIN%</th>
                        <th>Wins</th>
                        <th>Losses</th>
                        {/* Show Tie Column only for 2024 */}
                        {year === "2024" && <th>Ties</th>}
                        <th>PF</th>
                        <th>PA</th>
                        <th>Name</th>
                    </tr>
                </thead>
                <tbody>
                    {sorteddata.map((row, idx) => {
                        const totalGames = row.wins + row.losses + (row.ties || 0);
                        const winPct = totalGames
                          ?  (((row.wins + 0.5 * (row.ties || 0)) / totalGames) * 100).toFixed(1) + "%"
                          : "-";

                        return (
                            <tr key={idx}>
                                <td>{row.team}</td>
                                <td>{winPct}</td>
                                <td>{row.wins}</td>
                                <td>{row.losses}</td>
                                {/* Show Tie column only for 2024 */}
                                {year === "2024" && <td>{row.ties || 0}</td>}
                                <td>{row.pf}</td>
                                <td>{row.pa}</td>
                                <td>{row.name}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}