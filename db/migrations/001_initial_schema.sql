-- 001_initial_schema.sql — the tables from docs/schema.md.
--
-- Nothing reads these yet: server.js still serves src/data/seasons.json for the
-- whole of Phase 1. The import script (1.3) fills them, and db:verify (1.5)
-- diffs them against the JSON.
--
-- Types worth knowing about before you read further:
--   * every score and points total is numeric(8,2), never a float. The Phase 1.5
--     gate is an exact diff, and 61 stored PF/PA values in the JSON carry float
--     accumulation artifacts (2021's leader is pf: 1808.2600000000002). numeric
--     sums the same scores to exactly 1808.26 — the right answer, reachable only
--     if nothing in the chain is double precision.
--   * standings.prev_place is smallint NULL, not text. Nine of 2020's rows hold
--     an emoji today (🥇 🥈 🥉 ✨ 💩) and SeasonTable.jsx:56 subtracts the column,
--     so those rows render NaN movement. They import as NULL.
--   * status columns are text + CHECK rather than CREATE TYPE, so widening a set
--     is an ALTER in a new migration instead of a type rewrite.
--   * matchups.position stores array order, because PlayoffBracket.jsx reads it.
--     See the table below — this is the one column with no counterpart in the
--     JSON, and the bracket is wrong without it.

-- ---------------------------------------------------------------------------
-- leagues — the level that does not exist in the JSON at all
-- ---------------------------------------------------------------------------
-- playoff_start_week and regular_season_weeks are columns because they are
-- hardcoded in recalculateStandings today (weekNum >= 15) and league two will
-- not share them.

CREATE TABLE leagues (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                 text     NOT NULL UNIQUE,
  name                 text     NOT NULL,
  playoff_start_week   smallint NOT NULL,
  regular_season_weeks smallint NOT NULL,
  team_count           smallint NOT NULL,
  -- NULL until Phase 3 sets a passphrase. A NULL hash must never authorize a
  -- write; the middleware, not this column, is the control.
  write_secret_hash    text,
  is_public            boolean  NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leagues_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT leagues_weeks_ordered CHECK (playoff_start_week > regular_season_weeks),
  CONSTRAINT leagues_team_count_positive CHECK (team_count > 0)
);

-- ---------------------------------------------------------------------------
-- players — a person, stable across seasons
-- ---------------------------------------------------------------------------
-- 15 rows on import, not 16: "Botted Season" is an abandoned 2023 slot and gets
-- no player row. real_name is split from display_name on day one even though the
-- decision is that real names are public, so reversing it stays a render change.

-- display_name is deliberately NOT globally unique. This table is shared across
-- leagues, and league two is separate people — two different people with the
-- same display name is a thing that happens, and a global UNIQUE would make one
-- of them unrepresentable. Uniqueness is per-league, which no constraint here
-- can express while a player's league membership is implied by teams rather than
-- stored; the import enforces it within a league. A real constraint arrives with
-- a league_players link table, if leagues ever need to share a roster.

CREATE TABLE players (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name text NOT NULL,
  real_name    text
);

CREATE INDEX players_display_name_idx ON players (display_name);

-- ---------------------------------------------------------------------------
-- seasons
-- ---------------------------------------------------------------------------

CREATE TABLE seasons (
  id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id integer  NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
  year      smallint NOT NULL,

  CONSTRAINT seasons_league_year_unique UNIQUE (league_id, year),
  CONSTRAINT seasons_year_plausible CHECK (year BETWEEN 1900 AND 2200)
);

-- ---------------------------------------------------------------------------
-- teams — one player's entry in one season
-- ---------------------------------------------------------------------------
-- Both UNIQUEs exist to catch the mistake an import script actually makes: a
-- duplicated row. UNIQUE (season_id, player_id) still tolerates the botted team
-- because Postgres treats NULLs as distinct — and there is only ever one such
-- row per season anyway.

CREATE TABLE teams (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id        integer NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
  -- NULL only for a botted slot, which is a team without a person.
  player_id        integer REFERENCES players (id) ON DELETE RESTRICT,
  team_name        text     NOT NULL,
  status           text     NOT NULL,
  made_playoffs    boolean  NOT NULL DEFAULT false,
  playoff_rounds   smallint NOT NULL DEFAULT 0,
  is_playoff_champ boolean  NOT NULL DEFAULT false,
  is_regular_champ boolean  NOT NULL DEFAULT false,

  CONSTRAINT teams_season_name_unique   UNIQUE (season_id, team_name),
  CONSTRAINT teams_season_player_unique UNIQUE (season_id, player_id),
  -- Redundant on its own — id is already the primary key — but it is what lets
  -- matchups and standings reference (team_id, season_id) as a pair, so a team
  -- from another season cannot be linked into this one.
  CONSTRAINT teams_id_season_unique     UNIQUE (id, season_id),
  -- jake2020 is deliberately absent: the import maps it to active and the value
  -- ceases to exist. A row carrying it is an import bug, so let it fail here.
  CONSTRAINT teams_status_known CHECK (status IN ('active', 'inactive', 'botted')),
  CONSTRAINT teams_botted_has_no_player CHECK (status <> 'botted' OR player_id IS NULL),
  CONSTRAINT teams_playoff_rounds_range CHECK (playoff_rounds >= 0)
);

CREATE INDEX teams_player_idx ON teams (player_id);

-- ---------------------------------------------------------------------------
-- matchups
-- ---------------------------------------------------------------------------
-- status NULL is the regular season. Weeks 1-14 in the JSON omit the status and
-- label keys entirely rather than storing an empty value, so the import inserts
-- NULL for both and the CHECK below is the whole truth about the column.
--
-- position is array order within the week, 0-based, and it is real data rather
-- than bookkeeping: PlayoffBracket.jsx:50-70 splits a week into playoff / toilet
-- / out by SLICING THE ARRAY (week 15 is slice(0,4), slice(4,6), slice(6)), not
-- by reading status. Rows returned in another order render the wrong bracket, so
-- every query that feeds the bracket must ORDER BY position. The UNIQUE below is
-- also the only natural key this table has — without it, re-importing a week
-- silently doubles it.
--
-- A null team id is a BYE. 12 rows are one-sided (week 15, the #1 and #2 seeds),
-- and 2020's two are null on *both* sides — the seeds were never filled in but
-- the label is worth keeping. Standings logic skips a matchup with a null
-- opponent instead of booking it as a win.

CREATE TABLE matchups (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id   integer  NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
  week        smallint NOT NULL,
  position    smallint NOT NULL,
  status      text,
  label       text,
  team1_id    integer,
  team1_score numeric(8, 2),
  team2_id    integer,
  team2_score numeric(8, 2),

  -- Season-scoped: a team id is only valid if that team plays in this season.
  -- A NULL team id skips the check (MATCH SIMPLE), which is what lets a BYE and
  -- 2020's two team-less rows through.
  CONSTRAINT matchups_team1_fk FOREIGN KEY (team1_id, season_id)
    REFERENCES teams (id, season_id) ON DELETE RESTRICT,
  CONSTRAINT matchups_team2_fk FOREIGN KEY (team2_id, season_id)
    REFERENCES teams (id, season_id) ON DELETE RESTRICT,

  CONSTRAINT matchups_season_week_position_unique UNIQUE (season_id, week, position),
  CONSTRAINT matchups_week_positive CHECK (week >= 1),
  CONSTRAINT matchups_position_nonnegative CHECK (position >= 0),
  CONSTRAINT matchups_status_known CHECK (status IS NULL OR status IN ('playoff', 'toilet', 'out')),
  CONSTRAINT matchups_distinct_teams CHECK (team1_id IS NULL OR team1_id <> team2_id),
  CONSTRAINT matchups_scores_nonnegative CHECK (
    (team1_score IS NULL OR team1_score >= 0) AND (team2_score IS NULL OR team2_score >= 0)
  )
);

CREATE INDEX matchups_season_week_idx ON matchups (season_id, week, position);
CREATE INDEX matchups_team1_idx ON matchups (team1_id);
CREATE INDEX matchups_team2_idx ON matchups (team2_id);

-- ---------------------------------------------------------------------------
-- standings — computed on write, not on every read
-- ---------------------------------------------------------------------------
-- The point of the whole table: GET /seasons currently recalculates every
-- season's standings on every request. Phase 2 writes these inside the same
-- transaction as the matchup edit that changed them.
--
-- 2020 is the exception the Phase 1.5 gate is built around. It has no scores at
-- all, so its rows are hand-entered numbers that no correct implementation can
-- derive; they are imported literally.

CREATE TABLE standings (
  season_id     integer  NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
  team_id       integer  NOT NULL,
  wins          smallint NOT NULL DEFAULT 0,
  losses        smallint NOT NULL DEFAULT 0,
  ties          smallint NOT NULL DEFAULT 0,
  pf            numeric(8, 2) NOT NULL DEFAULT 0,
  pa            numeric(8, 2) NOT NULL DEFAULT 0,
  place         smallint NOT NULL,
  -- NULL where the JSON held an emoji, and for a team's first ranked week.
  prev_place    smallint,
  -- Nullable, with no zero default. All 12 of 2020's standings rows have no
  -- playoffStats key at all, and a bucket of zeros would claim they played
  -- playoff games and lost none — inventing data for the one season the Phase
  -- 1.5 gate requires to match what was imported. NULL means "not recorded";
  -- zeros mean "recorded, played none". Readers must handle NULL.
  playoff_stats jsonb,

  CONSTRAINT standings_pkey PRIMARY KEY (season_id, team_id),
  CONSTRAINT standings_team_fk FOREIGN KEY (team_id, season_id)
    REFERENCES teams (id, season_id) ON DELETE CASCADE,
  CONSTRAINT standings_team_unique UNIQUE (team_id),
  CONSTRAINT standings_record_nonnegative CHECK (wins >= 0 AND losses >= 0 AND ties >= 0),
  CONSTRAINT standings_points_nonnegative CHECK (pf >= 0 AND pa >= 0),
  CONSTRAINT standings_place_positive CHECK (place >= 1),
  CONSTRAINT standings_prev_place_positive CHECK (prev_place IS NULL OR prev_place >= 1),
  -- Present or absent, never partial.
  CONSTRAINT standings_playoff_stats_buckets CHECK (
    playoff_stats IS NULL OR playoff_stats ?& array['playoff', 'toilet', 'out']
  )
);
