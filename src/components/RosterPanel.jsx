import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';

import { ApiError, addTeam, removeTeam, renameTeam } from '../api/client';
import { ownerLabel } from '../stats/league';

/**
 * RosterPanel Component
 *
 * The roster of the season open in the editor: rename a team, remove one, or
 * add one for a player the league already has or a new name. Every change is
 * to this season only.
 *
 * A team with a scored matchup cannot be removed, so its button is disabled
 * with the reason beside it. That is a convenience read from the saved season;
 * the server's 409 is the real check, and every refusal is shown in the
 * server's own words.
 *
 * Drawn only when canWrite is true. `onChanged(season, { weeks })` hands back
 * the season the server answered with; `weeks` is false for a rename, which
 * changes no week, so the editor can keep what is typed into them.
 * `onSessionEnded()` runs when a change is refused for want of an unlock.
 */
export default function RosterPanel({
  slug,
  year,
  teams,
  scoredTeamIds,
  leaguePlayers,
  onChanged,
  onSessionEnded,
}) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [newPlayer, setNewPlayer] = useState('');
  const [newTeam, setNewTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Another season, or the same one reloaded: start from the saved names.
  useEffect(() => {
    setNames(Object.fromEntries(teams.map((team) => [team.id, team.team_name])));
    setConfirming(null);
  }, [teams]);

  useEffect(() => {
    setError('');
    setNewPlayer('');
    setNewTeam('');
  }, [year]);

  // Who could be added without creating anyone: the league's players with no
  // team this season. A botted slot has no player and offers nobody.
  const onRoster = new Set(teams.map((team) => team.display_name).filter(Boolean));
  const available = leaguePlayers.filter((name) => !onRoster.has(name));

  async function change(request, { weeks }) {
    setBusy(true);
    setError('');

    try {
      const season = await request();
      await onChanged(season, { weeks });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionEnded();
        return false;
      }
      console.error('Failed to change the roster:', err);
      setError(err instanceof ApiError ? err.message : 'Network error while changing the roster');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function rename(team) {
    return change(() => renameTeam(slug, year, team.id, names[team.id].trim()), { weeks: false });
  }

  function remove(team) {
    setConfirming(null);
    return change(() => removeTeam(slug, year, team.id), { weeks: true });
  }

  async function add() {
    const added = await change(
      () => addTeam(slug, year, newTeam.trim(), { name: newPlayer.trim() }),
      { weeks: true }
    );
    if (added) {
      setNewPlayer('');
      setNewTeam('');
    }
  }

  // ============================================
  // RENDER
  // ============================================

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white';

  const canAdd = !busy && newPlayer.trim() !== '' && newTeam.trim() !== '';

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        <h2 className="text-lg font-semibold text-gray-900">{year} roster</h2>
        <span className="text-sm text-gray-500">{teams.length} teams</span>
      </button>

      {open && (
        <div className="px-6 py-4 border-t border-gray-200 space-y-4">
          <p className="text-sm text-gray-600">
            Changes apply to {year} only. Adding or removing a team reloads the weeks, so save any
            week you are editing first.
          </p>

          <div className="space-y-2">
            {teams.map((team) => {
              const name = names[team.id] ?? team.team_name;
              const renamed = name.trim() !== '' && name.trim() !== team.team_name;
              const hasScores = scoredTeamIds.has(team.id);

              return (
                <div
                  key={team.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border bg-gray-50 border-gray-200"
                >
                  <span className="sm:w-48 font-medium text-gray-900">{ownerLabel(team)}</span>
                  <input
                    value={name}
                    onChange={(e) => setNames((prev) => ({ ...prev, [team.id]: e.target.value }))}
                    maxLength={120}
                    aria-label={`${ownerLabel(team)}'s team name`}
                    className={`${inputClass} sm:flex-1`}
                  />
                  {renamed && (
                    <button
                      onClick={() => rename(team)}
                      disabled={busy}
                      className="text-sm flex items-center gap-1 px-2 py-1 text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                    >
                      <Check size={14} />
                      Rename
                    </button>
                  )}
                  {confirming === team.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() => remove(team)}
                        disabled={busy}
                        className="text-sm flex items-center gap-1 px-2 py-1 text-white bg-red-600 rounded hover:bg-red-700 disabled:bg-gray-400"
                      >
                        <Trash2 size={14} />
                        Remove {team.team_name}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        aria-label="Keep this team"
                        className="text-sm px-2 py-1 text-gray-600 hover:text-gray-800"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirming(team.id)}
                      disabled={busy || hasScores}
                      title={hasScores ? `Has scores in ${year}; rename it instead` : undefined}
                      className="text-sm flex items-center gap-1 px-2 py-1 text-red-600 hover:text-red-800 disabled:text-gray-400"
                    >
                      <Trash2 size={14} />
                      {hasScores ? 'Has scores' : 'Remove'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-indigo-200 bg-indigo-50">
            <input
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              list={`roster-players-${year}`}
              placeholder="Player (pick or type a new name)"
              maxLength={120}
              className={`${inputClass} sm:w-64`}
            />
            <datalist id={`roster-players-${year}`}>
              {available.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <input
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)}
              placeholder="Team name"
              maxLength={120}
              className={`${inputClass} sm:flex-1`}
            />
            <button
              onClick={add}
              disabled={!canAdd}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 transition-colors flex items-center gap-1 text-sm"
            >
              <Plus size={16} />
              Add team
            </button>
          </div>
          <p className="text-xs text-gray-500">
            A name this league has seen before reuses that player; a new name creates one. A new
            team has no opponents until a week is edited.
          </p>

          {teams.length % 2 !== 0 && (
            <div className="p-3 rounded-lg bg-amber-100 text-amber-800 text-sm">
              {teams.length} teams is odd, so one team sits out each week. Each regular-season week
              has a spare row for it.
            </div>
          )}

          {error && <div className="p-3 rounded-lg bg-red-100 text-red-800 text-sm">{error}</div>}
        </div>
      )}
    </div>
  );
}
