import React, { useState, useEffect } from 'react';
import { Save, ChevronDown, ChevronRight, ArrowLeft, Users, Trophy, Trash2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * EditSeasonPage Component
 * 
 * Main interface for editing season data week-by-week
 * Allows updating matchup scores and automatically recalculates standings
 */
export default function EditSeasonPage({ onBack }) {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const [selectedYear, setSelectedYear] = useState('2025');
  const [availableYears, setAvailableYears] = useState([]);
  const [weeks, setWeeks] = useState({});
  const [teams, setTeams] = useState([]);
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  
  // ============================================
  // DATA FETCHING
  // ============================================
  
  /**
   * Load available years on mount
   */
  useEffect(() => {
    loadAvailableYears();
  }, []);

  /**
   * Load week data when year changes
   */
  useEffect(() => {
    if (selectedYear) {
      loadSeasonData();
    }
  }, [selectedYear]);

  async function loadAvailableYears() {
    try {
      const response = await fetch(`${API_BASE_URL}/seasons`);
      const data = await response.json();

      // extract years and sort descending (newest first)
      const years = Object.keys(data).sort((a, b) => Number(b) - Number(a));
      setAvailableYears(years);

      // set the most recent year as default if not already set
      if (years.length > 0 && !selectedYear) {
        setSelectedYear(years[0]);
      }
    } catch (err) {
      console.error('Failed to load available years:', err);
      setMessage('⚠️ Failed to load available years');
    }
  }
  
  async function loadSeasonData() {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/seasons/${selectedYear}/weeks`);
      const data = await response.json();
      
      setWeeks(data.weeks || {});
      setTeams(data.teams || []);
      
      // Auto-expand week 1 if no weeks are expanded
      if (!expandedWeek && Object.keys(data.weeks).length > 0) {
        setExpandedWeek('1');
      }
    } catch (err) {
      console.error('Failed to load season data:', err);
      setMessage('⚠️ Failed to load season data');
    } finally {
      setLoading(false);
    }
  }
  
  // ============================================
  // WEEK MANAGEMENT
  // ============================================
  
  /**
   * Toggle week expansion
   */
  function toggleWeek(weekNum) {
    setExpandedWeek(expandedWeek === weekNum ? null : weekNum);
  }

  /**
   * Update a matchup's team assignment
   */
  function updateMatchupTeam(weekNum, matchupIndex, field, value) {
    setWeeks(prev => {
      const newWeeks = { ...prev };
      const week = newWeeks[weekNum];

      if (!week || !week.matchups) return prev;

      const matchups = [...week.matchups];
      matchups[matchupIndex] = {
        ...matchups[matchupIndex],
        [field]: value
      };

      newWeeks[weekNum] = { matchups };
      return newWeeks;
    });
  }
  
  /**
   * Update a single matchup score
   */
  function updateMatchupScore(weekNum, matchupIndex, field, value) {
    setWeeks(prev => {
      const newWeeks = { ...prev };
      const week = newWeeks[weekNum];
      
      if (!week || !week.matchups) return prev;
      
      const matchups = [...week.matchups];
      matchups[matchupIndex] = {
        ...matchups[matchupIndex],
        [field]: value === '' ? null : parseFloat(value)
      };
      
      newWeeks[weekNum] = { matchups };
      return newWeeks;
    });
  }

  /**
   * get available teams for a specific week
   * excludes teams already assigned in that week
   */
  function getAvailableTeams(weekNum, currentMatchupIndex, currentField) {
    const week = weeks[weekNum];
    if (!week || !week.matchups) return teams;

    // get the current value for this field
    const currentMatchup = week.matchups[currentMatchupIndex];
    const currentValue = currentMatchup?.[currentField];

    // Get all teams already assigned in this week
    const assignedTeams = new Set();
    week.matchups.forEach((matchup, idx) => {
      if (idx === currentMatchupIndex) {
        if (currentField === 'team1' && matchup.team2) {
          assignedTeams.add(matchup.team2);
        } else if (currentField === 'team2' && matchup.team1) {
          assignedTeams.add(matchup.team1);
        }
      } else {
        // for other matchups, add both teams
        if (matchup.team1) assignedTeams.add(matchup.team1);
        if (matchup.team2) assignedTeams.add(matchup.team2);
      }
    });

    // return teams that haven't been assigned yet
    return teams.filter(team =>
      !assignedTeams.has(team.name) || team.name === currentValue 
    );
  }

  /**
   * Add a new empty matchup to a week
   */
  function addMatchup(weekNum) {
    setWeeks(prev => {
      const newWeeks = { ...prev };
      const week = newWeeks[weekNum];

      if (!week) return prev;

      const matchups = [...(week.matchups || [])];
      matchups.push({
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null
      });

      newWeeks[weekNum] = { matchups };
      return newWeeks;
    });
  }

  /**
   * Remove a matchup from a week
   */
  function removeMatchup(weekNum, matchupIndex) {
    setWeeks(prev => {
      const newWeeks = { ...prev };
      const week = newWeeks[weekNum];

      if (!week || !week.matchups) return prev;

      const matchups = week.matchups.filter((_, idx) => idx !== matchupIndex);
      newWeeks[weekNum] = { matchups };
      return newWeeks;
    });
  }
  
  /**
   * Save a specific week's data to backend
   */
  async function saveWeek(weekNum) {
    setSaving(true);
    setMessage('');
    
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/seasons/${selectedYear}/weeks/${weekNum}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchups: weeks[weekNum].matchups })
        }
      );
      
      const data = await response.json();
      
      if (data.success) {
        setMessage(`✅ Week ${weekNum} saved! Standings updated.`);
        
        // Clear message after 3 seconds
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage(`❌ Failed to save: ${data.error}`);
      }
    } catch (err) {
      console.error('Failed to save week:', err);
      setMessage('❌ Network error while saving');
    } finally {
      setSaving(false);
    }
  }
  
  // ============================================
  // RENDER HELPERS
  // ============================================

  /**
   * Get week title with special teams for playoff weeks
   */
  function getWeekTitle(weekNum) {
    const num = parseInt(weekNum);
    if (num === 15) return 'Week 15 - Playoff/TB Round 1';
    if (num === 16) return 'Week 16 - Playoff/TB Round 2';
    if (num === 17) return 'Week 17 - Super Bowl Week';
    return `Week ${weekNum}`;
  }

  /**
   * Check if a week is a playoff week
   */
  function isPlayoffWeek(weekNum) {
    const num = parseInt(weekNum);
    return num >= 15 && num <= 17;
  }

  /**
   * Get status badge styling
   */
  function getStatusBadgeClass(status) {
    switch (status) {
      case 'playoff':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'toilet':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'out':
        return 'bg-gray-100 text-gray-600 border-gray-300';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  }

  /**
   * Get status display text
   */
  function getStatusText(status) {
    switch (status) {
      case 'playoff':
        return '🏆 Playoff';
      case 'toilet':
        return '🚽 Toilet Bowl'
      case 'out':
        return '❌ Out';
      default:
        return status;
    }
  }
  
  // ============================================
  // WEEK MANAGEMENT
  // ============================================

  /**
   * Render team selector dropdown
   */
  function renderTeamSelector(weekNum, matchupIndex, field, currentValue) {
    // if the value is BYE, render it as text isntead of dropdowjn
    if (currentValue === 'BYE') {
      return (
        <div className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-100 text-gray-600 font-semibold text-center">
          BYE
        </div>
      );
    }


    const availableTeams = getAvailableTeams(weekNum, matchupIndex, field);

    return (
      <select 
        value={currentValue || ''}
        onChange={(e) => updateMatchupTeam(weekNum, matchupIndex, field, e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
      >
        <option value="">Select team...</option>
        {availableTeams.map(team => (
          <option key={team.name} value={team.name}>
            {team.name}
          </option>
        ))}
      </select>
    );
  }

  /**
   * Render a single matchup editor
   */
  function renderMatchup(weekNum, matchup, index) {
    const hasLabel = matchup.label;
    const hasStatus = matchup.status;
    const isPlayoff = isPlayoffWeek(weekNum);

    return (
      <div 
        key={index} 
        className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3"
      >
        {/* matchup header (for playoff weeks) */}
        {isPlayoff && (hasLabel || hasStatus) && (
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-300">
            {hasLabel && (
              <span className="text-sm font-semibold text-gray-700">
                {matchup.label}
              </span>
            )}
            {hasStatus && (
              <span className={`text-xs px-2 py-1 rounded-full border ${getStatusBadgeClass(matchup.status)}`}>
                {getStatusText(matchup.status)}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-4">
          {/* Team 1 */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team 1
            </label>
            {renderTeamSelector(weekNum, index, 'team1', matchup.team1)}
          </div>

          {/* VS Divider */}
          <div className="text-gray-400 font-bold">VS</div>

          {/* Team 2 */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team 2
            </label>
            {renderTeamSelector(weekNum, index, 'team2', matchup.team2)}
          </div>
        </div>
        
        {/* Scores Row */}
        <div className="flex items-center gap-4">
          {/* Team 1 Score */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Score
            </label>
            <input 
              type="number"
              step="0.1"
              placeholder="0.0"
              value={matchup.team1Score ?? ''}
              onChange={(e) => updateMatchupScore(weekNum, index, 'team1Score', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:rind-2 focus:ring-indigo-500 focus:border-transparent"
              disabled={!matchup.team1 || matchup.team1 === 'BYE'}
            />
          </div>

          {/* Spacer */}
          <div className="w-12"></div>

          {/* Team 2 Score */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Score
            </label>
            <input 
              type="number"
              step="0.1"
              placeholder="0.0"
              value={matchup.team2Score ?? ''}
              onChange={(e) => updateMatchupScore(weekNum, index, 'team2Score', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:rind-2 focus:ring-indigo-500 focus:border-transparent"
              disabled={!matchup.team2 || matchup.team2 === 'BYE'}
            />
          </div>
        </div>

        {/* delete button for regular weeks only */}
        {!isPlayoff && (
          <div className="flex justify-end pt-2">
            <button 
              onClick={() => removeMatchup(weekNum, index)}
              className="text-red-600 hover:text-red-800 text-sm flex items-center gap-1"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }  
 
  // ============================================
  // RENDER
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
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-5xl mx-auto">
        
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={onBack}
            className="mb-4 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center gap-2"
          >
            <ArrowLeft size={18} />
            Back to Dashboard
          </button>
          
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Edit Season Data</h1>
          <p className="text-gray-600">Update matchups and scores week by week</p>
        </div>
        
        {/* Year Selector */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Season
          </label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
          >
            {availableYears.length === 0 && (
              <option value="">Loading years...</option>
            )}
            {availableYears.map(year => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        
        {/* Success/Error Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.startsWith('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {message}
          </div>
        )}
        
        {/* Weeks List */}
        <div className="space-y-4">
          {Object.keys(weeks).sort((a, b) => Number(a) - Number(b)).map(weekNum => {
            const week = weeks[weekNum];
            const isExpanded = expandedWeek === weekNum;
            const isPlayoff = isPlayoffWeek(weekNum);
            
            return (
              <div 
                key={weekNum}
                className={`bg-white rounded-lg shadow-md overflow-hidden 
                ${isPlayoff ? 'border-2 border-indigo-300' : ''}`}
              >
                
                {/* Week Header */}
                <button
                  onClick={() => toggleWeek(weekNum)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    <h3 className="text-lg font-semibold text-gray-900">Week {weekNum}</h3>
                    <span className="text-sm text-gray-500">
                      {week.matchups?.length || 0} matchups
                    </span>
                  </div>
                  
                  <Users size={20} className="text-gray-400" />
                </button>
                
                {/* Week Content */}
                {isExpanded && (
                  <div className="px-6 py-4 border-t border-gray-200 space-y-4">
                    {week.matchups && week.matchups.map((matchup, idx) => 
                      renderMatchup(weekNum, matchup, idx)
                    )}

                    {!isPlayoff && (
                      <button 
                        onClick={() => addMatchup(weekNum)}
                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-indigo-500 hover:text-indigo-600 transition-colors"
                      >
                        + Add Matchup
                      </button>
                    )}
                    
                    {/* Save Button */}
                    <div className="flex justify-end pt-4">
                      <button
                        onClick={() => saveWeek(weekNum)}
                        disabled={saving}
                        className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 transition-colors flex items-center gap-2"
                      >
                        <Save size={18} />
                        {saving ? 'Saving...' : `Save Week ${weekNum}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {/* No weeks message */}
        {Object.keys(weeks).length === 0 && (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <p className="text-gray-600">No weeks found for this season.</p>
          </div>
        )}
      </div>
    </div>
  );
}