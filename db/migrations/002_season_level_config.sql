-- 002_season_level_config.sql — playoff shape moves from the league to the season.
--
-- 001 put regular_season_weeks and playoff_start_week on leagues, on the stated
-- evidence that all six seasons were uniform at 14/15. They are not. 2020 ran a
-- 12-game regular season and an 8-team, 3-round playoff; 2021-2025 run 14 games
-- and a 6-team playoff with byes for the top two seeds. The distribution of
-- playoff rounds in the data shows it plainly:
--
--   2020        {0:4, 1:4, 2:2, 3:2}   8 teams enter, no byes
--   2021-2025   {0:6, 1:2, 2:2, 3:2}   6 teams enter, #1 and #2 bye
--
-- So the shape is a property of a season, not of a league. A league that changes
-- format is the normal case, not the exotic one — this league already did it.
--
-- The league columns stay, demoted to defaults: they are the template a new
-- season is created from, and nothing reads them at compute time. Standings
-- logic reads the season row, always, with no COALESCE and no fallback — a
-- season is authoritative about its own shape.

ALTER TABLE seasons
  ADD COLUMN regular_season_weeks smallint,
  ADD COLUMN playoff_start_week   smallint;

-- Backfill is a no-op today: no season rows exist anywhere, in local or in Neon.
-- It is here so the migration is correct if that ever stops being true, and it
-- seeds from the league template exactly as season creation will.
UPDATE seasons s
   SET regular_season_weeks = l.regular_season_weeks,
       playoff_start_week   = l.playoff_start_week
  FROM leagues l
 WHERE l.id = s.league_id
   AND (s.regular_season_weeks IS NULL OR s.playoff_start_week IS NULL);

ALTER TABLE seasons
  ALTER COLUMN regular_season_weeks SET NOT NULL,
  ALTER COLUMN playoff_start_week   SET NOT NULL,
  ADD CONSTRAINT seasons_weeks_ordered CHECK (playoff_start_week > regular_season_weeks);

COMMENT ON COLUMN leagues.regular_season_weeks IS
  'Default for new seasons only. Standings logic reads seasons.regular_season_weeks.';
COMMENT ON COLUMN leagues.playoff_start_week IS
  'Default for new seasons only. Standings logic reads seasons.playoff_start_week.';

-- ---------------------------------------------------------------------------
-- The 2020 lock
-- ---------------------------------------------------------------------------
-- 2020 has no weekly scores at all — the season was never entered game by game,
-- only its final table. recalculateStandings protects it today by accident: it
-- returns early when no week has scores, so the hand-entered numbers survive.
--
-- That protection disappears in Phase 2, where standings become stored rather
-- than recalculated on read. One score typed into one 2020 matchup would make
-- weeksWithScores non-empty, and the next recompute would overwrite twelve
-- hand-entered records with a table derived from that single week. In the JSON
-- that is a git checkout. In Postgres it is gone, and 2020 is the one season
-- with no source data to rebuild from.
--
-- So the season carries the flag, and the standings writer refuses to touch a
-- season that has it set. Unsetting it is a deliberate act with a migration or a
-- manual UPDATE behind it, not a side effect of an edit.

ALTER TABLE seasons
  ADD COLUMN standings_are_imported boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN seasons.standings_are_imported IS
  'True when standings were entered by hand and cannot be derived from matchups '
  '(2020). The standings writer must refuse to recompute such a season.';
