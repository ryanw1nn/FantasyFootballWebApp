-- 003_derive_made_playoffs.sql — made_playoffs stops being independently stored.
--
-- The flag has always meant "advanced past the first round", not "qualified for
-- the bracket". 2020 is the clearest case: it was a 12-team tournament with
-- everybody in, and the four teams carrying made = false are the four that lost
-- the play-in round, not four teams that missed a cut that did not exist.
--
-- Across all 72 team-seasons in seasons.json, made === (rounds >= 1) holds in 71.
-- The exception is a data-entry error rather than a second meaning:
--
--   2021 Josh Whelan — #2 seed, first-round bye, won the semi-final, lost the
--   Super Bowl. Stored playoff.rounds = 3 and playoff.made = FALSE, in both the
--   teams[] and standings[] copies. AllTimeTable.jsx:137 gates on the flag
--   before adding rounds, so his three 2021 playoff rounds are missing from his
--   all-time total today.
--
-- Deriving the column fixes that row on import and makes the two fields
-- incapable of disagreeing again.
--
-- What this gives up: "qualified for the bracket" is no longer expressible, so
-- 2020's twelve entrants cannot be recorded as such. That remains derivable from
-- the matchups rows, and a separate playoff_qualified column can be added if a
-- playoff-appearances stat ever needs it.

ALTER TABLE teams DROP COLUMN made_playoffs;

ALTER TABLE teams
  ADD COLUMN made_playoffs boolean
    GENERATED ALWAYS AS (playoff_rounds >= 1) STORED;

COMMENT ON COLUMN teams.made_playoffs IS
  'Derived: advanced past the first round (playoff_rounds >= 1). Not writable, '
  'and not the same question as "qualified for the bracket" — in 2020 all 12 '
  'teams qualified and 4 of them sit at 0.';

COMMENT ON COLUMN teams.playoff_rounds IS
  'Rung reached, per docs/schema.md: 0 missed or lost a play-in, 1 lost round '
  'one or byed it, 2 lost the semi-final, 3 lost the final, 4 won the final. '
  'The champion stores 4 — the JSON stores 3 and adds one at render time.';
