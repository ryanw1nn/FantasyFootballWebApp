-- 005_team_managers.sql — a team can have more than one manager.
--
-- Until now a team was "one player's entry in one season": teams.player_id. A
-- co-managed team is two people sharing one entry, and each of them is credited
-- with all of it — the team's record, points and titles count toward both
-- careers, and each keeps their own player page. When the two later split up or
-- join other teams, their histories carry on separately, because the person is
-- the players row and the pairing is only ever a season's.
--
-- So who managed a team moves to its own table, one row per person per team.
-- position orders them the way the league lists them ("Alex & Blake", never
-- "Blake & Alex" one season and the reverse the next).
--
-- A botted slot is still a team with nobody behind it: it has no rows here.
-- That rule used to be a CHECK on teams; a CHECK cannot see another table, so
-- the code that writes teams keeps it, as it already did for every other rule
-- about who is on a roster.
--
-- This is the expand half of a two-step change, because migrations run before
-- the deploy (docs/deploy.md (d)) and the running code must tolerate the new
-- schema in between. teams.player_id stays for now, and the new code keeps it
-- equal to the first manager, so a rollback to the old code still reads a
-- correct roster. A later migration drops it once nothing reads it.

CREATE TABLE team_managers (
  team_id   integer  NOT NULL,
  season_id integer  NOT NULL,
  player_id integer  NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  position  smallint NOT NULL,

  PRIMARY KEY (team_id, player_id),
  -- The pair, like matchups and standings: a manager row cannot point a team
  -- into a season it is not in.
  CONSTRAINT team_managers_team_fk
    FOREIGN KEY (team_id, season_id) REFERENCES teams (id, season_id) ON DELETE CASCADE,
  -- What teams_season_player_unique said: a person manages one team a season.
  CONSTRAINT team_managers_season_player_unique UNIQUE (season_id, player_id),
  CONSTRAINT team_managers_position_unique      UNIQUE (team_id, position),
  CONSTRAINT team_managers_position_range       CHECK (position >= 0)
);

CREATE INDEX team_managers_player_idx ON team_managers (player_id);

INSERT INTO team_managers (team_id, season_id, player_id, position)
SELECT id, season_id, player_id, 0
  FROM teams
 WHERE player_id IS NOT NULL;

COMMENT ON COLUMN teams.player_id IS
  'Deprecated by 005: team_managers is who managed a team. Kept equal to the '
  'first manager until a later migration drops it, so the code before 005 still '
  'reads a correct roster.';
