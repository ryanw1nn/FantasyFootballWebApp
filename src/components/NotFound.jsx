// The answer for an address the app has nothing at: a league that doesn't
// exist, or a path no route matches. It is a page, reached by rendering it,
// never by throwing — an error thrown inside a route is a bug, and dressing it
// up as a 404 would hide it.
//
// The document around it still arrived as a 200. The client cannot change
// that; the server can, once it serves the app itself.

import React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';

import { DEFAULT_LEAGUE } from '../context/LeagueContext';
import { seasonPath } from '../routes';

/**
 * `unknownLeague` is set when the slug in the URL is not a league. Otherwise
 * the path is what's unknown, and the way home is the league the reader is
 * already in, when they are in one.
 */
export default function NotFound({ unknownLeague = false }) {
  const { slug } = useParams();
  const { pathname } = useLocation();

  const homeSlug = slug && !unknownLeague ? slug : DEFAULT_LEAGUE;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
        <SearchX className="text-slate-400 mx-auto mb-4" size={40} />
        <h1 className="text-xl font-bold text-slate-900 mb-2">
          {unknownLeague ? 'League not found' : 'Page not found'}
        </h1>
        <p className="text-slate-600 text-sm mb-6 break-words">
          {unknownLeague ? (
            <>There is no league called <code className="font-mono text-slate-900">{slug}</code>.</>
          ) : (
            <>Nothing lives at <code className="font-mono text-slate-900">{pathname}</code>.</>
          )}
        </p>
        <Link
          to={seasonPath(homeSlug)}
          className="inline-block px-4 py-2 rounded-lg bg-accent-600 text-white text-sm font-medium hover:bg-accent-700 focus:ring-2 focus:ring-accent-500"
        >
          Go to the season table
        </Link>
      </div>
    </div>
  );
}
