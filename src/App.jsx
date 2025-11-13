import React, { useState, useMemo } from 'react';
import { Search, Trophy, TrendingUp, TrendingDown, Medal, Edit } from 'lucide-react';

// import custom components
import StatsCard from './components/StatsCard';
import AllTimeTable from './components/AllTimeTable';
import SeasonTable from './components/SeasonTable';
import EditSeasonPage from './components/EditSeasonPage';

// import season data
import data from './data/seasons.json';

/**
 * Root component for Fantasy Football League dashboard.
 * Manages:
 *  - View mode toggling (season vs all-time)
 *  - Season Selection
 *  - Search Functionality
 *  - Team filtering by state
 *  - Stats calculation
 */

export default function App() {
  // ======================================
  // STATE MANAGEMENT
  // ======================================

  /**
   * View Mode state - determines which table to display
   * Options: "season" | "allTime"
   */
  const [viewMode, setViewMode] = useState("season");

  /**
   * Search query state - filters players/teams by name
   */
  const [searchQuery, setSearchQuery] = useState("");

  /**
   * Filter State - controls which team states are visible
   * Each key corresponds to a team's "state properly in the JSON data"
   */
  const [filters, setFilters] = useState({
    active: true, // teams with owners who are currently in the league
    inactive: false, // team with owners who are no longer in the league
    jake2020: true, // teams from 2020
    botted: false, // teams with no owner
  });

  /**
   * Filter menu visibility state
   */
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  /**
   * Selected year state - controls which season is displayed in season view
   * Defaults to the most recent year
   */
  const years = Object.keys(data).map(Number).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState(years[0]);

  // ======================================
  // HELPER FUNCTIONS
  // ======================================

  /**
   * Filters teams based on the current filter state
   * @param {Array} seasonData - Array of team objects for a given season
   * @return {Array} Filtered array of teams
   */
  const filterTeams = (seasonData) => {
    let teams = seasonData;

    if (!Array.isArray(seasonData)) {
      teams = seasonData?.standings || seasonData?.teams || [];
    }

    return teams.filter((team) => filters[team.state]);
  };

  /**
   * Toggles a specific filter on/off
   * @param {string} stateKey - The filter key to toggle (e.g., "active", "inactive")
   */
  const toggleFilter = (stateKey) => {
    setFilters((prev) => ({...prev, [stateKey]: !prev[stateKey] }));
  };

  // ======================================
  // COMPUTED VALUES
  // ======================================

  /**
   * Calculate statistics for the currently selected season
   * Memoized to avoid recalculation on every render
   */
  const currentSeasonStats = useMemo(() => {
    // Handle both old format (array) and new format (object with standings)
     let seasonData = data[selectedYear];

    // if it's the new format, use standings array
    if (seasonData && !Array.isArray(seasonData)) {
      seasonData = seasonData.standings || seasonData.teams || [];
    }

    // fallback to empty array if nothing is found
    const season = Array.isArray(seasonData) ? seasonData : [];

    // Calculate total games across all teams
    const totalGames = season.reduce(
      (sum, team) => sum + (team.wins + team.losses + (team.ties || 0 )),
      0
    );

    const totalPF = season.reduce((sum, team) => sum + (team.pf || 0), 0);
    // unused const totalPA = season.reduce((sum, team) => sum + (team.pa || 0), 0);

    // Calculate league PFPG and PAPG
    const leaguePFPG = totalGames > 0 ? totalPF / totalGames : 0;
    // unused const leaguePAPG = totalGames > 0 ? totalPA / totalGames : 0;

    return {
      totalGames,
      leaguePFPG,
      teams: season.length
    };
  }, [selectedYear]);

  if (viewMode === "editSeason") {
    return <EditSeasonPage selectedYear={selectedYear} onBack={() => setViewMode("season")} />;
  }

  // ======================================
  // RENDER
  // ======================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      
      {/* ====================================== */}
      {/* HEADER SECTION */}
      {/* ====================================== */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2">Fantasy Football League</h1>
              <p className="text-indigo-100">Performance Analytics & Rankings</p>
            </div>
            <Trophy className="w-16 h-16 text-yellow-300" />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* ====================================== */}
        {/* STATS CARDS - Only visible in season view */}
        {/* ====================================== */}
        {viewMode === "season" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <StatsCard
              title="Total Games Played"
              value={currentSeasonStats.totalGames}
              icon={TrendingDown}
            />
            <StatsCard
              title="League PFPG"
              value={currentSeasonStats.leaguePFPG.toFixed(1)}
              icon={TrendingUp}
            />
            <StatsCard 
              title="Teams in League"
              value={currentSeasonStats.teams}
              icon={Trophy}
            />
          </div>
        )}

        {/* ====================================== */}
        {/*  CONTROLS SECTION */}
        {/* ====================================== */}       
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">

            {/* View Mode Toggle Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setViewMode("season")}
                  className={`px-6 py-2.5 rounded-lg font-semibold transition-all ${
                  viewMode === "season"
                    ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg scale-105"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Season View
                </button>
                <button
                  onClick={() => setViewMode("allTime")}
                  className={`px-6 py-2.5 rounded-lg font-semibold transition-all ${
                    viewMode === "allTime"
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg scale-105"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  All-Time Rankings
                </button>
              </div>

              {/* Search Input */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input 
                  type="text"
                  placeholder="Search players or teams..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* Filter Dropdown */}
              <div className="relative">
                <button 
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="px-4 py-2.5 rounded-lg bg-gray-100 border border-gray-300 hover:bg-gray-200 transition-colors font-medium"
                >
                  Filters {showFilterMenu ? "▲" : "▼"}
                </button>

                {/* Filter Menu Dropdown Panel */}
                {showFilterMenu && (
                  <div className="absolute right-0 top-12 bg-white border border-gray-300 rounded-lg p-4 shadow-xl w-56 z-20">
                    <h4 className="font-semibold mb-3 text-gray-900">Filter Teams</h4>
                    {Object.keys(filters).map((stateKey) => (
                      <label
                        key={stateKey}
                        className="flex items-center mb-2 text-gray-700 hover:bg-gray-50 p-2 rounded cursor-pointer"
                      >
                        <input 
                          type="checkbox"
                          checked={filters[stateKey]}
                          onChange={() => toggleFilter(stateKey)}
                          className="mr-3 w-4 h-4 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
                        />
                        <span className="capitalize">{stateKey}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
          </div>

          {/* Year Selector + Edit Button - Only visible in season view */}
          {viewMode === "season" && (
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="font-semibold text-gray-700">Season:</label>
                <select 
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-medium"
                >
                  {years.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              {/* Edit Season Button */}
              <button 
                onClick={() => setViewMode("editSeason")}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-md"
              >
                <Edit className="w-5 h-5" />
                Edit Season
              </button>
            </div>
          )}
        </div> 

        {/* ====================================== */}
        {/*  TABLE SECTION */}
        {/* ====================================== */}  
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          
          {/* Table Header */}
          <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
            <h2 className="text-2xl font-bold text-gray-900">
              {viewMode === "season"
                ? `${selectedYear} Season Rankings`
                : "All-Time Player Rankings"}
            </h2>
            <p className="text-gray-600 mt-1">
              {viewMode === "season"
                ? "Current season standings and statistics"
                : "Career statistics across all seasons"}
            </p>
          </div>

          {/* Table Content - Conditionally renders based on view mode */}
          <div className="overflow-x-auto">
            {viewMode === "season" ? (
              // Season View - shows single season rankings
              <SeasonTable 
              seasonData={filterTeams(data[selectedYear] || [])}
              year={selectedYear}
              searchQuery={searchQuery}
              />
            ) : (
              // All-Time View - Shows aggregated career statistics
              <AllTimeTable 
                allData={Object.fromEntries(
                  Object.entries(data).map(([year, teams]) => [
                    year,
                    filterTeams(teams)
                  ])
                )}
                searchQuery={searchQuery}
              />
            )}
          </div>
        </div>

        {/* ====================================== */}
        {/* LEGEND SECTION */}
        {/* ====================================== */}
        <div className="mt-6 bg-white rounded-lg shadow-md p-4">
          <h3 className="font-semibold text-gray-900 mb-2">Legend</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-700">
            <div><strong>PFPG:</strong> Points For Per Game</div>
            <div><strong>PAPG:</strong> Points Against Per Game</div>
            <div><strong>RS:</strong> Regular Season Champion</div>
            <div><strong>Rounds:</strong> Playoff Rounds</div>
            <div><strong>PO:</strong> Playoff Champion</div>            
            <div><strong>GP:</strong> Games Played</div>
            <div><strong>Δ:</strong> Rank Change</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// /** EditSeasonPage Component (inline)
//  * PLACEHOLDER: MOVE INTO ANOTHER FILE
//  */
// function EditSeasonPageSimple({ selectedYear, onBack }) {
//   const [weeks, setWeeks] = useState({});
//   const [loading, setLoading] = useState(true);

//   React.useEffect(() => {
//     fetch(`http://localhost:5000/api/seasons/${selectedYear}/weeks`)
//       .then(res => res.json())
//       .then(data => {
//         setWeeks(data.weeks || {});
//         setLoading(false);
//       })
//       .catch(err => {
//         console.error('Failed to load:', err);
//         setLoading(false);
//       });
//   }, [selectedYear]);

//   return (
//     <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
//       <div className="max-w-4xl mx-auto">
//         <button
//           onClick={onBack}
//           className="mb-6 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
//         >
//           ← Back to Dashboard
//         </button>
      
//         <h1 className="text-3xl font-bold mb-6">Edit {selectedYear} Season</h1>
      
//         {loading ? (
//           <p>Loading...</p>
//         ) : (
//           <div className="bg-white rounded-lg shadow-md p-6">
//             <p className="text-gray-700">
//               Found {Object.keys(weeks).length} weeks of data
//             </p>
//             <p className="text-sm text-gray-500 mt-2">
//               Full edit interface coming soon! This is a placeholder.
//             </p>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// }