import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, Undo2 } from 'lucide-react';

import { ApiError, createSeason, previewSeason } from '../api/client';

/**
 * CreateSeasonPanel Component
 *
 * Creates a season of any year the league does not have yet, past or next.
 * It is a roster to confirm, not a form to fill: picking a year loads the
 * nearest season's roster from the server's preview, and each team is kept,
 * renamed or dropped, with new players added below.
 *
 * The preview and the create run the same server code, so the roster shown
 * here is the one the POST builds from. The client never works out "nearest"
 * for itself. Every check the panel makes is a convenience; the server's 400s
 * and 409s are the real ones, and their messages are shown as they come.
 *
 * Drawn only when canWrite is true. `onCreated(year)` runs after the season
 * exists; `onSessionEnded()` runs when the create is refused for want of an
 * unlock, after the provider has already flipped canWrite.
 */

/** The server's range: 2000 up to next year. */
const FIRST_YEAR = 2000;

export default function CreateSeasonPanel({ slug, years, onCreated, onSessionEnded }) {
  const [open, setOpen] = useState(false);

  // Every year the league could still have, newest first. The default is next
  // season when that is free, which is the common case; otherwise the newest gap.
  const missingYears = useMemo(() => {
    const taken = new Set(years.map(Number));
    const missing = [];
    for (let year = new Date().getFullYear() + 1; year >= FIRST_YEAR; year--) {
      if (!taken.has(year)) missing.push(year);
    }
    return missing;
  }, [years]);

  const [year, setYear] = useState('');
  const [preview, setPreview] = useState(null);
  const [teams, setTeams] = useState([]);
  const [added, setAdded] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Open on the default year the first time the panel is opened, and whenever
  // the year that was picked stops being missing — it was just created.
  useEffect(() => {
    if (!open) return;
    if (year === '' || !missingYears.includes(Number(year))) {
      setYear(missingYears.length > 0 ? String(missingYears[0]) : '');
    }
  }, [open, missingYears, year]);

  useEffect(() => {
    if (!open || year === '') return undefined;
    let current = true;

    setLoading(true);
    setError('');
    setPreview(null);

    previewSeason(slug, year)
      .then((body) => {
        if (!current) return;
        setPreview(body);
        setTeams(body.roster.map((team) => ({ ...team, newTeam: team.team, dropped: false })));
        setAdded([]);
      })
      .catch((err) => {
        if (!current) return;
        console.error('Failed to preview season:', err);
        setError(err instanceof ApiError ? err.message : 'Network error while loading the roster');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [open, slug, year]);

  // ============================================
  // ROSTER EDITS
  // ============================================

  function updateTeam(index, changes) {
    setTeams((prev) => prev.map((team, i) => (i === index ? { ...team, ...changes } : team)));
  }

  function updateAdded(index, changes) {
    setAdded((prev) => prev.map((team, i) => (i === index ? { ...team, ...changes } : team)));
  }

  function addPlayer() {
    setAdded((prev) => [...prev, { player: '', team: '' }]);
  }

  function removeAdded(index) {
    setAdded((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * The body, in db:season's vocabulary. A rename is only sent when the name
   * actually changed, and a half-typed new player is sent as typed, so the
   * server says what is wrong with it rather than it vanishing.
   */
  function requestBody() {
    const drop = teams.filter((team) => team.dropped).map((team) => team.player);
    const rename = teams
      .filter((team) => !team.dropped && team.newTeam.trim() !== team.team)
      .map((team) => ({ player: team.player, team: team.newTeam.trim() }));
    const add = added.map((team) => ({ player: team.player.trim(), team: team.team.trim() }));

    return { year: Number(year), drop, add, rename };
  }

  const kept = teams.filter((team) => !team.dropped).length;
  const teamCount = kept + added.length;
  const isOdd = teamCount % 2 !== 0;
  const hasBlank = added.some((team) => team.player.trim() === '' || team.team.trim() === '');

  async function create() {
    setCreating(true);
    setError('');

    try {
      const created = await createSeason(slug, requestBody());
      setOpen(false);
      await onCreated(created.year);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionEnded();
        return;
      }
      console.error('Failed to create season:', err);
      setError(err instanceof ApiError ? err.message : 'Network error while creating the season');
    } finally {
      setCreating(false);
    }
  }

  // ============================================
  // RENDER
  // ============================================

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white';

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        <h2 className="text-lg font-semibold text-gray-900">Create a season</h2>
        <span className="text-sm text-gray-500">Past or next, from the nearest season's roster</span>
      </button>

      {open && (
        <div className="px-6 py-4 border-t border-gray-200 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                {missingYears.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {preview && (
              <p className="text-sm text-gray-600 pb-2">
                Starting from <span className="font-semibold">{preview.from}</span>'s roster
              </p>
            )}
          </div>

          {loading && <p className="text-gray-600 text-sm">Loading roster...</p>}

          {preview && !loading && (
            <>
              <div className="space-y-2">
                {teams.map((team, index) => (
                  <div
                    key={team.player}
                    className={`flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border ${
                      team.dropped ? 'bg-gray-100 border-gray-200' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <span
                      className={`sm:w-48 font-medium ${team.dropped ? 'text-gray-400 line-through' : 'text-gray-900'}`}
                    >
                      {team.player}
                    </span>
                    <input
                      value={team.newTeam}
                      onChange={(e) => updateTeam(index, { newTeam: e.target.value })}
                      disabled={team.dropped}
                      maxLength={120}
                      aria-label={`${team.player}'s team name`}
                      className={`${inputClass} sm:flex-1 disabled:bg-gray-100 disabled:text-gray-400`}
                    />
                    <button
                      onClick={() => updateTeam(index, { dropped: !team.dropped })}
                      className={`text-sm flex items-center gap-1 px-2 py-1 ${
                        team.dropped ? 'text-indigo-600 hover:text-indigo-800' : 'text-red-600 hover:text-red-800'
                      }`}
                    >
                      {team.dropped ? <Undo2 size={14} /> : <Trash2 size={14} />}
                      {team.dropped ? 'Keep' : 'Drop'}
                    </button>
                  </div>
                ))}

                {added.map((team, index) => (
                  <div
                    key={`added-${index}`}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-indigo-200 bg-indigo-50"
                  >
                    <input
                      value={team.player}
                      onChange={(e) => updateAdded(index, { player: e.target.value })}
                      placeholder="Player name"
                      maxLength={120}
                      className={`${inputClass} sm:w-48`}
                    />
                    <input
                      value={team.team}
                      onChange={(e) => updateAdded(index, { team: e.target.value })}
                      placeholder="Team name"
                      maxLength={120}
                      className={`${inputClass} sm:flex-1`}
                    />
                    <button
                      onClick={() => removeAdded(index)}
                      className="text-red-600 hover:text-red-800 text-sm flex items-center gap-1 px-2 py-1"
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  </div>
                ))}

                <button
                  onClick={addPlayer}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-indigo-500 hover:text-indigo-600 transition-colors flex items-center justify-center gap-1"
                >
                  <Plus size={16} />
                  Add a player
                </button>
                <p className="text-xs text-gray-500">
                  A name this league has seen before reuses that player; a new name creates one.
                </p>
              </div>

              {preview.warnings.map((warning) => (
                <div key={warning} className="p-3 rounded-lg bg-amber-100 text-amber-800 text-sm">
                  {warning}
                </div>
              ))}

              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700">
                <p className="font-semibold text-gray-900 mb-1">Will create</p>
                <p>
                  {year} · {teamCount} teams · {preview.regular_season_weeks} regular-season weeks
                  {preview.playoff_matchups > 0
                    ? ` · playoffs from week ${preview.playoff_start_week} (${preview.playoff_matchups} games, copied from ${preview.from})`
                    : ' · no playoff weeks'}
                </p>
                <p className="text-gray-500 mt-1">Every week starts empty, ready for pairings and scores.</p>
                {isOdd && (
                  <p className="text-red-700 mt-2">
                    {teamCount} teams is odd. Add or drop a team so every week is full.
                  </p>
                )}
              </div>
            </>
          )}

          {error && <div className="p-3 rounded-lg bg-red-100 text-red-800 text-sm">{error}</div>}

          {preview && !loading && (
            <div className="flex justify-end">
              <button
                onClick={create}
                disabled={creating || isOdd || hasBlank || teamCount === 0}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                {creating ? 'Creating...' : `Create ${year}`}
              </button>
            </div>
          )}

          {missingYears.length === 0 && (
            <p className="text-gray-600 text-sm">Every year from {FIRST_YEAR} on already exists.</p>
          )}
        </div>
      )}
    </div>
  );
}
