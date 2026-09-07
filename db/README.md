# db/

Phase 1 of the multi-league migration. Nothing here is wired into `server.js` —
the app still reads `src/data/seasons.json`. The cutover is Phase 2.

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
```

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
