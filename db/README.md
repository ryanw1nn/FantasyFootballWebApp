# db/

The database behind the app. The server reads these tables and nothing else, so
`npm start` needs the container running (`npm run db:up`) and exits non-zero
when it cannot reach it.

`src/data/seasons.json` stays in the repo as the import's input and the answer
key the API is diffed against. It is no longer written to, and it stops at 2025 —
seasons after that are created with `npm run db:season` and exist only in the
database. See [Seasons after the file](#seasons-after-the-file).

## Environment

These go in the gitignored env file at the repo root. It already holds
`VITE_API_URL`; add the rest.

| Key | Value |
| --- | --- |
| `DATABASE_URL` | `postgres://fanclub:fanclub@localhost:5433/fanclub` — the local container. Everything in `db/` reads this. |
| `POSTGRES_MAJOR` | The Postgres major version Neon gave you. Defaults to `18`; set it only if Neon differs. Compose reads it directly to pick the image tag. |
| `DATABASE_URL_PROD` | The Neon connection string. Deliberately **not** `DATABASE_URL`, so no script can reach production by accident before Phase 7. |

Never prefix a connection string with `VITE_` — Vite inlines those into the
public client bundle.

## Commands

```
npm run db:check     show which Postgres each key points at, and its version
npm run db:up        start the container, wait until it accepts connections
npm run db:status    list applied and pending migrations, change nothing
npm run db:migrate   apply pending migrations
npm run db:down      stop the container, keep the data
npm run db:reset     destroy the volume, recreate, re-migrate
npm run db:import    truncate every table and reload src/data/seasons.json
npm run db:recompute recompute stored standings from the matchup rows
npm run db:verify    diff the whole database against src/data/seasons.json
npm run db:season    create a season — roster, every week, empty pairings
npm run db:player    set a player's status across the seasons they played
npm run db:team      rename a player's team within one season
```

Standings are stored, computed by the write that changes them, and never
recalculated on a read. A row edited outside the app — in `psql`, or by a re-run
of `db:import` — therefore does not refresh them on the next page load:
`npm run db:recompute` is the repair tool after any manual edit.

The local container's credentials are `fanclub:fanclub` on localhost only. They
are development throwaways and intentionally in `docker-compose.yml`; the Neon
password lives only in the env file.

## Migrations

Numbered `.sql` files in `migrations/`, applied in filename order, each inside
its own transaction. `schema_migrations` records what has run.

- Never edit a migration that has been applied — the runner will not re-run it.
  Write a new file instead.
- The same `db:migrate` runs against Neon in Phase 7, so migrations are the only
  way the schema is ever changed. No hand-editing.

### Applied

| File | What it does |
| --- | --- |
| `001_initial_schema.sql` | The six tables from `docs/schema.md`. No data. |
| `002_season_level_config.sql` | Moves `regular_season_weeks` / `playoff_start_week` onto `seasons`; adds the `standings_are_imported` lock. |
| `003_derive_made_playoffs.sql` | `teams.made_playoffs` becomes `GENERATED ALWAYS AS (playoff_rounds >= 1)`. |

`001` was amended once, before it had ever been applied anywhere but a throwaway
local container — an audit against `seasons.json` found five defects. That
exception has now closed: Phase 1.3 onward, a change means a new numbered file.

Three type choices in `001` are load-bearing for the Phase 1.5 diff, and each is
commented in the file:

- **Every score and points total is `numeric(8,2)`**, never `double precision`.
  61 stored PF/PA values in the JSON carry float accumulation artifacts — 2021's
  leader is `pf: 1808.2600000000002`, where `numeric` sums the same scores to
  exactly `1808.26`. Verified against the real data, not assumed.
- **`standings.prev_place` is `smallint NULL`**, not `text`. Nine of 2020's rows
  hold an emoji today and `SeasonTable.jsx:56` subtracts the column, so they
  render `NaN` movement. They import as `NULL`, and those nine are the only
  intentional difference in the 1.5 diff.
- **Status columns are `text` + `CHECK`**, not `CREATE TYPE`. Widening a set is
  then an `ALTER` in a new migration rather than a type rewrite. `jake2020` is
  deliberately absent from `teams_status_known`, so a row still carrying it fails
  the import instead of reaching a standings table.

Four more choices exist because a 1:1 reading of the JSON would have been wrong:

- **`matchups.position`** — the one column with no counterpart in the JSON.
  `PlayoffBracket.jsx:50-70` splits a week into playoff/toilet/out by *slicing the
  array*, never by reading `status`, so array order is data. `ORDER BY position`
  in any query that feeds the bracket. `UNIQUE (season_id, week, position)` is
  also the table's only natural key — without it a re-imported week doubles.
- **`standings.playoff_stats` is nullable, with no zero default.** All 12 of
  2020's rows have no `playoffStats` key; zeroed buckets would claim they played
  playoff games and lost none.
- **Season-scoped foreign keys.** Matchups and standings reference
  `teams (id, season_id)` as a pair, so a team from another season cannot be
  linked in. `NULL` team ids skip the check, which keeps BYEs legal.
- **`players.display_name` is not globally unique.** The table is shared across
  leagues; two different people with the same display name is ordinary.
  Uniqueness is per-league and the import enforces it.

`002` exists because the schema doc's claim that all six seasons share one shape
was wrong: 2020 ran 12 regular-season games and a four-round, 12-team playoff,
against 14 and three rounds everywhere else. Season-level config is the general
fix — a league that changes format is the normal case, and this one already did.

`003` exists because `made_playoffs` and `playoff_rounds` disagreed in exactly
one of 72 rows, and that row was an error costing a real player three playoff
rounds in the all-time table.

## The import

`db/import.mjs` reads `src/data/seasons.json` into the tables above.
Truncate-and-reload, not an upsert: the JSON stays the source of truth until
Phase 2, so an edit made mid-phase means running it again. Everything happens in
one transaction — a run that fails anywhere leaves the previous contents
untouched.

A correct run prints exactly these counts, and rolls back rather than committing
if any of them is wrong:

| Table | Rows | The catch |
| --- | --- | --- |
| `leagues` | 1 | `fan-club`, template 14/15, 12 teams. |
| `players` | 15 | Not 16. `"Botted Season"` is a slot, not a person. |
| `seasons` | 6 | 2020 carries 12/13 and `standings_are_imported = true`; the rest 14/15. |
| `teams` | 72 | Exactly one with `player_id NULL`. |
| `matchups` | 515 | 505 with two named teams + 10 BYEs. **2020 imports none.** |
| `standings` | 72 | The file's own numbers, including 2020's hand-entered rows. |

Five things it does that a 1:1 reading of the JSON would not, each decided in
`docs/schema.md` and commented where it happens:

- `"Botted Season"` creates no player row — the team gets `player_id NULL` and
  `status = 'botted'`. It still plays matchups, so it is resolved by name like
  any other side.
- **`jake2020` → `active`.** The value does not exist after the import, and
  `App.jsx:143` reports 9 active teams for 2020 rather than 0.
- **`standings[]` wins** where the two copies disagree, which they do in 2025 —
  the same precedence as `server.js:221`'s `{...team, ...existingTeam}` spread.
  TJ Cairney is the 2025 champion.
- **Champions store `playoff_rounds = 4`**, not the JSON's 3. The script refuses
  to import a champion stored at anything other than 3, so the `+1` can never be
  applied twice.
- **2020 imports no matchups at all** — all 103 rows are dropped, which is why
  the file's 12 BYE rows land as 10.

Matchup sides are named by the entry's `name`, not by team name, because
`recalculateStandings` keys its stats object that way. Both are unique within a
season, so the lookup is exact and there is no fuzzy matching anywhere.

`position` is the row's index in the week array, stored because
`PlayoffBracket.jsx` slices rather than reading `status`.

The script is destructive and Phase 7 points `DATABASE_URL` at Neon, so it runs
as one word only against localhost. Any other host needs
`npm run db:import -- --yes`.

## Seasons after the file

`src/data/seasons.json` froze at 2025. Every season after it is created by
`db/new-season.mjs`, because nothing else can make one: the four routes read and
write matchups inside a season that already exists, and `EditSeasonPage` renders
the weeks it is handed and offers no way to add one.

```
npm run db:season -- --year 2026 \
      --drop "Max Strater" \
      --add "Patrick O'Donald:Patrick's Perfect Team"
```

It copies the previous season and writes four things:

| Table | What it gets |
| --- | --- |
| `seasons` | One row. Weeks come from the **league** template — the one thing `002` left those columns for. |
| `teams` | Last season's roster, minus `--drop`, plus `--add`, with `--rename`. Everyone `active`, no playoff rounds, no champion flags. A botted slot is never inherited. |
| `matchups` | Every week of the season with every pairing empty — `regular_season_weeks` × half the roster, then the previous season's playoff rows. |
| `standings` | A zero row per team, so the season renders a 0-0-0 table instead of an empty one until the first week is scored. |

The matchups are the point. A week exists in a payload only because some row
carries its number, so a season with no matchup rows has no weeks at all and
none of them can be opened in the editor. Laying all 17 out at creation is what
makes the season enterable from the app on day one.

Three things worth knowing:

- **Both sides of a seeded row are `NULL`, and that is not a BYE.** The file only
  ever had "no opponent", which `server/serialize.mjs` spells `"BYE"` and
  `EditSeasonPage` renders as uneditable text — a whole season of those would be
  impossible to fill in. A row that is null on *both* sides now serializes as
  `null`, which the editor renders as a team dropdown. One side null still says
  `"BYE"`, which is the real thing: the #1 and #2 seeds in week 15. Nothing
  imported from the file is null on both sides, so the parity gate never sees
  this branch.
- **The playoff weeks are copied, not invented.** Their `status` and `label`
  values are the bracket's wiring, and `position` has to come with them because
  `PlayoffBracket.jsx` splits a week by slicing the array rather than by reading
  `status`. Teams and scores do not come across — nobody has seeded yet.
- **`--replace` rebuilds a season, but never a played one.** It refuses if any
  matchup carries a score. Players are resolved *before* the delete, so replacing
  the season somebody was added in reuses their row instead of making a second
  one.

`--dry-run` does the whole thing and rolls back, so a roster can be checked
before it lands.

### Renaming a team mid-season

`db:season` takes `--rename` while it is building a season, but it refuses to
rebuild one that has been played. Once a score is in, the rename happens in
place:

```
npm run db:team -- --year 2026 --rename "Keith John:EPA THI"
```

It updates one column and nothing else, which is worth stating because it looks
like it should be more. Matchups and standings both reference teams by **id**,
and a matchup side in the legacy payload is the player's `display_name` rather
than the team name — so no game moves, no score is touched, and **no
`db:recompute` is needed**: the standings row serializes its name by reading the
team row, so the change shows up on the next request. The team name appears in
`teams[]` and `standings[]` and nowhere else.

It names the **player**, not the old team, because that is the part that does
not change. Renaming the person is a different thing with a different blast
radius — `display_name` lives on `players` and is shared across every season
they played — and this script will not do it.

### Corrections the import cannot make

`db:import` reproduces `seasons.json` exactly and that file is frozen — the
parity gate checks its checksum. A correction decided after it stopped being
written therefore cannot go in it, and lives as a script instead.

```
npm run db:player -- --player "Max Strater" --status inactive
```

`teams.status` is stored per team-season, but the league has always used it to
say something about the person: Michael Cassidy carries `inactive` on all five
of his rows and Aaron Griffith on all three, in every season they played, because
they left. `App.jsx:96` filters on it and `inactive` is off by default, so this
is how somebody stops crowding the season and all-time tables once they are gone.
It is scoped to one league, because `display_name` is not globally unique, and
refuses a name that means two people.

### Applied to the live database

In order, after `db:migrate` + `db:import` + `db:recompute`. Phase 7 replays them
against Neon.

| When | Command |
| --- | --- |
| 2026 preseason | `npm run db:season -- --year 2026 --drop "Max Strater" --add "Patrick O'Donald:Patrick's Perfect Team"` |
| 2026 preseason | `npm run db:player -- --player "Max Strater" --status inactive` |
| 2026 week 1 | `npm run db:team -- --year 2026 --rename "Josh Whelan:Fat Stafford" --rename "Jake Strater:Bear Force One" --rename "Jimmy Beer:CMC and friends" --rename "TJ Cairney:Tonathan Jaylor"` |

The scores themselves are **not** in this table and cannot be — they are entered
through the app and exist only in the database. Replaying this ledger after an
import rebuilds the league's structure, not its results, which is the other half
of why `db:import` must not be run against a database holding a live season.

## The standings port

`db/standings.mjs` is `server.js`'s `recalculateStandings`, reading matchup rows
instead of a JSON object. `npm run db:recompute` runs it over every season of a
league in one transaction; `npm run db:recompute -- --dry-run` does the same and
rolls back, so it reports what a real run would do without being a separate,
less-tested code path.

`db:import` loads the file's own standings verbatim. `db:recompute` replaces
2021–2025 with what the matchups actually produce — and produces the same
numbers, 60 rows with no field differing from the file at two decimals.

Two exports, and the split matters:

- `computeStandings(client, seasonId)` returns rows and writes nothing. `null`
  when no week has been scored yet, which is the early return that stops a
  season with no data getting an all-zero table.
- `writeStandings(client, seasonId)` recomputes and replaces the rows. It issues
  no `BEGIN` and no `COMMIT` — **the caller owns the transaction**, which is the
  whole point: a matchup edit and the standings it changes land together or not
  at all.

The five behaviours of the original that the port has to keep are listed at the
top of the file. Three things about it are worth knowing here:

- **Totals accumulate in integer hundredths, not floats.** Scores arrive from
  `numeric(8,2)` as fixed-scale strings. Summing them as hundredths means 2021's
  leader totals to exactly `1808.26` rather than the `1808.2600000000002` the
  JSON holds — the artifact is never produced, rather than rounded away later.
- **Places are deterministic.** Wins descending, then PF descending, then team
  id — which is the order the season lists its teams, and the tiebreak the JSON
  version had by accident through sorting the `teams[]` array. Nothing is left
  to the order rows come back in.
- **A season with `standings_are_imported` is refused by the writer itself**,
  not by its callers. 2020 has no scores to derive anything from, and the check
  sits where no future caller can route around it.

`seasons.regular_season_weeks` is not read by this calculation at all — only
`playoff_start_week` decides anything. The column belongs to season creation and
the bracket, not to standings.

## The verification

`npm run db:verify` is the Phase 1 gate: it diffs every standings row in the
database against `src/data/seasons.json` and exits non-zero on any difference it
was not told to expect. It is read-only — no transaction, no writes — so it is
safe to point at any database, production included.

It runs straight after `db:migrate` and `db:import`. `db:recompute` is **not** a
prerequisite: the computed side is produced inside the check rather than read
back out of the table.

A season the file does not hold is **skipped and named**, not a failure: 2026
onward postdate `seasons.json` and were never imported, so "the imported history
matches the file" does not reach them. The output says so per year and in the
total, which is why a year that goes *missing* from the file still shows up.

The six seasons are not compared the same way, because they are not the same
kind of data:

| Seasons | Compared against | Why |
| --- | --- | --- |
| 2021–2025 | **computed** from the matchup rows | The real claim — that the imported matchups reproduce the standings the file holds. |
| 2020 | **imported**, the stored rows | All 103 of its matchups carry `null` scores. Its records, points and places were entered by hand and were never derived from anything, so no correct implementation can reproduce them. A run that "successfully" computed 2020 has invented it. |

Every field is diffed for all 72 team-seasons: wins, losses, ties, PF, PA,
`place`, `prev_place`, and all three `playoff_stats` buckets. `place` especially
— it comes out of a sort, so an ordering bug appears there and nowhere else.

Two things keep the diff honest rather than merely empty:

- **Rounding is applied to the JSON side only.** 61 stored PF/PA values carry
  float accumulation artifacts — 2021's leader is `pf: 1808.2600000000002`.
  `numeric(8,2)` and the hundredths arithmetic in `standings.mjs` both land on
  exactly `1808.26`, so the database side has nothing to round, and rounding
  both sides would hide a real defect instead of a known artifact.
- **The nine emoji are whitelisted one by one, not tolerated as a class.**
  `prevPlace` is carried across exactly as the file holds it, medals included,
  so those nine rows come out as genuine differences and are then named
  individually. The check fails if there are not exactly nine, if any is outside
  2020, or if any other column on those rows differs.

`playoff_stats` is compared bucket by bucket and field by field, so `jsonb` key
reordering — Postgres returns `{playoff, toilet, out}` as `{out, playoff,
toilet}` — cannot produce a phantom difference. A missing object and a zeroed
one are still different things: 2020's rows are absent, and a zeroed bucket
claiming it played playoff games and lost none is reported.

The check is a permanent command, not a one-off script. Phase 2 changes the read
path and Phase 7 runs the import against Neon; both want it available.

### What it reports today

```
  2020  12 rows  imported identical
  2021  12 rows  computed identical
  ...
  72 team-seasons compared.
  Expected differences — 9 prev_place emoji imported as NULL
```

Phase 1 is closed. All four routes still read `seasons.json`; the cutover is
Phase 2.
