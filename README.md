# The Fan Club

A dashboard for one fantasy football league's history: seven seasons of standings,
weekly matchups, playoff brackets, per-player careers and all-time totals, plus an
editor for entering scores as the season runs.

The data lives in Postgres. Reading is open to anyone; every write needs the
league's passphrase.

## Stack

- **Client** — React 19 + React Router 7, Vite 7, Tailwind 3, Lucide icons. Every
  derived number (records, PF/PA, awards, brackets) is computed by pure functions
  under `src/stats/`, which is why they can be exercised without a browser.
- **Server** — Express 5, `express-session` with `connect-pg-simple` (sessions
  live in Postgres, not in memory), `helmet`, `compression`, and
  `express-rate-limit` on the unlock.
- **Database** — Postgres 18, reached through `pg`. Schema changes are numbered
  SQL files under `db/migrations/`, applied by `npm run db:migrate`.

In production Express serves the built client and the API from **one origin**, so
there is no CORS configuration and no second host to deploy.

## Running it locally

Prerequisites: Node **24 or newer** (`engines` enforces it) and Docker for the
database.

```bash
npm install
npm run db:up                 # Postgres 18 in Docker, on localhost:5433
npm run db:migrate            # apply db/migrations/ in order
npm run db:import             # load src/data/seasons.json into an empty database
npm run db:recompute          # derive standings from the matchups
npm run dev                   # Vite on 5173; in another shell, npm start for the API on 5001
```

Configuration comes from the environment, and none of it belongs in a commit:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | the local database, on `localhost:5433` |
| `DATABASE_URL_PROD` | the production database, read only by commands you type deliberately |
| `SESSION_SECRET` | 32+ random characters; the server refuses to boot without one |
| `VITE_API_URL` | optional. Left unset, the client calls the API on its own origin, which is what production does |

Nothing prefixed `VITE_` can be a secret: Vite inlines those into the bundle every
visitor downloads.

To run the way production does, build the client and let Express serve it:

```bash
npm run build && npm start     # everything on http://localhost:5001
```

Or build the image, which is what the host runs:

```bash
docker build -t fanclub .
docker run -p 5001:5001 -e DATABASE_URL=… -e SESSION_SECRET=… fanclub
```

## The URLs

The client is a single-page app. Every view carries its league, and the year is a
query parameter so it survives a switch between views:

| URL | Opens |
| --- | --- |
| `/l/:slug/season?year=2026` | standings and season stats |
| `/l/:slug/alltime` | the all-time table, across every season |
| `/l/:slug/bracket?year=2026` | the playoff bracket |
| `/l/:slug/edit?year=2026` | the score editor — needs the passphrase |
| `/l/:slug/players/:name` | one player's career |

The grammar, and the four judgement calls behind it, are in
[`docs/url-grammar.md`](docs/url-grammar.md).

## The API

Every route is league-scoped, and the six reads need no cookie:

```
GET  /api/leagues                                  every league
GET  /api/leagues/:slug                            one league, and the shape of its seasons
GET  /api/leagues/:slug/seasons                    every season, keyed by year
GET  /api/leagues/:slug/seasons/:year              teams, standings and weeks
GET  /api/leagues/:slug/seasons/:year/weeks        just the weeks, for the editor
GET  /api/leagues/:slug/session                    whether this session may write

POST /api/leagues/:slug/unlock                     { passphrase } → a session cookie
POST /api/leagues/:slug/lock                       give the unlock back
PUT  /api/leagues/:slug/seasons/:year/weeks/:week  { matchups: [...] }
```

`GET /healthz` answers for the service rather than the process: it queries the
database, so it is a 503 when Postgres is unreachable.

A matchup is a pair of team ids and their scores — `team1_id`, `team1_score`,
`team2_id`, `team2_score` — plus an optional `status` and `label`. A side with no
opponent is `null`: exactly one null side is a BYE, and both null is a slot nobody
has filled in yet.

**Writes are closed by default.** A guard ahead of every router refuses any
non-read request whose league has not been unlocked in this session, so a write
route added later starts out denied rather than open, and a write to a path that
names no league is refused rather than aimed at a default. `npm run api:auth`
proves it: it walks Express's own router stack, sends every write route it finds
with no cookie, and fails if any of them answers anything but 401. Add `-- --prove`
and it breaks the guard three ways on purpose, then reports which checks each
break costs.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on 5173 (`strictPort`, so it will not wander to 5174) |
| `npm start` | the API, and the built client from `dist/`, on 5001 |
| `npm run build` | build the client into `dist/` |
| `npm run db:up` / `db:down` | the Postgres container |
| `npm run db:migrate` / `db:status` | apply migrations / list what is applied |
| `npm run db:check` | name the local and production targets without touching either |
| `npm run db:import` | load `src/data/seasons.json` — **truncate and reload**, never against production |
| `npm run db:recompute` | rewrite standings from the matchup rows |
| `npm run db:verify` | diff the database against `seasons.json`, read-only |
| `npm run db:season` | lay out a new season, all 17 weeks |
| `npm run db:team` / `db:player` | rename a team / set a player active or inactive |
| `npm run db:passphrase` | set a league's write passphrase, at a prompt |
| `npm run api:auth` | the write-guard gate, above |

`src/data/seasons.json` is not a backup and not an answer key. It is six of the
seven seasons as they stood in Phase 1, kept for exactly two jobs: building an
empty database from nothing, and giving `db:verify` something to diff against.
**The database is the source of truth**, and the two have disagreed once already —
about a 2025 score, which the file got wrong.

## Where the decisions are written down

Each of these is a decision record: what was chosen, what was declined, and what
the numbers were read against.

- [`docs/schema.md`](docs/schema.md) — the tables, and why each constraint exists
- [`docs/url-grammar.md`](docs/url-grammar.md) — the client's routes
- [`docs/view-dialect.md`](docs/view-dialect.md) — how the client reads the API's shape
- [`docs/deploy.md`](docs/deploy.md) — hosting, secrets, backups, monitoring
- [`db/README.md`](db/README.md) — the database scripts, one by one

## License

ISC. Issues: https://github.com/ryanw1nn/FantasyFootballWebApp/issues
