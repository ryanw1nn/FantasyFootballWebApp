import React, { useState } from "react";
import styles from "./Table.module.css";

export default function SeasonTable({ seasonData, year }) {
  const [sortConfig, setSortConfig] = useState({ key: "winPct", direction: "desc" });

  if (!seasonData) return null;

  // prepare data with computed fields
  const preparedData = seasonData.map((row) => {
    const totalGames = row.wins + row.losses + (row.ties || 0);
    const winPct = totalGames ? (row.wins + 0.5 * (row.ties || 0)) / totalGames : 0;
    const PFPG = totalGames ? row.pf / totalGames : 0;
    const PAPG = totalGames ? row.pa / totalGames : 0;
    return { ...row, totalGames, winPct, PFPG, PAPG };
  });

  // sorting data
  const sortedData = [...preparedData].sort((a, b) => {
    if (!sortConfig.key) return 0;
    let aValue = a[sortConfig.key];
    let bValue = b[sortConfig.key];

    if (typeof aValue === "string") aValue = aValue.toLowerCase();
    if (typeof bValue === "string") bValue = bValue.toLowerCase();

    if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;

    let aPF = a.PF ?? 0;
    let bPF = b.PF ?? 0;
    if (aPF < bPF) return 1;
    if (aPF > bPF) return -1;

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

  const emojiRank = {
    "🥇": 1, // gold
    "🥈": 2, // silver
    "🥉": 3, // bronze
    "✨": 4, // playoff
    "💩": 5, // poop
  }

  return (
    <div>
      <h2>Season {year}</h2>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th onClick={() => requestSort("place")}>Place{getSortIndicator("place")}</th>
              <th onClick={() => requestSort("team")}>Team{getSortIndicator("team")}</th>
              <th onClick={() => requestSort("winPct")}>WIN%{getSortIndicator("winPct")}</th>
              <th onClick={() => requestSort("wins")}>Wins{getSortIndicator("wins")}</th>
              <th onClick={() => requestSort("losses")}>Losses{getSortIndicator("losses")}</th>
              {year === "2024" && (
                <th onClick={() => requestSort("ties")}>Ties{getSortIndicator("ties")}</th>
              )}
              <th onClick={() => requestSort("pf")}>PF{getSortIndicator("pf")}</th>
              <th onClick={() => requestSort("pa")}>PA{getSortIndicator("pa")}</th>
              <th onClick={() => requestSort("PFPG")}>PFPG{getSortIndicator("PFPG")}</th>
              <th onClick={() => requestSort("PAPG")}>PAPG{getSortIndicator("PAPG")}</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, idx) => {
              const totalGames = row.wins + row.losses + (row.ties || 0);
              const winPct = totalGames
                ? (((row.wins + 0.5 * (row.ties || 0)) / totalGames) * 100).toFixed(1) + "%"
                : "-";
              const pfpg = totalGames ? (row.pf / totalGames).toFixed(1) : "-";
              const papg = totalGames ? (row.pa / totalGames).toFixed(1) : "-";

              return (
                <tr key={idx}>
                  <td className="placementEmoji">{row.place || ""}</td>
                  <td>{row.team}</td>
                  <td>{winPct}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  {year === "2024" && <td>{row.ties}</td>}
                  <td>{row.pf}</td>
                  <td>{row.pa}</td>
                  <td>{pfpg}</td>
                  <td>{papg}</td>
                  <td>{row.name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
