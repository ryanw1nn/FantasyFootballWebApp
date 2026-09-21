import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The year to show for a requested `?year=`, checked against the seasons the
 * league actually has. A slug is an identity and a year is a hint: a year that
 * is missing, malformed or simply not one of this league's seasons resolves to
 * the latest one rather than to a dead end.
 *
 * `requested` is the raw param (a string, or null when absent). `years` is the
 * league's season list, newest first. Matching on the string rather than on
 * Number(requested) is what keeps `2021.0` or ` 2021` from opening 2021 under
 * an address that says something else.
 *
 * Pure, so a league switch can run the same rule against the target league's
 * list before it navigates.
 */
export function resolveYear(requested, years) {
  const latest = years.length > 0 ? years[0] : null;
  if (requested === null) return latest;
  return years.find((year) => String(year) === requested) ?? latest;
}

/**
 * The season year, read from `?year=` and nowhere else.
 *
 * Returns:
 * - `year`: the resolved year as a Number, or null while the league has none.
 * - `urlYear`: the same year when the URL names one, null when it doesn't —
 *   what links carry, so a URL with no year keeps meaning "the latest" as the
 *   reader moves around.
 * - `setYear`: writes `?year=` in place. Replace rather than push, so the back
 *   button leaves the page instead of walking back through every year picked.
 *
 * A `?year=` that resolved to something else is rewritten to the year actually
 * shown — falling back silently would leave an address that lies next to a
 * table the reader is about to copy and send on. A missing param is not a
 * mistake and is never rewritten. Nothing is rewritten while `years` is empty
 * either: before the list lands there is nothing to check against, and a
 * league with no seasons has no better year to offer.
 */
export default function useSeasonYear(years) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('year');
  const year = resolveYear(requested, years);

  const urlYear = requested === null ? null : year;
  const needsRewrite = requested !== null && year !== null && String(year) !== requested;

  const setYear = useCallback(
    (nextYear) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('year', String(nextYear));
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (needsRewrite) setYear(year);
  }, [needsRewrite, year, setYear]);

  return { year, urlYear, setYear };
}
