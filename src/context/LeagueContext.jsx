// Which league the client is looking at, and whether this browser may write to
// it. One provider owns both, so the slug stops being a constant redeclared in
// every component that needs it and canWrite stops being App's useState drilled
// two props deep.
//
// It calls src/api/client.js and nothing else. The two metadata routes it is
// allowed to use are already the new dialect — neither carries a team, a
// standings row or a matchup, so no view's shape depends on them.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getSession, onUnauthorized } from '../api/client';

/**
 * The league served when nothing says otherwise. Phase 5 replaces this default
 * with the slug out of the URL; every call site already takes it from here, so
 * that change reaches one file.
 */
export const DEFAULT_LEAGUE = 'fan-club';

const LeagueContext = createContext(null);

export function LeagueProvider({ slug = DEFAULT_LEAGUE, children }) {
  // The server's answer to "may this browser write", and never persisted: a
  // canWrite kept in localStorage outlives the cookie that justified it, and a
  // stale true draws the editor for someone whose save will 401. What is drawn
  // is all this value decides — the guard on the server is the control.
  const [canWrite, setCanWrite] = useState(false);

  // Null until Phase 5 switches getLeagues() on. One row comes back today and
  // no view can show a second league before the switcher exists, so calling it
  // now is a round trip that renders nothing.
  const [leagues] = useState(null);

  /**
   * Ask the server where the session stands. Called on mount and by the editor
   * after an unlock or a lock, so what lands is the server's answer rather than
   * the client's assumption about what its own request accomplished.
   *
   * A failed request means false: a reader has no cookie and gets false too, so
   * that is the only safe reading of "we could not tell".
   */
  const refreshSession = useCallback(async () => {
    try {
      const session = await getSession(slug);
      const allowed = session?.canWrite === true;
      setCanWrite(allowed);
      return allowed;
    } catch (err) {
      console.error('Failed to check session:', err);
      setCanWrite(false);
      return false;
    }
  }, [slug]);

  useEffect(() => {
    let current = true;

    // The slug can change under us in Phase 5, and the answer for the old
    // league must not land as the answer for the new one.
    getSession(slug)
      .then((session) => {
        if (current) setCanWrite(session?.canWrite === true);
      })
      .catch((err) => {
        console.error('Failed to check session:', err);
        if (current) setCanWrite(false);
      });

    return () => {
      current = false;
    };
  }, [slug]);

  // The one subscriber the client allows. It fires only for the guarded write,
  // so reaching here means the session the page was drawn for is gone: stop
  // drawing the editor as writable. The ApiError still reaches the save, which
  // is what puts the unlock form back without unmounting the typed week.
  useEffect(() => {
    onUnauthorized(() => setCanWrite(false));
    return () => onUnauthorized(null);
  }, []);

  const value = { slug, leagues, canWrite, refreshSession };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

/** The current league, its siblings, and what this browser may do to it. */
export function useLeague() {
  const value = useContext(LeagueContext);
  if (value === null) {
    throw new Error('useLeague must be used inside a <LeagueProvider>');
  }
  return value;
}
