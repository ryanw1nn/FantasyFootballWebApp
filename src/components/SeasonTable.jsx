import React, { useState, useMemo } from "react";
import styles from "./Table.module.css";

export default function SeasonTable({ seasonData, year }) {
  const [sortConfig, setSortConfig] = useState({ key: "winPct", direction: "desc" });

  if (!seasonData) return null;

  // emoji mapping (used when "place" is an emoji)
  const emojiRank = {
    "🥇": 1,
    "🥈": 2,
    "🥉": 3,
    "✨": 4,
    "💩": 5,
  };

  // Prepare data once (coerce numeric fields to numbers and add original index for stable sort)
  const preparedData = useMemo(
    () =>
      seasonData.map((row, i) => {
        const wins = Number(row.wins) || 0;
        const losses = Number(row.losses) || 0;
        const ties = Number(row.ties) || 0;
        const pf = Number(row.pf) || 0;
        const pa = Number(row.pa) || 0;
        const totalGames = wins + losses + ties;
        const winPct = totalGames ? (wins + 0.5 * ties) / totalGames : 0;
        const PFPG = totalGames ? pf / totalGames : 0;
        const PAPG = totalGames ? pa / totalGames : 0;
        
        const change = 
          row.prevPlace != null && row.place != null
            ? row.prevPlace - row.place
            : 0;

        return {
          ...row,
          wins,
          losses,
          ties,
          pf,
          pa,
          totalGames,
          winPct,
          PFPG,
          PAPG,
          change,
          _idx: i, // preserve original index for stable sorting
        };
      }),
    [seasonData]
  );

  // Robust comparator + tie-breakers
  const sortedData = useMemo(() => {
    const EPSILON = 1e-6;
    const numericLikeRegex = /^[+-]?\d[\d,]*\.?\d*%?$/;

    const normalize = (obj, key) => {
      // guard
      if (obj == null) return null;
      const raw = obj[key];

      if (raw == null) return null;

      // special case: place emojis
      if (key === "place") {
        if (typeof raw === "string" && emojiRank[raw]) return emojiRank[raw];
        // if it's a number-like string or number, fall through to numeric handling
      }

      // if it's already a number, return it
      if (typeof raw === "number") return raw;

      // if it's a string that looks numeric (e.g. "10", "66.7%", "1,234"), parse it
      if (typeof raw === "string") {
        const s = raw.trim();
        if (numericLikeRegex.test(s)) {
          // remove commas and optional percent sign, then parse
          const num = Number(s.replace(/,/g, "").replace("%", ""));
          if (!isNaN(num)) return num;
        }
        // fallback: case-insensitive string for comparisons
        return s.toLowerCase();
      }

      // fallback: return as-is
      return raw;
    };

    const dir = sortConfig.direction === "asc" ? 1 : -1;

    return [...preparedData].sort((a, b) => {
      const key = sortConfig.key;
      if (!key) return 0;

      const aVal = normalize(a, key);
      const bVal = normalize(b, key);

      // both null/undefined -> continue to tie breakers
      if (aVal == null && bVal == null) {
        /* fall through */
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        // numeric comparison with small tolerance for floats
        if (Math.abs(aVal - bVal) > EPSILON) {
          return (aVal < bVal ? -1 : 1) * dir;
        }
      } else {
        // string comparison (localeCompare with numeric option)
        const sa = String(aVal ?? "");
        const sb = String(bVal ?? "");
        const cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
        if (cmp !== 0) return cmp * dir;
      }

      // === tie-breakers (apply when primary key considered equal) ===
      // 1) PF (points for) -- always descending (more PF ranks higher)
      if ((a.pf || 0) !== (b.pf || 0)) return a.pf > b.pf ? -1 : 1;

      // 2) PA (points against) -- ascending (lower PA better)
      if ((a.pa || 0) !== (b.pa || 0)) return (a.pa || 0) < (b.pa || 0) ? -1 : 1;

      // 3) team name (alphabetical)
      const teamCmp = String(a.team ?? "").localeCompare(String(b.team ?? ""), undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (teamCmp !== 0) return teamCmp;

      // 4) stable fallback by original index
      return (a._idx || 0) - (b._idx || 0);
    });
  }, [preparedData, sortConfig]);

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
    <div>
      <h2>Season {year}</h2>
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th onClick={() => requestSort("place")}>Place{getSortIndicator("place")}</th>
              <th>Change</th>
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
              const totalGames = row.totalGames;
              const winPctDisplay = totalGames
                ? (((row.wins + 0.5 * (row.ties || 0)) / totalGames) * 100).toFixed(1) + "%"
                : "-";
              const pfpg = totalGames ? (row.pf / totalGames).toFixed(1) : "-";
              const papg = totalGames ? (row.pa / totalGames).toFixed(1) : "-";

              // highlight rows based on place number
              let rowClass = "";
              if (row.place === 1) rowClass = styles.goldRow;
              else if (row.place === 2) rowClass = styles.silverRow;
              else if (row.place === 3) rowClass = styles.bronzeRow;

              // change
              let changeDisplay = "-";
              let changeStyle = {};

              if (row.change > 0) {
                changeDisplay = `▲ ${row.change}`;
                changeStyle = { color: "green", fontWeight: "bold" };
              } else if (row.change < 0) {
                changeDisplay = `▼ ${Math.abs(row.change)}`;
                changeStyle = { color: "red", fontWeight: "bold" };
              }

              return (
                <tr key={idx} className={rowClass}>
                  <td className="placementEmoji">{row.place || ""}</td>
                  <td style={changeStyle}>{changeDisplay}</td>
                  <td>{row.team}</td>
                  <td>{winPctDisplay}</td>
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
