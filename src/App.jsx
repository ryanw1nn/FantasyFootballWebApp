import React, { useState, useMemo } from 'react';
import { Search, Trophy, TrendingUp, Medal } from 'lucide-react';

// import custom components
import StatsCard from './components/StatsCard';
import AllTimeTable from './components/AllTimeTable';
import SeasonTable from './components/SeasonTable';

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
    return seasonData.filter((team) => filters[team.state]);
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
    const season = data[selectedYear] || [];

    // Calculate total games across all teams
    const totalGames = season.reduce(
      (sum, team) => sum + (team.wins + team.losses + (team.ties || 0 )),
      0
    );

    // Calculate average points for per team
    const avgPF = season.length > 0
      ? season.reduce((sum, team) => sum + (team.pf || 0), 0) / season.length
      : 0;

    return {
      totalGames,
      avgPF,
      teams: season.length
    };
  }, [selectedYear]);

  // ======================================
  // RENDER
  // ======================================

  render (
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
      </div>

    </div>
  )

}