import React, { useState, useMemo } from 'react';
import { Trophy, TrendingUp, Medal, SlidersHorizontal } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';

import StatsCard from './StatsCard';
import AllTimeTable from './AllTimeTable';
import SeasonTable from './SeasonTable';
import ColumnMenu from './ui/ColumnMenu';
import useColumnVisibility from '../hooks/useColumnVisibility';
import { SEASON_COLUMNS, ALLTIME_COLUMNS } from './tableColumns';
import { useLeague } from '../context/LeagueContext';
import { playerPath } from '../routes';

/**
 * The season table and the all-time table. Two routes, one component: they
 * share the stats cards, the filters, the column menu and the table shell, and
 * differ only in which table and which heading — so `view` picks those and
 * nothing else.
 */
export default function Dashboard({ view }) {
  const { slug } = useLeague();
  const { seasons: data, year: selectedYear, urlYear, error } = useOutletContext();
  const navigate = useNavigate();
  const isSeason = view === 'season';

  const [filters, setFilters] = useState({
    active: true,
    inactive: false,
    jake2020: true,
    botted: false,
  });
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [seasonCols, toggleSeasonCol] = useColumnVisibility('ff_season_table_columns', SEASON_COLUMNS);
  const [alltimeCols, toggleAlltimeCol] = useColumnVisibility('ff_alltime_table_columns', ALLTIME_COLUMNS);

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

  const handlePlayerClick = (playerName) => {
    navigate(playerPath(slug, playerName, urlYear));
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

  // A league with no seasons used to print "null Season Rankings" — the year
  // interpolated before any season had arrived to set it.
  let heading = 'All-Time Player Rankings';
  let subheading = 'Career statistics across all seasons';
  if (isSeason && selectedYear === null) {
    heading = 'No seasons to show';
    subheading = error
      ? "This league's seasons could not be loaded."
      : 'This league has no season data yet.';
  } else if (isSeason) {
    heading = `${selectedYear} Season Rankings`;
    subheading = 'Current season standings and statistics';
  }

  // ============================================
  // RENDER
  // ============================================

  return (
    <>
      {/* Stats Cards */}
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

      {/* Table Section */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{heading}</h2>
            <p className="text-slate-500 text-sm mt-0.5">{subheading}</p>
          </div>

          <div className="flex items-start gap-2">
            {/* The filters are about the table, not the page, so they stayed
                here when the view buttons moved up to the shared toolbar. */}
            <div className="relative">
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
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

            {isSeason ? (
              <ColumnMenu columns={SEASON_COLUMNS} visible={seasonCols} onToggle={toggleSeasonCol} />
            ) : (
              <ColumnMenu columns={ALLTIME_COLUMNS} visible={alltimeCols} onToggle={toggleAlltimeCol} />
            )}
          </div>
        </div>

        <div className="overflow-auto max-h-[800px]">
          {isSeason ? (
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
    </>
  );
}
