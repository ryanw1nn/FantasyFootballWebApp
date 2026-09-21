// The header and toolbar the season, all-time and bracket views share. There
// used to be two copies of this toolbar, one per screen, and they had already
// drifted — the bracket's had no filter menu and always showed the year. One
// copy is what lets the league switcher go in once and agree with itself.
//
// The editor and the player page are full pages of their own and sit outside
// this layout, as they always have.

import React from 'react';
import { Outlet, useMatch, useOutletContext } from 'react-router-dom';
import { Edit, Trophy, Unlock } from 'lucide-react';

import { LinkButton } from './ui/Button';
import { useLeague } from '../context/LeagueContext';
import { alltimePath, bracketPath, editPath, seasonPath } from '../routes';

export default function DashboardLayout() {
  const { slug, canWrite } = useLeague();
  const league = useOutletContext();
  const { years, year, setYear } = league;

  // All-time spans every season, so it has no year to choose.
  const onAlltime = useMatch(alltimePath(slug)) !== null;

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

            <div className="flex gap-2">
              <LinkButton to={seasonPath(slug)} activeVariant="solid">Season</LinkButton>
              <LinkButton to={alltimePath(slug)} activeVariant="solid">All-Time</LinkButton>
              <LinkButton to={bracketPath(slug)} activeVariant="solid">Playoff Bracket</LinkButton>

              {/* Locked, the editor is replaced by the way into it. Hiding the
                  edit link is tidiness, not protection — the server refuses the
                  write either way. The padlock is an opening one: this is the
                  way in, and a closed padlock beside "Unlock" reads as a
                  control that locks something. */}
              <LinkButton to={editPath(slug)} variant="ghost">
                {canWrite ? <Edit size={16} /> : <Unlock size={16} />}
                {canWrite ? 'Edit Season Data' : 'Unlock editing'}
              </LinkButton>
            </div>

            {!onAlltime && (
              <select
                value={year ?? ''}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y} Season
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <Outlet context={league} />
      </div>
    </div>
  );
}
