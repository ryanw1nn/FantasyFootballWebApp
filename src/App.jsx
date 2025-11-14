import React, { useState, useMemo } from 'react';
import { Search, Trophy, TrendingUp, Medal, Edit } from 'lucide-react';

// Import custom components
import StatsCard from './components/StatsCard';
import AllTimeTable from './components/AllTimeTable';
import SeasonTable from './components/SeasonTable';
import EditSeasonPage from './components/EditSeasonPage';

// Import season data
import data from './data/seasons.json';

/**
 * Root component for Fantasy Football League dashboard.
 */
export default function App() {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const [viewMode, setViewMode] = useState("season");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    active: true,
    inactive: false,
    jake2020: true,
    botted: false,
  });
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  
  const years = Object.keys(data).map(Number).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState(years[0]);
  
  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  
  const getSeasonArray = (year) => {
    const seasonData = data[year];
    if (Array.isArray(seasonData)) return seasonData;
    if (seasonData?.standings && Array.isArray(seasonData.standings)) return seasonData.standings;
    if (seasonData?.teams && Array.isArray(seasonData.teams)) return seasonData.teams;
    return [];
  };
  
  const filterTeams = (teamsArray) => {
    if (!Array.isArray(teamsArray)) return [];
    return teamsArray.filter((team) => filters[team.state]);
  };
  
  const toggleFilter = (stateKey) => {
    setFilters((prev) => ({...prev, [stateKey]: !prev[stateKey] }));
  };
  
  // ============================================
  // COMPUTED VALUES
  // ============================================
  
  const currentSeasonStats = useMemo(() => {
    const season = getSeasonArray(selectedYear);
    
    const totalGames = season.reduce(
      (sum, team) => sum + ((team.wins || 0) + (team.losses || 0) + (team.ties || 0)),
      0
    );
    
    const avgPF = season.length > 0
      ? season.reduce((sum, team) => sum + (team.pf || 0), 0) / season.length
      : 0;
    
    return {
      totalGames,
      avgPF,
      teams: season.length
    };
  }, [selectedYear]);
  
  // ============================================
  // EDIT SEASON VIEW
  // ============================================
  
  if (viewMode === "editSeason") {
    return <EditSeasonPage selectedYear={selectedYear} onBack={() => setViewMode("season")} />;
  }
  
  // ============================================
  // MAIN DASHBOARD RENDER
  // ============================================
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      
      {/* Header */}
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
        
        {/* Stats Cards - Only in season view */}
        {viewMode === "season" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <StatsCard
              title="Total Games Played"
              value={currentSeasonStats.totalGames}
              icon={Medal}
            />
            <StatsCard
              title="Avg Points Per Team"
              value={currentSeasonStats.avgPF.toFixed(1)}
              icon={TrendingUp}
            />
            <StatsCard 
              title="Teams in League"
              value={currentSeasonStats.teams}
              icon={Trophy}
            />
          </div>
        )}

        {/* Controls Section */}       
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

          {/* Year Selector + Edit Button - Only in season view */}
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

        {/* Table Section */}  
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          
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

          <div className="overflow-auto max-h-[600px]">
            {viewMode === "season" ? (
              <SeasonTable 
                seasonData={filterTeams(getSeasonArray(selectedYear))}
                year={selectedYear}
                searchQuery={searchQuery}
              />
            ) : (
              <AllTimeTable 
                allData={Object.fromEntries(
                  Object.entries(data).map(([year, seasonData]) => [
                    year,
                    filterTeams(getSeasonArray(year))
                  ])
                )}
                searchQuery={searchQuery}
              />
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-6 bg-white rounded-lg shadow-md p-4">
          <h3 className="font-semibold text-gray-900 mb-2">Legend</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-700">
            <div><strong>PFPG:</strong> Points For Per Game</div>
            <div><strong>PAPG:</strong> Points Against Per Game</div>
            <div><strong>🏆:</strong> Playoff Champion</div>
            <div><strong>👑:</strong> Regular Season Champion</div>
            <div><strong>GP:</strong> Games Played</div>
            <div><strong>Δ:</strong> Rank Change</div>
          </div>
        </div>
      </div>
    </div>
  );
}