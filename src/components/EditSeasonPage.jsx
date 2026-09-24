import React, { useState, useEffect } from 'react';
import { Save, ChevronDown, ChevronRight, ArrowLeft, Users, Trophy, Trash2, Lock } from 'lucide-react';

import {
  ApiError,
  getSeason,
  saveWeek as saveWeekRequest,
  unlock as unlockLeague,
  lock as lockLeague,
} from '../api/client';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { seasonPath } from '../routes';
import { useLeague } from '../context/LeagueContext';
import { BYE_LABEL, isBye, ownerLabel } from '../stats/league';

/**
 * EditSeasonPage Component
 *
 * Main interface for editing season data week-by-week
 * Allows updating matchup scores and automatically recalculates standings
 *
 * Writing needs the league unlocked. canWrite comes from the server rather than
 * from this component remembering that it unlocked once: the cookie can expire,
 * or be locked in another tab, and only the server knows. It arrives through
 * the context now, and refreshSession is how this page asks again — the page
 * never asserts the answer it hoped its own request produced.
 */
export default function EditSeasonPage() {
  const { slug, canWrite, refreshSession } = useLeague();
  const navigate = useNavigate();

  // The layout holds the payload every other view draws, and a save is the one
  // event that changes it. Leaving this page no longer unmounts anything that
  // would refetch, so the season table would show the old score without this.
  //
  // `years` comes from the same payload, so the year select and the dashboard's
  // can never disagree about which seasons a league has — and the editor no
  // longer fetches a league-wide list of its own to find out.
  const {
    refresh: refreshSeasons,
    year: urlSeason,
    urlYear,
    years: availableYears,
  } = useOutletContext();

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  // Opens on the season the URL names, so editing the season being looked at
  // is one click rather than two. From here the select is the editor's own and
  // may move away from the URL; mirroring it into the address bar would be a
  // bigger change than opening on the right year. Empty only for a league with
  // no seasons, where the layout's year list is empty too.
  const [selectedYear, setSelectedYear] = useState(urlSeason === null ? '' : String(urlSeason));
  const [weeks, setWeeks] = useState({});
  const [teams, setTeams] = useState([]);
  // What the season is configured as, which is where playoff_start_week lives.
  // Null until the first load lands: no season loaded means no week can be
  // called a playoff week, which is what the initial render should say.
  const [season, setSeason] = useState(null);

  // The matchup whose teams are being changed right now, as "<week>:<index>".
  //
  // A BYE is one side empty and the other filled, which is also what a pairing
  // looks like halfway through being typed in — pick the first team and the
  // second side would turn into the word BYE before it could be picked, leaving
  // the matchup impossible to finish. The stored data cannot tell those apart;
  // only this page knows, because only this page knows someone is mid-edit. So
  // the matchup being edited is never read as a BYE, and it goes back to being
  // one as soon as the editor moves on.
  const [editing, setEditing] = useState(null);
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Unlock form. What the commissioner types lives here only while the form is
  // on screen, and is never written to storage — that would outlive the session
  // it buys, in a place any script on the page can read.
  const [entered, setEntered] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  // ============================================
  // DATA FETCHING
  // ============================================
  
  /**
   * Fall back to the newest season when the URL named none. The layout has
   * already loaded the league, so this needs no request of its own.
   */
  useEffect(() => {
    if (!selectedYear && availableYears.length > 0) {
      setSelectedYear(String(availableYears[0]));
    }
  }, [availableYears, selectedYear]);

  /**
   * Load week data when year changes
   */
  useEffect(() => {
    if (selectedYear) {
      loadSeasonData();
    }
  }, [selectedYear]);

  async function loadSeasonData() {
    setLoading(true);
    try {
      const data = await getSeason(slug, selectedYear);

      setSeason(data.season ?? null);
      setWeeks(editableWeeks(data.weeks));
      setTeams(data.teams || []);

      // Auto-expand week 1 if no weeks are expanded
      if (!expandedWeek && Object.keys(data.weeks || {}).length > 0) {
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
  // UNLOCKING
  // ============================================

  /**
   * Trade the passphrase for a session cookie that may write to this league
   */
  async function unlock(event) {
    event.preventDefault();
    setUnlocking(true);
    setUnlockError('');

    try {
      await unlockLeague(slug, entered);
      setEntered('');
      // The server says whether the cookie it just set may write. Asking beats
      // assuming: a 200 on the unlock is not the same statement as a session.
      await refreshSession();
    } catch (err) {
      // 401 wrong passphrase, 429 too many tries — the server writes both
      // messages, and the client module hands them over unchanged.
      if (err instanceof ApiError) {
        setUnlockError(err.message || 'Could not unlock this league');
      } else {
        console.error('Failed to unlock:', err);
        setUnlockError('Network error while unlocking');
      }
    } finally {
      setUnlocking(false);
    }
  }

  /**
   * Give up the session and leave the editor. The page goes back to the
   * dashboard either way: if the request failed, showing the reader's view is
   * the safe reading, and the next save will find out what the server thinks.
   */
  async function lock() {
    try {
      await lockLeague(slug);
    } catch (err) {
      console.error('Failed to lock:', err);
    } finally {
      setMessage('');
      await refreshSession();
      navigate(seasonPath(slug, urlYear));
    }
  }

  // ============================================
  // WEEK MANAGEMENT
  // ============================================

  /**
   * Toggle week expansion
   */
  function toggleWeek(weekNum) {
    setEditing(null);
    setExpandedWeek(expandedWeek === weekNum ? null : weekNum);
  }

  /** How a matchup is named while it is being edited. Its place in the week. */
  function matchupKey(weekNum, matchupIndex) {
    return `${weekNum}:${matchupIndex}`;
  }

  /**
   * Whether this side should read as a BYE rather than offer a dropdown.
   *
   * Empty, its opponent filled, and nobody in the middle of changing it.
   */
  function isByeSide(weekNum, matchup, matchupIndex, field) {
    if (matchup[field] !== null) return false;
    if (editing === matchupKey(weekNum, matchupIndex)) return false;
    return isBye(matchup);
  }

  /**
   * Update a matchup's team assignment.
   *
   * An <option>'s value is always a string, and a team id is a number the
   * server compares with ===. Converting here, at the one place a select writes
   * state, is what keeps a save from coming back 400 Unknown team "7".
   */
  function updateMatchupTeam(weekNum, matchupIndex, field, value) {
    const teamId = value === '' ? null : Number(value);

    setEditing(matchupKey(weekNum, matchupIndex));
    setWeeks(prev => {
      const newWeeks = { ...prev };
      const week = newWeeks[weekNum];

      if (!week || !week.matchups) return prev;

      const matchups = [...week.matchups];
      matchups[matchupIndex] = {
        ...matchups[matchupIndex],
        [field]: teamId
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
   *
   * Keyed on team ids rather than on the owner's name: two teams in a season can
   * read alike on screen — a botted slot has no owner at all — and a name was
   * never what the week is stored by.
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
        if (currentField === 'team1_id' && matchup.team2_id != null) {
          assignedTeams.add(matchup.team2_id);
        } else if (currentField === 'team2_id' && matchup.team1_id != null) {
          assignedTeams.add(matchup.team1_id);
        }
      } else {
        // for other matchups, add both teams
        if (matchup.team1_id != null) assignedTeams.add(matchup.team1_id);
        if (matchup.team2_id != null) assignedTeams.add(matchup.team2_id);
      }
    });

    // return teams that haven't been assigned yet
    return teams.filter(team =>
      !assignedTeams.has(team.id) || team.id === currentValue
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

      // Every key the write knows, explicitly null: a matchup that is missing a
      // key on the way out is indistinguishable from one that is clearing it,
      // and the payload the rest of the state came from spells all six out.
      const matchups = [...(week.matchups || [])];
      matchups.push({
        team1_id: null,
        team1_score: null,
        team2_id: null,
        team2_score: null,
        status: null,
        label: null
      });

      newWeeks[weekNum] = { matchups };
      return newWeeks;
    });
  }

  /**
   * Remove a matchup from a week
   */
  function removeMatchup(weekNum, matchupIndex) {
    // Every matchup after this one shifts up a place, so a key naming a place
    // no longer names the same matchup.
    setEditing(null);
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
      // A resolved promise is the success. The league route answers with the
      // recomputed standings and no `success` key — every failure is a thrown
      // ApiError, so a truth test on the body would only ever be able to turn a
      // save that worked into a message that says nothing happened.
      await saveWeekRequest(slug, selectedYear, weekNum, weeks[weekNum].matchups);

      // Saved is the end of the edit: a side left empty against a filled
      // opponent is now a BYE the server has accepted, and reads as one.
      setEditing(null);
      setMessage(`✅ Week ${weekNum} saved! Standings updated.`);

      // The server recomputed standings inside the same transaction, so the
      // payload the other views are holding is now stale. Not awaited: the
      // message and the typed week belong to this page, and the refresh is
      // for the page the reader goes back to.
      refreshSeasons();

      // Clear message after 3 seconds
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      // The session ended between opening the page and saving. The provider has
      // already flipped canWrite — the client module told it — so this page only
      // has to say why the form came back. Nothing unmounts, so the week that
      // was typed is still on screen to save once the league is unlocked again.
      if (err instanceof ApiError && err.status === 401) {
        setUnlockError('That session has ended. Unlock again to save your changes.');
        return;
      }

      console.error('Failed to save week:', err);
      setMessage(
        err instanceof ApiError
          ? `❌ Failed to save: ${err.message}`
          : '❌ Network error while saving'
      );
    } finally {
      setSaving(false);
    }
  }
  
  // ============================================
  // RENDER HELPERS
  // ============================================

  /**
   * Check if a week is a playoff week
   *
   * The season says where its playoffs begin. Until one is loaded nothing is a
   * playoff week, which is what an empty editor should render.
   */
  function isPlayoffWeek(weekNum) {
    if (season === null || season.playoff_start_week === null) return false;
    return parseInt(weekNum) >= season.playoff_start_week;
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
   * What an option in a team dropdown reads.
   *
   * The owner, the way every other screen names them. Two teams in one season
   * can carry the same label — two botted slots both read "Botted Season" — and
   * a list with the same words twice is unusable, so those and only those also
   * carry the team's own name.
   */
  function teamOptionLabel(team) {
    const label = ownerLabel(team);
    const sharesLabel = teams.filter(other => ownerLabel(other) === label).length > 1;

    return sharesLabel ? `${label} (${team.team_name})` : label;
  }

  /**
   * Render team selector dropdown
   *
   * The empty side of a BYE is text rather than a dropdown: there is nobody to
   * choose. Emptiness alone is not enough to say so — a matchup with both sides
   * empty is a slot nobody has filled in yet, and a fresh season is laid out
   * entirely of those. Which of the two this is, is the matchup's question, not
   * the side's, so it is asked of the whole matchup — and not at all while that
   * matchup is the one being edited.
   */
  function renderTeamSelector(weekNum, matchup, matchupIndex, field) {
    const currentValue = matchup[field];

    if (isByeSide(weekNum, matchup, matchupIndex, field)) {
      return (
        <div className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-100 text-gray-600 font-semibold text-center">
          {BYE_LABEL}
        </div>
      );
    }

    const availableTeams = getAvailableTeams(weekNum, matchupIndex, field);

    return (
      <select
        value={currentValue ?? ''}
        onChange={(e) => updateMatchupTeam(weekNum, matchupIndex, field, e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
      >
        <option value="">Select team...</option>
        {availableTeams.map(team => (
          <option key={team.id} value={team.id}>
            {teamOptionLabel(team)}
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
            {renderTeamSelector(weekNum, matchup, index, 'team1_id')}
          </div>

          {/* VS Divider */}
          <div className="text-gray-400 font-bold">VS</div>

          {/* Team 2 */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team 2
            </label>
            {renderTeamSelector(weekNum, matchup, index, 'team2_id')}
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
              value={matchup.team1_score ?? ''}
              onChange={(e) => updateMatchupScore(weekNum, index, 'team1_score', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              disabled={matchup.team1_id === null}
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
              value={matchup.team2_score ?? ''}
              onChange={(e) => updateMatchupScore(weekNum, index, 'team2_score', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              disabled={matchup.team2_id === null}
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
  
  // Locked: the only thing on this page is the way in. Any edits already in
  // state survive behind it, so an expired session doesn't cost them.
  if (!canWrite) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-md mx-auto">
          <Link
            to={seasonPath(slug, urlYear)}
            className="mb-4 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center gap-2"
          >
            <ArrowLeft size={18} />
            Back to Dashboard
          </Link>

          <form onSubmit={unlock} className="bg-white rounded-lg shadow-md p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock size={20} className="text-gray-500" />
              <h1 className="text-xl font-bold text-gray-900">Unlock editing</h1>
            </div>
            <p className="text-gray-600 text-sm">
              Everyone can read this league. Changing it needs the passphrase.
            </p>

            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={entered}
              onChange={(e) => setEntered(e.target.value)}
              placeholder="Passphrase"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />

            {unlockError && (
              <div className="p-3 rounded-lg bg-red-100 text-red-800 text-sm">{unlockError}</div>
            )}

            <button
              type="submit"
              disabled={unlocking || entered === ''}
              className="w-full px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 transition-colors"
            >
              {unlocking ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
          <div className="mb-4 flex items-center justify-between gap-4">
            <Link
              to={seasonPath(slug, urlYear)}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center gap-2"
            >
              <ArrowLeft size={18} />
              Back to Dashboard
            </Link>

            {/* One lock for the page, rather than one beside each week's save.
                It ends the session and returns to the dashboard, so "done
                editing" and "still editing but blocked" can't be confused. */}
            <button
              onClick={lock}
              title="End this editing session and return to the dashboard"
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center gap-2"
            >
              <Lock size={18} />
              Lock editing
            </button>
          </div>

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
            {/* The layout holds the payload back until it has landed, so an
                empty list here is a league with no seasons, never one still
                loading. */}
            {availableYears.length === 0 && (
              <option value="">No seasons yet</option>
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

/**
 * The payload's weeks, holding only the keys a save may send back.
 *
 * The write refuses a body with any key it does not know, which is what makes a
 * stale field fail loudly rather than save a blank week. `position` is the one
 * key the read returns and the write will not take: it is the matchup's place in
 * the array, and the server assigns it from that array on the way back in. So it
 * is dropped here, once, at the edge — the alternative is the save filtering the
 * state it is about to send, which would filter a real mistake out too.
 */
function editableWeeks(weeks) {
  const editable = {};

  for (const [number, week] of Object.entries(weeks ?? {})) {
    editable[number] = {
      matchups: (week.matchups ?? []).map(({ position, ...matchup }) => matchup),
    };
  }

  return editable;
}