# Target Schema — Phase 0 Decision Record

Frozen 2026-08-25. Every decision here is one that costs a second migration to
reverse. Phase 1's import script is written against this document.

## Decisions

| Question | Answer |
| --- | --- |
| Database | Neon Postgres (managed). Standings computed on write, stored. |
| Existing league slug | `fan-club` — permanent, appears in every URL as `/l/fan-club/…` |
| Real names | Public. `real_name` is still a separate column from day one. The repo is already public on GitHub, so the 15 names are public today regardless. |
| League two | Separate people, no roster overlap with `fan-club`. |
| `jake2020` | Dropped. It was `active` with a corrupted value. |
| League creation | Not self-serve. Provisioned by inserting a row. |
| Host | Render web service, single origin — Express serves the API and the built `dist/`. |

### Why `jake2020` is just `active`

All 9 teams carrying `jake2020` in 2020 belong to the 9 people still playing in
2025. The 3 teams marked `inactive` that year (Aaron Griffith, Ben Jordan,
Michael Cassidy) are exactly the ones who left. It encoded no era and no second
league. The import maps `jake2020` → `active` and the value ceases to exist.

This also fixes a live bug: `src/App.jsx:143` counts `team.state === 'active'`,
so 2020 currently reports **0 active teams**. After the import it reports 9.

### `botted`

One team, 2023 — `{"team": "Fallen Griffiths", "name": "Botted Season"}`. An
abandoned slot, not a person. `"Botted Season"` **must not create a player row**;
there are 16 distinct `name` values in the data but only **15 real people**. The
team row gets `player_id NULL` and `status = 'botted'`.

### Status enum

`active` | `inactive` | `botted`. Nothing era-shaped in it.

## `playoff_rounds` — the ladder

A rung reached, not games won and not weeks appeared in:

| Rungs | Meaning |
| --- | --- |
| 0 | Eliminated in the regular season, or lost a preliminary play-in round |
| 1 | Made the first round and lost it, **or** had a first-round bye |
| 2 | Won the first round (or byed past it), lost the semi-final |
| 3 | Lost the championship game |
| 4 | Won the championship game |

**The database stores the true rung, so a champion is 4.** The JSON stores 3 for
champions — identical to the runner-up — and `AllTimeTable.jsx:139` adds the
missing `+1` at display time (`if (row.playoff.pChampion) rounds += 1`). The
import resolves that: `playoff_rounds` means what this table says, standing
alone, with no reader-side arithmetic.

> **Cross-phase hazard.** The `+1` in `AllTimeTable.jsx:139` must be deleted in
> the same change that cuts the client over to the database (Phase 2/6). If the
> column says 4 and the client still adds one, champions render as 5. Until the
> cutover the client reads the JSON and is unaffected.

Verified against all six seasons: every stored value already matches this ladder
except champions. `playoff_rounds` is never derived — `recalculateStandings`
preserves it through the `{...team, ...existingTeam}` spread, so it is
hand-maintained data. That is why varying bracket shapes cost the standings
logic nothing: it only ever needs `playoff_start_week`.

### 2020's extra round

2020 was a 12-team tournament — everybody in — with byes for the top four and
four rounds. Its first round is a **play-in that awards no rung**: lose it and
you sit at 0. That reproduces the stored distribution exactly:

| Stored rungs | Teams | Went out |
| --- | --- | --- |
| 0 | 4 | Lost the play-in |
| 1 | 4 | Lost round two |
| 2 | 2 | Lost the semi-final |
| 3 | 2 | Reached the final (champion stores 4 on import) |

Every other season is a 6-team bracket with byes for the top two and three
rounds. Nothing about this needs a format column: a bracket is fully described by
its `matchups` rows, and 2020's extra round is just rows in an earlier week.

## League config (pinned from the data)

Uniform across all six seasons, 2020–2025:

| Column | Value |
| --- | --- |
| `regular_season_weeks` | 14 for 2021–2025, **12 for 2020** |
| `playoff_start_week` | 15 for 2021–2025, **13 for 2020** |
| `team_count` | 12 |

**Not uniform, contrary to what this table originally claimed.** 2020 ran a
12-game regular season and a four-round playoff; 2021–2025 run 14 games and
three rounds. Migration `002` therefore moves `regular_season_weeks` and
`playoff_start_week` onto `seasons`, where the shape actually belongs. The
`leagues` columns of the same name survive as the template a new season is
created from, and nothing reads them at compute time — a season is authoritative
about its own shape, with no `COALESCE` and no fallback.

`recalculateStandings` hardcodes `weekNum >= 15`; it reads these from the season
row instead.

## Tables

