import React, { useState } from "react";
import Layout from "./components/Layout";
import data from "./data/seasons.json";
import SeasonDropdown from "./components/SeasonDropdown";
import SeasonTable from "./components/SeasonTable";
import AllTimeTable from "./components/AllTimeTable";

function App() {
  const [viewMode, setViewMode] = useState("season");

  // track visibility of each state
  const [filters, setFilters] = useState({
    active: true,
    inactive: false,
    jake2020: true,
    botted: false,
  });

  // control dropdown visibility
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const years = Object.keys(data).map(Number).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState(years[0]);

  // filter function based on team state
  const filterTeams = (seasonData) => {
    return seasonData.filter((team) => filters[team.state]);
  };

  // toggle a single state flag
  const toggleFilter = (stateKey) => {
    setFilters((prev) => ({
      ...prev,
      [stateKey]: !prev[stateKey],
    }));
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Toggle Button */}
        <div className="flex justify-center gap-4 mb-6">
          <button
            onClick={() => setViewMode("season")}
            disabled={viewMode === "season"}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              viewMode === "season"
                ? "bg-indigo-600 text-white shadow-lg"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Season Rankings
          </button>
          <button
            onClick={() => setViewMode("allTime")}
            disabled={viewMode === "allTime"}
            className={`px-4 py-2 rounded font-semibold transition ${
              viewMode === "allTime"
                ? "bg-indigo-500 text-white shadow-lg"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            All-Time Rankings
          </button>
        </div>

        {/* Filter Menu Dropdown */}
        <div className="relative flex justify-center mb-8">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="px-4 py-2 rounded-lg bg-gray-100 border border-gray-300 hover:bg-gray-200 shadow"
          >
            {showFilterMenu ? "Hide Filters" : "Show Filters"}
          </button>

          {showFilterMenu && (
            <div className="absolute top-12 bg-white border border-gray-300 rounded-lg p-6 shadow-lg w-64">
              <h4 className="text-lg font-semibold mb-3">Filter Teams</h4>
              {Object.keys(filters).map((stateKey) => (
                <label key={stateKey} className="block mb-2 text-gray-700">
                  <input
                    type="checkbox"
                    checked={filters[stateKey]}
                    onChange={() => toggleFilter(stateKey)}
                    className="mr-2"
                  />{" "}
                  {stateKey}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Conditional Rendering */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          {viewMode === "season" ? (
            <>
              <SeasonDropdown
                years={years}
                selectedYear={selectedYear}
                onChange={setSelectedYear}
              />
              <SeasonTable
                seasonData={filterTeams(data[selectedYear] || [])}
                year={selectedYear}
              />
            </>
          ) : (
            <AllTimeTable
              allData={Object.fromEntries(
                Object.entries(data).map(([year, teams]) => [
                  year,
                  filterTeams(teams),
                ])
              )}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}

export default App;
