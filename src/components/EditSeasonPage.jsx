import React, { useState, useEffect } from 'react';
import { Save, ChevronDown, ChevronRight, ArrowLeft, Users } from 'lucide-react';

/**
 * EditSeasonPage Component
 * 
 * Main interface for editing season data week-by-week
 * Allows updating matchup scores and automatically recalculates standings
 */
export default function EditSeasonPage() {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const [selectedYear, setSelectedYear] = useState('2025');
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
   * Load week data for selected season
   */
  useEffect(() => {
    loadSeasonData();
  }, [selectedYear]);
  
  async function loadSeasonData() {
    setLoading(true);
    try {
                  const response = await fetch(`http://localhost:5001/api/seasons/${selectedYear}/weeks`);
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
   * Save a specific week's data to backend
   */
  async function saveWeek(weekNum) {
    setSaving(true);
    setMessage('');
    
    try {
      const response = await fetch(
        `http://localhost:5000/api/seasons/${selectedYear}/weeks/${weekNum}`,
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
   * Render a single matchup editor
   */
  function renderMatchup(weekNum, matchup, index) {
    return (
      <div 
        key={index} 
        className="flex items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
      >
        {/* Team 1 */}
        <div className="flex-1">
          <div className="font-medium text-gray-900 mb-1">
            {matchup.team1}
          </div>
          <input
            type="number"
            step="0.1"
            placeholder="Score"
            value={matchup.team1Score ?? ''}
            onChange={(e) => updateMatchupScore(weekNum, index, 'team1Score', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        
        {/* VS Divider */}
        <div className="text-gray-400 font-bold">VS</div>
        
        {/* Team 2 */}
        <div className="flex-1">
          <div className="font-medium text-gray-900 mb-1">
            {matchup.team2}
          </div>
          <input
            type="number"
            step="0.1"
            placeholder="Score"
            value={matchup.team2Score ?? ''}
            onChange={(e) => updateMatchupScore(weekNum, index, 'team2Score', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
      </div>
    );
  }
  
  /**
   * Render a single week accordion
   */
  function renderWeek(weekNum) {
    const isExpanded = expandedWeek === weekNum;
    const week = weeks[weekNum];
    
    if (!week) return null;
    
    // Check if week has any scores entered
    const hasScores = week.matchups?.some(m => 
      m.team1Score !== null || m.team2Score !== null
    );
    
    return (
      <div key={weekNum} className="border border-gray-300 rounded-lg overflow-hidden">
        {/* Week Header */}
        <button
          onClick={() => toggleWeek(weekNum)}
          className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-gray-500" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-500" />
            )}
            <span className="font-semibold text-lg text-gray-900">
              Week {weekNum}
            </span>
            {hasScores && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                ✓ Scores Entered
              </span>
            )}
          </div>
          
          <div className="text-sm text-gray-500">
            {week.matchups?.length || 0} matchups
          </div>
        </button>
        
        {/* Week Content (Matchups) */}
        {isExpanded && (
          <div className="p-4 bg-gray-100 border-t border-gray-300">
            <div className="space-y-3 mb-4">
              {week.matchups?.map((matchup, idx) => 
                renderMatchup(weekNum, matchup, idx)
              )}
            </div>
            
            {/* Save Button */}
            <button
              onClick={() => saveWeek(weekNum)}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Saving...' : `Save Week ${weekNum}`}
            </button>
          </div>
        )}
      </div>
    );
  }
  
  // ============================================
  // MAIN RENDER
  // ============================================
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => window.history.back()}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>
              <div>
                <h1 className="text-3xl font-bold">Edit Season</h1>
                <p className="text-indigo-100 mt-1">Update weekly matchup scores</p>
              </div>
            </div>
            
            {/* Year Selector */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-4 py-2 bg-white text-gray-900 rounded-lg font-medium border-2 border-indigo-300 focus:ring-2 focus:ring-white focus:border-white"
            >
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
              <option value="2022">2022</option>
              <option value="2021">2021</option>
              <option value="2020">2020</option>
            </select>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Status Message */}
        {message && (
          <div className={`mb-4 p-4 rounded-lg ${
            message.includes('✅') 
              ? 'bg-green-100 text-green-800 border border-green-300'
              : 'bg-red-100 text-red-800 border border-red-300'
          }`}>
            {message}
          </div>
        )}
        
        {/* Team Count Info */}
        {teams.length > 0 && (
          <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center gap-2 text-gray-700">
              <Users className="w-5 h-5 text-indigo-600" />
              <span className="font-medium">
                {teams.length} Teams in {selectedYear}
              </span>
            </div>
          </div>
        )}
        
        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">Loading season data...</p>
          </div>
        )}
        
        {/* Week Accordions */}
        {!loading && (
          <div className="space-y-3">
            {Object.keys(weeks).length === 0 ? (
              <div className="text-center py-12 bg-white rounded-lg shadow-sm border border-gray-200">
                <p className="text-gray-600">No weeks found for {selectedYear}</p>
                <p className="text-sm text-gray-500 mt-2">
                  You may need to run the migration script first
                </p>
              </div>
            ) : (
              // Render weeks 1-18
              Array.from({ length: 18 }, (_, i) => i + 1)
                .filter(weekNum => weeks[weekNum])
                .map(weekNum => renderWeek(String(weekNum)))
            )}
          </div>
        )}
      </div>
    </div>
  );
}