```
leagues     id, slug, name, playoff_start_week, regular_season_weeks,
            team_count, write_secret_hash, is_public

players     id, display_name, real_name
            -- 15 rows on import; display_name == real_name initially

seasons     id, league_id -> leagues, year,
            regular_season_weeks, playoff_start_week,   -- per season, not league
            standings_are_imported                      -- the 2020 lock
            UNIQUE (league_id, year)

teams       id, season_id -> seasons, player_id -> players NULL,
            team_name, status,               -- active | inactive | botted
            playoff_rounds, is_playoff_champ, is_regular_champ
            made_playoffs                    -- GENERATED (playoff_rounds >= 1)

matchups    id, season_id -> seasons, week, position, status NULL, label,
            team1_id NULL, team1_score, team2_id NULL, team2_score
            -- status NULL = regular season
            -- team*_id NULL = BYE
            -- position = array order in the JSON; the bracket reads it
            UNIQUE (season_id, week, position)

standings   season_id, team_id, wins, losses, ties, pf, pa,
            place, prev_place, playoff_stats jsonb NULL

session     -- created by connect-pg-simple
```

### `matchups.position`

The one column with no counterpart in the JSON, and it is not bookkeeping.
`PlayoffBracket.jsx:50-70` splits a week into playoff / toilet / out by **slicing
the array** — week 15 is `slice(0, 4)`, `slice(4, 6)`, `slice(6)` — and never
reads `status`. Array order is therefore data. Store the 0-based index and
`ORDER BY position` in every query that feeds the bracket.

`UNIQUE (season_id, week, position)` is also the only natural key the table has.
Without it, re-importing a week silently doubles it.

### Which copy wins: `standings[]`, not `teams[]`

The JSON stores `team`, `name`, `state`, `rChampion`, and `playoff.{made,rounds,
pChampion}` **twice** — once in `teams[]`, once in `standings[]`. The schema keeps
one copy, on `teams`. They agree in 2020–2024 and **disagree in 2025**:

| Field | `teams[]` | `standings[]` |
| --- | --- | --- |
| TJ Cairney `playoff.rounds` | 2 | **3** |
| TJ Cairney `playoff.pChampion` | false | **true** |
| Max Strater `playoff.rounds` | 2 | **3** |

**`standings[]` is correct — TJ Cairney won the 2025 playoffs.** So the import
reads these fields from `standings[]` where a row exists and falls back to
`teams[]` otherwise, which is also what `server.js:221` already does: the
`{...team, ...existingTeam}` spread lets the standings copy win, and win stickily
— once a standings row exists, edits to `teams[]` never surface again.

This closes a live split-brain bug. `AllTimeTable.jsx:117-139` reads standings
while `PlayerStatsPage.jsx:251` reads teams, so the two pages currently disagree
about whether TJ Cairney won 2025. After the import there is one row and one
answer.

## Field mapping

| JSON | Column |
| --- | --- |
| `teams[].team` | `teams.team_name` |
| `teams[].name` | `players.display_name` + `players.real_name` |
| `teams[].state` | `teams.status` (`jake2020` → `active`) |
| `teams[].playoff.made` | `teams.made_playoffs` |
| `teams[].playoff.rounds` | `teams.playoff_rounds` |
| `teams[].playoff.pChampion` | `teams.is_playoff_champ` |
| `teams[].rChampion` | `teams.is_regular_champ` |
| `weeks.<n>.matchups[]` | `matchups` rows, `week = <n>` |
| `standings[].playoffStats` | `standings.playoff_stats` (jsonb) |

### 2020 imports no matchups at all

All 103 of 2020's matchup rows are dropped, and the season carries only teams and
standings. 84 are entirely empty. The remaining 19 carry playoff labels and
statuses — and those labels are **byte-identical to the 2024 template**, while
2021, 2022 and 2023 each differ from it and from each other. They were copied
from a later season's grid; they describe a 6-team, three-round bracket with byes
for the top two seeds, which is not what 2020 played. Importing them would put a
fabricated bracket in the database.

This includes 2020's two `"#1 SEED VS BYE"` rows, so the file's 12 BYE matchups
import as **10**, two per season for 2021–2025.

`PlayoffBracket.jsx:147` already refuses to render 2020, so nothing reads them.

### BYE

12 BYE matchups exist — exactly 2 per season, always week 15, always the #1 and
#2 seeds. Stored today as the literal string `"BYE"` in `team2` with a null
score. On import: `team2_id = NULL`, `team2_score = NULL`, `label` preserved
(`"#1 SEED VS BYE"`). Standings logic must skip null-opponent matchups rather
than treating them as a win.

### `made_playoffs` is derived

`GENERATED ALWAYS AS (playoff_rounds >= 1) STORED`, so it cannot be written and
cannot drift. The flag has always meant **advanced past the first round**, not
*qualified for the bracket* — 2020 is the proof, where all 12 teams were in the
tournament and the four carrying `made = false` are the four that lost the
play-in.

