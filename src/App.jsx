import React, { useState } from "react";
import data from "./data/seasons.json"
import SeasonDropdown from "./components/SeasonDropdown";
import SeasonTable from "./components/SeasonTable";
import AllTimeTable from "./components/AllTimeTable";

function App() {
    const [viewMode, setViewMode] = useState("season");
    const [showSpecial, setShowSpecial] = useState(true);
    
    const years = Object.keys(data).map(Number).sort((a,b) => b - a);
    const [selectedYear, setSelectedYear] = useState(years[0]);

    // filter function based on team state
    const filterTeams = (seasonData) => {
        return seasonData.filter(team =>
            team.state === "active" || (showSpecial && (team.state === "inactive" || team.state === "jake2020"))
            );
    }

    return (
        <div style={{ padding: "2rem" }}>
            <h1>The Fan Club</h1>

            {/* Toggle Button */}
            <div style={{ marginBottom: "1rem" }}>
                <button
                    onClick={() => setViewMode("season")}
                    disabled={viewMode === "season"}
                    style={{ marginright: "1rem", padding: "0.5rem 1rem" }}
                >
                    Season Rankings
                </button>
                <button
                    onClick={() => setViewMode("allTime")}
                    disabled={viewMode === "allTime"}
                    style={{ padding: "0.5rem 1rem" }}
                >
                    All-Time Rankings
                </button>
            </div>

            {/* Show/Hide inactive + jake2020 states */}
            <div style={{ marginBottom: "1rem" }}>
                <label>
                    <input
                        type="checkbox"
                        checked={showSpecial}
                        onChange={() => setShowSpecial(!showSpecial)}
                    />{" "}
                    Show inactive & jake2020 teams
                </label>
            </div>

            {/* Conditional Rendering */}
            {viewMode === "season" ? (
                <>
                    <SeasonDropdown
                        years={years}
                        selectedYear={selectedYear}
                        onChange={setSelectedYear}
                    />
                    <SeasonTable
                        seasonData={filterTeams(data[selectedYear])}
                        year={selectedYear}
                    />
                </>
            ) : (
                <AllTimeTable
                    allData={Object.fromEntries(
                        Object.entries(data).map(([year, season]) => [year, filterTeams(season)])
                    )} 
                />
            )}
        </div>
    );
}

export default App;