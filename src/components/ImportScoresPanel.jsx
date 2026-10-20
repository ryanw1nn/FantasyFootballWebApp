import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardCheck, Download } from 'lucide-react';

import { ApiError, importScores } from '../api/client';

/**
 * ImportScoresPanel Component
 *
 * Enters a season's scores from ESPN. The commissioner opens the league's
 * Schedule page on ESPN, selects all, copies, and pastes it here. Checking the
 * paste asks the server what it would do — every week, every game, and every
 * problem with its line in the paste — and writes nothing. Importing sends the
 * same text again; the server re-checks it inside the write and refuses with
 * the same report if anything is wrong, so nothing is ever half imported.
 *
 * Scores already on the site are left alone when they agree and are a problem
 * when they don't. Weeks not played yet, or with a score of 0, are skipped.
 *
 * Drawn only when canWrite is true. `onImported()` runs after a write, so the
 * editor can reload the season; `onSessionEnded()` runs on a 401.
 */
export default function ImportScoresPanel({ slug, year, onImported, onSessionEnded }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [report, setReport] = useState(null);
  // The text the report was made from. Editing the paste afterwards makes the
  // report stale, and the import button waits for a fresh check.
  const [checkedText, setCheckedText] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    setReport(null);
    setCheckedText(null);
    setError('');
    setDone('');
  }, [year]);

  async function send(apply) {
    setBusy(true);
    setError('');
    setDone('');

    try {
      const result = await importScores(slug, year, text, apply);
      setReport(result);
      setCheckedText(text);

      if (apply && result.applied) {
        setDone(`✅ Imported ${result.entered} game${result.entered === 1 ? '' : 's'} into ${year}. Standings updated.`);
        await onImported();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionEnded();
        return;
      }
      // The refused import carries its report: show every problem, not just the count.
      if (err instanceof ApiError && err.body?.problems) {
        setReport(err.body);
        setCheckedText(text);
      }
      console.error('Failed to import scores:', err);
      setError(err instanceof ApiError ? err.message : 'Network error while importing');
    } finally {
      setBusy(false);
    }
  }

  const fresh = report !== null && checkedText === text;
  const canImport = fresh && !busy && report.problems.length === 0 && report.entered > 0;

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        <h2 className="text-lg font-semibold text-gray-900">Import {year} scores from ESPN</h2>
        <span className="text-sm text-gray-500">Paste the league's Schedule page</span>
      </button>

      {open && (
        <div className="px-6 py-4 border-t border-gray-200 space-y-4">
          <p className="text-sm text-gray-600">
            On ESPN, open <span className="font-medium">League → Schedule</span> with "All" selected,
            select everything on the page (Ctrl+A or Command+A), copy, and paste it below. Nothing is saved until you
            check the paste and then import it.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste the ESPN schedule page here"
            aria-label="ESPN schedule paste"
            className="w-full px-3 py-2 border border-gray-300 rounded font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />

          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => send(false)}
              disabled={busy || text.trim() === ''}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:text-gray-400 transition-colors flex items-center gap-2 text-sm"
            >
              <ClipboardCheck size={16} />
              {busy ? 'Checking...' : 'Check paste'}
            </button>
            <button
              onClick={() => send(true)}
              disabled={!canImport}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 transition-colors flex items-center gap-2 text-sm"
            >
              <Download size={16} />
              {fresh && report.entered > 0 ? `Import ${report.entered} games` : 'Import'}
            </button>
          </div>

          {report !== null && !fresh && (
            <p className="text-sm text-amber-700">The paste changed since it was checked. Check it again.</p>
          )}

          {error && <div className="p-3 rounded-lg bg-red-100 text-red-800 text-sm">{error}</div>}
          {done && <div className="p-3 rounded-lg bg-green-100 text-green-800 text-sm">{done}</div>}

          {fresh && <ImportReport report={report} />}
        </div>
      )}
    </div>
  );
}

/** What the server found: the problems first, then week by week. */
function ImportReport({ report }) {
  const { problems, weeks } = report;
  const entering = weeks.filter((week) => week.action === 'enter' || week.action === 'problem');
  const unchanged = weeks.filter((week) => week.action === 'unchanged');
  const skipped = groupSkipped(weeks.filter((week) => week.action === 'skipped'));

  return (
    <div className="space-y-3 text-sm">
      {problems.length > 0 && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
          <p className="font-semibold mb-2">
            {problems.length} problem{problems.length === 1 ? '' : 's'}. Nothing will be imported
            until every one is fixed, on the site or in the paste.
          </p>
          <ul className="space-y-1 list-disc pl-5">
            {problems.map((problem, index) => (
              <li key={index}>
                {problem.line !== null && <span className="font-mono text-xs">Line {problem.line}: </span>}
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {problems.length === 0 && report.entered === 0 && !report.applied && (
        <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-700">
          Everything played in this paste is already on the site. Nothing to import.
        </div>
      )}

      {entering.map((week) => (
        <div key={week.week} className="p-3 rounded-lg bg-gray-50 border border-gray-200">
          <p className="font-semibold text-gray-900 mb-1">
            Week {week.week}
            {week.playoff ? ' (playoffs)' : ''}
            {' · '}
            {week.games.filter((game) => game.action === 'enter').length} to{' '}
            {report.applied ? 'entered' : 'enter'}
          </p>
          <ul className="space-y-0.5 text-gray-700">
            {week.games.map((game) => (
              <li key={game.line} className={game.action === 'enter' ? '' : 'text-gray-400'}>
                {game.away.player} {game.away.score.toFixed(2)} – {game.home.score.toFixed(2)}{' '}
                {game.home.player}
                {game.action === 'same' && ' · already on the site'}
                {game.action === null && ' · see problems'}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {unchanged.length > 0 && (
        <p className="text-gray-600">
          Already on the site, unchanged: week{unchanged.length === 1 ? '' : 's'}{' '}
          {unchanged.map((week) => week.week).join(', ')}.
        </p>
      )}

      {skipped.map(({ reason, weeks: numbers }) => (
        <p key={reason} className="text-gray-500">
          Skipped ({reason}): week{numbers.length === 1 ? '' : 's'} {numbers.join(', ')}.
        </p>
      ))}
    </div>
  );
}

/** Skipped weeks grouped by why, so "not played yet" is one line, not seven. */
function groupSkipped(weeks) {
  const groups = new Map();
  for (const week of weeks) {
    if (!groups.has(week.reason)) groups.set(week.reason, []);
    groups.get(week.reason).push(week.week);
  }
  return [...groups].map(([reason, numbers]) => ({ reason, weeks: numbers }));
}