Across all 72 team-seasons, `made === (rounds >= 1)` holds in 71. The exception
is an error, not a second meaning:

> **2021 Josh Whelan** — #2 seed, first-round bye, won the semi-final, lost the
> Super Bowl. Stored `rounds: 3` with `made: false`, in *both* the `teams[]` and
> `standings[]` copies. `AllTimeTable.jsx:137` gates on the flag before adding
> rounds, so his three 2021 playoff rounds are missing from his all-time total
> today. Deriving the column fixes the row on import.

Given up: "qualified for the bracket" is no longer expressible, so 2020's twelve
entrants cannot be recorded as such. It stays derivable from the matchup rows,
and a `playoff_qualified` column can be added if a playoff-appearances stat ever
wants it.

### `playoff_stats`

Stays `jsonb`. Three fixed buckets — `playoff`, `toilet`, `out` — each with
`wins`/`losses`/`ties`/`pf`/`pa`. Promoting 15 scalar columns buys nothing while
the shape is derived on write and read whole.

**Nullable, with no zero default.** All 12 of 2020's standings rows carry no
`playoffStats` key at all. A default of zeroed buckets would assert they played
playoff games and lost none — inventing data for the one season the Phase 1.5
gate requires to match what was *imported*. `NULL` means "not recorded", zeros
mean "recorded, played none", and readers handle both. A `CHECK` still forbids a
partial object: present or absent, never half.

### Season-scoped foreign keys

`matchups.team1_id`/`team2_id` and `standings.team_id` reference
`teams (id, season_id)` as a pair, not `teams (id)` alone, so a team from another
season cannot be linked into this one. `teams` carries a redundant
`UNIQUE (id, season_id)` purely to be a valid target. A `NULL` team id skips the
check under `MATCH SIMPLE`, which is what keeps BYEs and 2020's team-less rows
legal.

### `players.display_name` is not globally unique

This table is shared across leagues and league two is separate people. Two
different people with the same display name is ordinary, and a global `UNIQUE`
would make one of them unrepresentable. Uniqueness is per-league, which no
constraint can express while league membership is implied by `teams` rather than
stored — the import enforces it within a league. A real constraint arrives with a
`league_players` link table, if leagues ever need to share a roster.

## Hosting

Render web service + Neon Postgres, one origin. Express serves both the API and
the built `dist/`, which is what deletes the CORS problem rather than
reconfiguring it — `CORS_ORIGIN` is currently pinned to `http://localhost:5173`.

Rejected:

- **GitHub Pages** — static only. No Node process, so no Express, no Postgres, no
  write route, no sessions. Using it for the frontend alone would reintroduce two
  origins, and with them CORS plus `SameSite=None; Secure` cookies.
- **Render's free Postgres** — expires 30 days after creation. Wrong failure mode
  for six years of history.

Neon's free tier keeps a short restore window (on the order of a day), which
covers fat-finger recovery, not archival. It does **not** replace the scheduled
`pg_dump` to off-host storage in Phase 7.

## Status

Phase 0 is complete. This document is realized in
`db/migrations/001_initial_schema.sql` through `003_derive_made_playoffs.sql`,
and every decision in it is now exercised by `db/import.mjs` — the six seasons
sit in the local container, and every row round-trips back to the JSON. Change
the schema only by adding a numbered migration; never by editing an applied file
or hand-editing a database.

Two things the migration pins that this document left open, both because the
Phase 1.5 diff depends on them: every score and points total is `numeric(8,2)`
rather than a float, and `standings.prev_place` is `smallint NULL` rather than
`text` — see `db/README.md` for why each one is load-bearing.

**Resolved in Phase 1.3: 2020's 17 labeled placeholder rows are dropped.** They
carry a playoff `label` and `status` but no teams, and the labels are
byte-identical to the 2024 template — a 6-team, three-round bracket, which is not
what 2020 played. Keeping them would preserve a bracket shape the season never
had. All 103 of 2020's matchups are dropped, so the import writes 515 rows and
`PlayoffBracket.jsx:147`'s refusal to render 2020 remains correct rather than
incidental.

Still open, not blocking:

- League two's name and slug, when known.
- The 8 `backups/*.json` files are gitignored, so they live only in the local
  snapshot at `~/fantasy-football-backups/phase0-snapshot-20260825-160642/`.
  `src/data/seasons.json` itself is already pushed to GitHub, so it is not at
  risk. Both concerns end in Phase 7 when `pg_dump` takes over.

## Phase 1 added

`pg` and `dotenv` (not `body-parser` — it was unimported; `express.json()` was
doing the work), a migration runner at `db/migrate.mjs`, and the import at
`db/import.mjs`. Local Postgres 18.6 via Docker Compose on host port 5433,
matching Neon's 18.6. No new dependency arrived with the import.
