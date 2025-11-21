import React, { useState, useMemo, useEffect } from 'react';
import { Search, Trophy, TrendingUp, Medal, Edit } from 'lucide-react';

// Import custom components
import StatsCard from './components/StatsCard';
import AllTimeTable from './components/AllTimeTable';
import SeasonTable from './components/SeasonTable';
import EditSeasonPage from './components/EditSeasonPage';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

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
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  
  const years = Object.keys(data).map(Number).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState(years[0] || 2025);
  
  // ============================================
  // DATA FETCHING
  // ============================================

  /**
   * Fetch all seasons data from backend on mount
   */
  useEffect(() => {
    fetchAllSeasons();
  }, []);

  /**
   * Refetch data when returning from edit mode
   */
  useEffect(() => {
    if (viewMode !== 'edit') {
      fetchAllSeasons();
    }
  }, [viewMode]);

  async function fetchAllSeasons() {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/seasons`);
      const seasonsData = await response.json();
      setData(seasonsData);

      // Set initial year if not set
      if (!selectedYear && Object.keys(seasonsData).length > 0) {
        const latestYear = Math.max(...Object.keys(seasonsData).map(Number));
        setSelectedYear(latestYear);
      }
    } catch (err) {
      console.error('Failed to fetch seasons:', err);
    } finally {
      setLoading(false);
    }
  }

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

    const avgPFPG = season.length > 0
      ? season.reduce((sum, team) => {
        const games = (team.wins || 0) + (team.losses || 0) + (team.ties || 0);
        return sum + (games > 0 ? (team.pf || 0) / games : 0);
        }, 0) / season.length
      : 0;

    const activeTeams = season.filter(team => team.state === 'active').length;
    
    return {
      totalGames,
      avgPFPG,
      activeTeams
    };
  }, [selectedYear, data]);
  
  // ============================================
  // RENDER: EDIT MODE
  // ============================================
  
  if (viewMode === "edit") {
    return <EditSeasonPage onBack={() => setViewMode("season")} />;
  }
  
  // ============================================
  // RENDER: LOADING STATE
  // ============================================

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading season data...</p>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: MAIN DASHBOARD
  // ============================================
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-6">
      
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-3">
          <Trophy className="text-yellow-500" size={40}/>
          Fantasy Football League
        </h1>
        <p className="text-gray-600">Track your league's performance across all seasons</p>
      </div>
        
      {/* Stats Cards - Only in season view */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatsCard
          title="Total Games"
          value={currentSeasonStats.totalGames}
          icon={TrendingUp}
          subtitle="This season"
        />
        <StatsCard
          title="Avg PFPG"
          value={currentSeasonStats.avgPFPG.toFixed(1)}
          icon={Medal}
          subtitle="League average"
        />
        <StatsCard 
          title="Active Teams"
          value={currentSeasonStats.activeTeams}
          icon={Trophy}
          subtitle="Currently competing"
        />
      </div>

      {/* Controls Section */}       
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center justify-between">

          {/* View Mode Toggle  */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode("season")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                viewMode === "season"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Season
            </button>
            <button
              onClick={() => setViewMode("alltime")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                viewMode === "alltime"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              All-Time
            </button>
            <button
              onClick={() => setViewMode("edit")}
              className="px-4 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <Edit size={18} />
              Edit Season Data
            </button>
          </div>

          {/* Year Selector (Season view only) */}
          {viewMode === "season" && (
            <select 
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year} Season
                </option>
              ))}
            </select>
          )}

          {/* Search Bar */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" size={20} />
            <input 
              type="text"
              placeholder="Search players or teams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Filter Button */}
          <div className="relative">
            <button
              onClick={() =>setShowFilterMenu(!showFilterMenu)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Filters
            </button>

            {showFilterMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 p-3 z-10">
                <h3 className="font-semibold text-gray-900 mb-2">Team States</h3>
                {Object.entries(filters).map(([key, value]) => (
                  <label key={key} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() => toggleFilter(key)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                      <span className="text-sm text-gray-700 capitalize">{key}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Table Section */}  
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
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

        <div className="overflow-auto max-h-[800px]">
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

