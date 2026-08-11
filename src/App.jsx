import React, { useState, useMemo, useEffect } from 'react';
import { Trophy, TrendingUp, Medal, Edit, SlidersHorizontal } from 'lucide-react';

// Import custom components
import StatsCard from './components/StatsCard';
import AllTimeTable from './components/AllTimeTable';
import SeasonTable from './components/SeasonTable';
import EditSeasonPage from './components/EditSeasonPage';
import PlayoffBracket from './components/PlayoffBracket';
import PlayerStatsPage from './components/PlayerStatsPage';
import Button from './components/ui/Button';
import ColumnMenu from './components/ui/ColumnMenu';
import useColumnVisibility from './hooks/useColumnVisibility';
import { SEASON_COLUMNS, ALLTIME_COLUMNS } from './components/tableColumns';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * Root component for Fantasy Football League dashboard.
 */
export default function App() {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const [viewMode, setViewMode] = useState("season");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [filters, setFilters] = useState({
    active: true,
    inactive: false,
    jake2020: true,
    botted: false,
  });
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [seasonCols, toggleSeasonCol] = useColumnVisibility('ff_season_table_columns', SEASON_COLUMNS);
  const [alltimeCols, toggleAlltimeCol] = useColumnVisibility('ff_alltime_table_columns', ALLTIME_COLUMNS);
  
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

  /**
   * Handles player name click - navigates to player stats view
   */
  const handlePlayerClick = (playerName) => {
    setSelectedPlayer(playerName);
    setViewMode("playerStats");
  };

  /**
   * Handles back button from player stats - returns to previous view
   */
  const handleBackFromPlayerStats = () => {
    setSelectedPlayer(null);
    setViewMode("alltime");
  }
  
  
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
  // RENDER: PLAYER STATS MODE
  // ============================================

  if (viewMode === "playerStats" && selectedPlayer) {
    return (
      <PlayerStatsPage 
        playerName={selectedPlayer} 
        allData={data} 
        onBack={handleBackFromPlayerStats} 
      />
    );
  }

  // ============================================
  // RENDER: BRACKET MODE
  // ============================================

  if (viewMode === "bracket") {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="max-w-7xl mx-auto p-6">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <Trophy className="text-accent-600" size={28}/>
            <h1 className="text-2xl font-bold text-slate-900">The Fan Club</h1>
          </div>

          {/* Controls Section */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
            <div className="flex flex-wrap gap-3 items-center justify-between">

              {/* View Mode Toggle */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setViewMode("season")}>Season</Button>
                <Button variant="outline" onClick={() => setViewMode("alltime")}>All-Time</Button>
                <Button variant="solid" onClick={() => setViewMode("bracket")}>Playoff Bracket</Button>
                <Button variant="ghost" onClick={() => setViewMode("edit")}>
                  <Edit size={16} />
                  Edit Season Data
                </Button>
              </div>

              {/* Year Selector */}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year} Season
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bracket Content */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <PlayoffBracket year={selectedYear} />
          </div>
        </div>
      </div>
    );
  }
  
  // ============================================
  // RENDER: LOADING STATE
  // ============================================

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading season data...</p>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: MAIN DASHBOARD
  // ============================================
  
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-7xl mx-auto p-6">

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Trophy className="text-accent-600" size={28}/>
        <h1 className="text-2xl font-bold text-slate-900">The Fan Club</h1>
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
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-center justify-between">

          {/* View Mode Toggle  */}
          <div className="flex gap-2">
            <Button
              variant={viewMode === "season" ? "solid" : "outline"}
              onClick={() => setViewMode("season")}
            >
              Season
            </Button>
            <Button
              variant={viewMode === "alltime" ? "solid" : "outline"}
              onClick={() => setViewMode("alltime")}
            >
              All-Time
            </Button>
            <Button variant="outline" onClick={() => setViewMode("bracket")}>
              Playoff Bracket
            </Button>
            <Button variant="ghost" onClick={() => setViewMode("edit")}>
              <Edit size={16} />
              Edit Season Data
            </Button>
          </div>

          {/* Year Selector (Season view only) */}
          {viewMode === "season" && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year} Season
                </option>
              ))}
            </select>
          )}

          {/* Filter Button */}
          <div className="relative">
            <button
              onClick={() =>setShowFilterMenu(!showFilterMenu)}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm font-medium text-slate-700"
            >
              <SlidersHorizontal size={16} />
              Filters
            </button>

            {showFilterMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 p-3 z-50">
                <h3 className="font-semibold text-slate-900 mb-2 text-sm">Team States</h3>
                {Object.entries(filters).map(([key, value]) => (
                  <label key={key} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() => toggleFilter(key)}
                      className="rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                    />
                      <span className="text-sm text-slate-700 capitalize">{key}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {viewMode === "season"
                ? `${selectedYear} Season Rankings`
                : "All-Time Player Rankings"}
            </h2>
            <p className="text-slate-500 text-sm mt-0.5">
              {viewMode === "season"
                ? "Current season standings and statistics"
                : "Career statistics across all seasons"}
            </p>
          </div>

          {viewMode === "season" ? (
            <ColumnMenu columns={SEASON_COLUMNS} visible={seasonCols} onToggle={toggleSeasonCol} />
          ) : (
            <ColumnMenu columns={ALLTIME_COLUMNS} visible={alltimeCols} onToggle={toggleAlltimeCol} />
          )}
        </div>

        <div className="overflow-auto max-h-[800px]">
          {viewMode === "season" ? (
            <SeasonTable
              seasonData={filterTeams(getSeasonArray(selectedYear))}
              year={selectedYear}
              onPlayerClick={handlePlayerClick}
              visibleColumns={seasonCols}
            />
          ) : (
            <AllTimeTable
              allData={Object.fromEntries(
                Object.entries(data).map(([year, seasonData]) => [
                  year,
                  filterTeams(getSeasonArray(year))
                ])
              )}
              onPlayerClick={handlePlayerClick}
              visibleColumns={alltimeCols}
            />
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900 mb-2 text-sm">Legend</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-slate-600">
          <div><strong className="text-slate-900">PFPG:</strong> Points For Per Game</div>
          <div><strong className="text-slate-900">PAPG:</strong> Points Against Per Game</div>
          <div><strong className="text-slate-900">PO:</strong> Playoff Champion</div>
          <div><strong className="text-slate-900">RS:</strong> Regular Season Champion</div>
          <div><strong className="text-slate-900">GP:</strong> Games Played</div>
          <div><strong className="text-slate-900">Δ:</strong> Rank Change</div>
        </div>
      </div>
    </div>
  </div>
  );
}

