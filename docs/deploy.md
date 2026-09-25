# Deploy — Phase 7 Decision Record

Settled 2026-09-24, against the tree at `986a613` with `git status --porcelain`
empty, the working database at `localhost:5433/fanclub`, and the production
database read once without being written to. No code was written for this
document. Every later step of Phase 7 writes one of these answers into a file, a
dashboard or a scheduled job, which is why they are decided before any of them
start.

**Production is loaded by restore, never by import.** The working database holds
seven seasons and sixteen players; `src/data/seasons.json` holds six and fifteen.
`db/import.mjs` is truncate-and-reload, not an upsert, and running it against
production would delete the 2026 season, its 103 matchups, and Patrick O'Donald
— and the deploy would succeed, and the site would look right. That is the one
decision on this page with no defensible alternative; the rest are preferences
with reasons.

(a) and (n) restate decisions Phase 0 already made, so nobody re-litigates them.
The rest are new.

## (a) Render free + Neon free

**Decided.** A Render web service on the free plan in front of the Neon free
Postgres that Phase 0 already created — `neondb` on the pooler endpoint
`ep-shiny-moon-aysjdm4c-pooler.c-5.us-east-2.aws.neon.tech`, Postgres 18.6
(6569466), the same build string as the local container.

**Do not use Render's free Postgres.** Read against Render's current free-tier
documentation on 2026-09-24: free databases *"expire 30 days after creation"* and
become inaccessible unless upgraded. The two providers stay split so the web
service can go to $7/month without touching the data.

Verified 2026-09-24, and two figures the plan carried are now corrected here:

| Read against | Figure |
| --- | --- |
| Render free tier | **750 instance hours a month, per workspace** — not per service. A 31-day month is 744 hours. Anything else ever run on the same free account comes out of the same 750. |
| Render free tier | Web services spin down after **15 minutes without inbound traffic**; restart takes *"about one minute"*. The plan said 30–60 seconds; one minute is the documented figure. |
| Render free tier | **Cron jobs are not a free service type.** This is what forces (k). |
| Neon free plan | 0.5 GB storage and 100 CU-hours per project per month. The whole database dumps to 34,684 bytes, so storage is not a constraint this decade. |
| Neon free plan | Compute **scales to zero after 5 minutes** of inactivity, on top of Render's 15. |
| Neon free plan | Instant restore / point-in-time window is **6 hours**, capped at 1 GB-month of change history. The plan said "on the order of a day." It is six hours, which makes (k) load-bearing rather than belt-and-braces. |

## (b) Docker, not the buildpack

**Decided: a Dockerfile.** Render will build a Node service from `package.json`
with a build command and a start command typed into the dashboard, and that is
one fewer file in the repo.

The image is chosen anyway because the Node version, the build command and the
runtime contents end up **in the repo and reviewable in a diff**, rather than in
three text boxes that nothing versions; and because `docker run` on the laptop
executes the same path production will (7.5), which is the only reason the
production build path gets exercised before it is production. That matters
specifically here: the client bundle inlines `VITE_API_URL` at build time, so
"how the build was invoked" is a correctness question, not a packaging one.

**The cost, stated:** image builds are slower than a buildpack, and the base
image's updates are ours to track.

**Declined by name — the buildpack.** It remains the fallback if free-plan build
minutes ever become the constraint. What is lost by taking it is 7.5's local run.

## (c) One origin

**Decided.** Express serves `dist/` and the API from the same host and port.

This **deletes CORS rather than reconfiguring it**, and makes `sameSite: "lax"`
sufficient against CSRF — which it already is (`server/session.mjs:23`). One
service to deploy, one URL to send people.

**Declined by name — a static host for the client plus Render for the API.** Two
origins brings back `SameSite=None; Secure` on every write and the CORS
configuration Phase 4 exists to have deleted.

Today `server/index.js:23–30` pins CORS to `http://localhost:5173`
unconditionally. Single-origin serving makes that unnecessary in production
rather than merely wrong, so it stays for the dev server, behind `isProduction`.

## (d) Migrations are run by hand, from the laptop

**Decided: not at boot, and not in the Dockerfile.** The command is
`DATABASE_URL=$DATABASE_URL_PROD npm run db:migrate`, typed deliberately, with
the output read.

A migration in the entrypoint is applied by whichever container starts first,
with no operator watching, on a plan with one instance and no rollback — a
failure there is an outage rather than a message. There is one commissioner, no
CI, and roughly one migration a year.

**The consequence, written down:** a deploy that needs a migration is two steps
in a fixed order — **migration first**, and the running code must tolerate the
new schema for the seconds in between. If it cannot, the order reverses and the
migration must be backwards-compatible instead. Nothing in Phase 7 needs a
migration at all.

**One sharp edge to avoid:** do not use `npm run db:status` to inspect
production. `db/migrate.mjs:84` runs the
`CREATE TABLE IF NOT EXISTS schema_migrations` defined at `:15` *before* line 85
decides whether the argument was `status`, so the read-only-sounding command
writes a table. (The plan cites `:82`; the call is at `:84`.) Use `npm run db:verify`, which opens
no transaction, or `psql -c "\dt"` (see (k) for where `psql` lives).

## (e) Production is loaded by restore, not by import

**Decided: `pg_dump` the working database, `pg_restore` it into Neon, once.** The
artefact is the dump 7.1 already took and already restore-tested:
`~/fantasy-football-backups/phase7-pre-ship-20260924-184322/fanclub.dump`, 34,684
bytes, custom format, taken by pg_dump 18.6 against an 18.6 server.

Read against both sources on 2026-09-24:

| | Database | `src/data/seasons.json` |
| --- | --- | --- |
| Seasons | 7 (2020–2026) | 6 (2020–2025) |
| Players | 16 | 15 |
| 2026 | 103 matchups, 12 scored | absent |
| Patrick O'Donald (`players.id = 18`) | present | absent |
| 2025 score repaired in 6.1 | correct | disagrees |

`db/import.mjs` truncates and reloads in one transaction with a row-count
assertion that **would pass**, because reloading six seasons is exactly what it
is for. The restore also carries what no import can reconstruct: the league's
passphrase hash, the `schema_migrations` rows, and the `session` table.

**The consequence, written down:** after this, the working database is upstream
of production exactly once and never again. From 7.9 onward **production is the
source of truth and the laptop is the copy**, reversing a direction this project
has had since Phase 1.

`src/data/seasons.json` keeps exactly two jobs: it is what `db:import` reads when
a database is built from nothing — the gates' scratch databases, and only those —
and it is what `db:verify` diffs six of the seven seasons against. It is not a
backup and it is not an answer key for the live site.

The commands that execute this decision, the counts they must produce, and the
rollback if they do not are in *The 7.7 load, and the shape of a rollback* below.

## (f) Secrets, and their lifecycle

**Three, and none of them is in the repo.** The repo is public
(`github.com/ryanw1nn/FantasyFootballWebApp`), so a secret in a commit is a
secret on the internet within seconds: **rotate, never amend.**

| Secret | Where it lives | Lifecycle |
| --- | --- | --- |
| `DATABASE_URL` | Render's environment, holding the Neon connection string with `sslmode=require` — **the direct endpoint, never `-pooler`**, see *The pooler serves an empty `search_path`* | Rotated from the Neon dashboard. `db/url.mjs` upgrades `require` to `verify-full` at connect time, so a `pg` v9 upgrade cannot quietly weaken it. |
| `SESSION_SECRET` | Render's environment | A fresh random string of **at least 32 characters** — `server/session.mjs:33` refuses to boot in production below that — generated for production and **different from the local one**. Rotating it signs every session out, so it is a decision, not a side effect. |
| League passphrase | A hash in `leagues.write_secret_hash` | Set with `npm run db:passphrase -- --league fan-club --yes`, typed at the prompt. `db/passphrase.mjs` refuses `--passphrase` as an argument, because arguments land in shell history and in `ps`. |

**Nothing prefixed `VITE_` is ever a secret.** Vite inlines those into the bundle
every visitor downloads. `.env` is gitignored (`.gitignore:16`) and holds all
four of today's variables, including `DATABASE_URL_PROD`, which exists only on
the laptop and is never set on the server.

## (g) The URL, and the domain

**Decided: ship on the `*.onrender.com` subdomain.** A custom domain is a
separate, later, optional errand — DNS, a certificate wait, and a second URL that
has to keep working, none of it on the critical path to "people can read it."

If one is ever wanted, do it **after 7.13**, and note that the session cookie is
host-scoped: moving hosts signs everyone out, which for one commissioner costs
one unlock.

## (h) Structured logging: declined, for now

**Decided: keep `console.error`. Do not add `pino`.** The readiness card asks for
it on the grounds that host log viewers parse JSON.

Read against the tree, the server logs in exactly **three** places —
`server/index.js:46` (the 500 handler), `:52` (the idle-client handler), and
`:70` (the refusal to boot). There is one reader of one log stream, and Render's
viewer shows plain lines perfectly well. A logging library earns its place when
there is something to correlate: a request id across services, or an aggregator
with a query language.

**The trigger, recorded instead of the tool:** add `pino` the day there are two
services, or a second person reading the logs.

**What *is* owed here, and it is free:** `server/index.js:46` is a bare
`console.error(err)`. It should log the request method and path beside the error.
"TypeError" with no address is not a debuggable line. That edit belongs to 7.4.

## (i) `helmet` and `compression`: both, with one thing to watch

**Decided: both.** Two lines each, and the kind of default it is strange to argue
against.

**The thing to watch is helmet's Content-Security-Policy,** which defaults to
`default-src 'self'` and has broken more first deploys than every other item on
the readiness card. This app is a good case for it — one bundled script, one
stylesheet, no inline script — so the default should hold.

**Corrected 2026-09-24, while building the image:** this was written as "no CDN,
no external font", and there is one. `src/index.css:2` is
`@import url('https://fonts.googleapis.com/css2?family=Inter:...')`, and Vite
cannot inline a remote import, so the built stylesheet carries it too — every
visitor's browser fetches Inter from `fonts.googleapis.com`, and the font files
from `fonts.gstatic.com`. **The default CSP survives it only because helmet's
defaults are wider than `default-src`:** `style-src 'self' https: 'unsafe-inline'`
and `font-src 'self' https: data:` both allow any https origin, read off the wire
from the running container. Two consequences worth writing down rather than
rediscovering:

- **Tightening `style-src` or `font-src` to `'self'`** — the obvious hardening —
  breaks the font silently, and the page falls back to a system font with no
  server-side sign of it.
- **It is a third-party request per visit,** which sits oddly beside "no
  analytics, no third-party scripts". Self-hosting Inter would remove it and cost
  a font file in `public/`. **Not Phase 7's** — it changes what the page looks
  like if the weights are wrong, and no step here is allowed to do that. Decide
  it after launch.

**Prove it in the browser console in 7.5, not in 7.13.** A CSP violation is
silent in the server logs and loud in the console. If one fires, the answer is to
name the source it blocked. **Never to turn CSP off.**

## (j) The cold start, and what it costs to avoid

**Decided: accept it.** For sixteen people checking on Sunday nights, the first
one waits and the rest do not. Two sleeps compound: Render spins the service down
after 15 minutes without inbound traffic (~1 minute to restart), and Neon's
compute scales to zero after 5 minutes of inactivity, adding a smaller wait on
the first query.

**The arithmetic that decides 7.11:** the free plan is 750 instance hours a
month **per workspace**; a 31-day month is 744 hours. A pinger frequent enough to
keep the service awake makes it effectively always-on, which fits under 750 — but
only just, and only for one service on the whole account. Six hours of headroom
is the entire margin.

## (k) Backups: a scheduled `pg_dump` off-host, run through the container

**Decided: a `launchd` job on the Mac, weekly, dumping `DATABASE_URL_PROD` into
`~/fantasy-football-backups/`, with a `SHA256SUMS.txt` and a retention rule.**
Both formats, as 7.1 took them: `-Fc` for `pg_restore`, plain SQL for a human.

Render's cron jobs are a paid feature (verified 2026-09-24), and a backup that
runs *on* the thing being backed up is the `backups/` folder again. A laptop that
is sometimes closed is a worse scheduler than a server and a far better one than
nothing, and the failure mode — a week with no dump — is visible in a directory
listing.

**Neon's own restore window is not a backup.** Six hours on the free plan, capped
at 1 GB-month of change history. It is recovery from a bad edit made this
morning, not archival.

**And 7.1 found that there is no `pg_dump`, `pg_restore` or `psql` on this
machine at all** — not on the `PATH`. Every database this project has touched has
been reached through `pg` from Node. 7.1's dumps were taken by running the client
*inside the container* (`docker compose exec -T db pg_dump …`), which pairs an
18.6 client with an 18.6 server; a dump taken by an older client is the classic
way to produce a file that will not restore.

**Decided here, because 7.10 was going to have to:** the scheduled job goes
through the container, and **the runbook names the failure mode in so many
words — if Docker is not running, the job produces nothing and says nothing.**
That is what the directory listing is for. `brew install libpq` is the upgrade if
the silent weeks become real rather than theoretical; it is not done now, because
a host client at a different version than the server is the one thing worse than
no client.

**A second correction 7.1 earned:** `psql "$DATABASE_URL_PROD"` typed at an
interactive shell does not work. Nothing loads `.env` into the shell — only
`dotenv` inside the Node scripts does — so the variable is empty, `psql` falls
back to a local socket, and the error names the container (`role "root" does not
exist`) rather than Neon. Read the value out of the file explicitly, and quote
it: the string contains an `&`.

**Declined by name — a GitHub Actions scheduled workflow.** It would need the
production connection string as a repository secret in a **public** repo.
Declined for that reason alone. **Also declined — paying for Render cron**, which
is the answer if the laptop stops being a plausible scheduler.

## (l) Monitoring: one external check, on `/healthz`

**Decided: a free external uptime monitor hitting `/healthz` every 5–15 minutes,
alerting by email.**

**External**, because a monitor that runs inside the thing it watches reports
nothing about the case that matters. **`/healthz` rather than `/`**, because the
health route touches the database and the SPA shell does not — a site that serves
HTML beautifully while Postgres is unreachable is exactly the outage that
otherwise arrives via the group chat.

**The interaction with (j), decided rather than noticed:** a 5-minute interval
also keeps the instance awake, spending the hours (j) counted. **Take the
5-minute interval and spend them** — 744 of 750 with six to spare is the trade,
and always-on is worth more than the margin. If anything else is ever deployed to
the same workspace, this is the first thing to lengthen.

## (m) What the aliases take with them

Decided here so 7.6 executes rather than deliberates. Counted against the tree at
`986a613`: **1,302 lines**, plus `baseline/` at 14 files and 288 KB (gitignored).

**Deleted:**

- `server/routes/legacy.js` — 60 lines
- `server/serialize.mjs` — 150
- `scripts/parity.mjs` — 651
- `scripts/divergences.mjs` — 258
- `scripts/capture-baseline.mjs` — 183
- `baseline/`
- `queries.mjs`'s `matchupFromNames`, and the `resolveTeam` helper it is the only caller of
- the `DEFAULT_LEAGUE` fallback in `server/guard.mjs:47` — the aliases carry no slug, and nothing else reaches that branch
- the `api:parity` and `baseline:capture` scripts in `package.json`

**Kept:**

- `src/data/seasons.json` and `db/import.mjs` — a gate's scratch database has to be built from something, and that something must not be production
- `db/verify.mjs` — it still proves six of seven seasons, and is documented safe against any database
- `scripts/auth.mjs`, rewritten to the new route counts

**Kept and renamed: nothing.** A rename in the same commit as a delete makes the
diff unreadable.

**Executed 2026-09-24 (7.6), with four amendments to the list above.** The five
files and `baseline/` are gone — 1,302 lines and 288 KB, one dated copy of
`baseline/` kept in `~/fantasy-football-backups/` first, because it was the only
recording of what the JSON-backed server answered and it is not in git.

- The `guard.mjs` fallback did not just go: `slugOf` now returns `null` for a path
  that names no league, and `LEAGUES_PREFIX` went with it, because every path that
  fails to match `LEAGUE_PATH` already returns `null`. A write to an unslugged
  path is a 401 — verified with a real unlock in hand, which is the case that
  matters and the one nothing checked before.
- `api:auth` kept three `--prove` breaks rather than dropping to two. The
  `DEFAULT_LEAGUE` break was **inverted**: putting the fallback back is what an
  unrecognised write path silently reaching real data looks like in one line, and
  two new checks catch it — a cookied `PUT` to the deleted alias path and to
  `/api/made/up`, both of which must be 401.
- The gate's cookieless-GET list is now **walked off the router stack** like the
  writes, rather than read from `baseline/manifest.json`. Six GETs, and the list
  cannot go stale.
- Five comments named `server/serialize.mjs` or the parity gate, not the three the
  plan found: `db/README.md` (twice), `db/new-season.mjs`, `db/rename-team.mjs`,
  `db/player-status.mjs`, `server/serialize-api.mjs` and `server/routes/leagues.js`.
  Each now names where the rule lives — `isBye` and `ownerLabel` in
  `src/stats/league.js`, or `server/serialize-api.mjs`.

**After:** `api:auth` green at **24** `ok` lines, **3** write routes, **6**
cookieless GETs, and failing under all three `--prove` breaks. `db:verify` 72,
2026 skipped, nine `prev_place` nulls. The build reproduces
`index-DIAxshQw.js` at 306.31 kB — the *same asset hash* as before the commit, so
the client is byte-identical and nothing under `src/` moved.

## (n) Still one league, still no signups

Phase 0's decision, restated because a public URL is where it gets tested.
Strangers cannot create leagues, there is no signup, and league two is Phase 8's
— after launch. **The production database ships with one league in it.**
`is_public` exists as a column and is `true`; nothing reads it yet, and Phase 7
does not teach anything to.

## The image, as built and run — 2026-09-24

Measured, not estimated, from `Dockerfile` and `.dockerignore` at `514c74b` plus
these two files, on Docker 29.1.3, arm64, against the local container.

| | |
| --- | --- |
| build, cold | **28.8 s** end to end; a rebuild with only a source change reuses the `npm ci` layer |
| pull size | **69.7 MB** (`node:24-alpine` is 62.4 MB, so the app adds ~7 MB) |
| on disk | **315 MB**, of which the base image is 238 MB |
| the build stage | 106 MB pull / 454 MB disk — the devDependencies, left behind in it |
| boot | **1.28 s** from `docker run` to the first `200` on `/healthz` |
| runtime contents | `dist/` 340 KB, `server/` 80 KB, `db/` 160 KB, `node_modules` 63.3 MB across 101 packages |
| the bundle | 1712 modules, `index-DLKzlqb6.js` **306.29 kB**, css 23.26 kB — the same hash a local build with no environment file in scope produces, and `localhost:5001` appears **0** times in it |

**`docker image ls` reports 315 MB and that is not the figure to judge it by** —
it is disk usage including the base image's shared layers. The question the
readiness card meant is "did anything from the build stage come along", and the
answer is checked directly: no `vite`, `tailwindcss`, `postcss` or `autoprefixer`
in the runtime `node_modules`, and no `src/`, `scripts/`, `docs/`, `baseline/`,
`README.md` or environment file anywhere in the image.

**The health check's timeout can be short.** 1.28 s to first healthy, against
Render's default grace period, means a failing health check on the first deploy is
a real failure and not a slow start — do not lengthen it to make one pass.

### Running it locally

```sh
docker build -t fanclub:local .
docker run -p 5001:5001 \
  -e DATABASE_URL='postgres://fanclub:fanclub@host.docker.internal:5433/fanclub' \
  -e SESSION_SECRET='<32+ random characters>' \
  fanclub:local
```

**`host.docker.internal`, not `localhost`.** The container's `localhost` is the
container, so the local URL fails with
`connect ECONNREFUSED ::1:5433; connect ECONNREFUSED 127.0.0.1:5433` — which is
the right error, printed legibly, and worth causing once.

**For the unlock, add `-e NODE_ENV=development`.** The image sets
`NODE_ENV=production`, which makes the session cookie `Secure`, and a browser
discards a `Secure` cookie delivered over plain `http://localhost:5001`: the
unlock appears to succeed and nothing persists. That is the failure `trust proxy`
prevents in production, seen locally, and it is not the image being broken.

### The three ways it refuses to start, each naming itself

- no `SESSION_SECRET` → `Refusing to start: SESSION_SECRET is not set.`, exit 1
- a short one in production → `Refusing to start: SESSION_SECRET must be at least 32 characters in production.`, exit 1
- an unreachable database → `Cannot reach the database at <host>:<port>/<db>: <cause>`, exit 1

A first deploy that exits is one of these three, and the log says which. None of
them is a reason to add a retry loop.

## The 7.7 load, and the shape of a rollback

Written before anything serves. **This is the last moment production is
disposable** — the moment a write lands in production (7.9), every answer below
stops being available.

### The order is restore-first, and migrate-first is wrong

Two orders are possible and only one of them runs. Read off the dump on
2026-09-25:

| Read | Value | What it settles |
| --- | --- | --- |
| `CREATE TABLE` statements in the dump | 8 | The dump brings the whole schema |
| `IF NOT EXISTS` in the dump | 0 | Every one collides against an existing table |
| `schema_migrations` rows in the dump | 4 (`001`–`004`) | Migration state travels with the data |
| `ALTER TABLE … OWNER TO fanclub` | 8 | `--no-owner` is required, not cosmetic |

So **do not run `db:migrate` before the restore.** A migrated database already
holds all eight tables, and `pg_restore` would report eight `relation already
exists` failures and duplicate the four `schema_migrations` rows — a wall of
errors with any real one hidden inside it. Restore into the empty database, and
run `db:migrate` **afterwards**, where its job is to print *up to date — nothing
to apply* and so prove `schema_migrations` arrived intact.

The alternative route — `--data-only --disable-triggers` into a migrated schema —
makes foreign-key ordering your problem for no gain, and is declined.

### The rule about `DATABASE_URL`

Everything in `db/` reads `DATABASE_URL`; nothing reads `DATABASE_URL_PROD`
(`db/check-env.mjs:51–56` exists to say so). Production commands take a one-shot
override and **never an edited `.env`** — the minute you swap the two lines "just
for a minute" is the minute that contains a `db:reset`.

There is no Postgres client on this machine, so `pg_restore` and `psql` run
inside the `fanclub-db` container, as 7.1's dumps did: an 18.6 client against an
18.6 server, which is the pairing that makes the file restorable at all.

### The commands, in order

**Every command below uses the direct endpoint, never the pooler.** See *The
pooler poisons a restore* below for why; it cost this step three failed
diagnoses.

```sh
PROD=$(grep '^DATABASE_URL_PROD=' .env | cut -d= -f2-)
PROD_DIRECT=$(printf '%s' "$PROD" | sed 's/-pooler//')   # schema work goes here
DUMP=~/fantasy-football-backups/phase7-pre-ship-20260924-184322/fanclub.dump

# 0. the file is the one that was checksummed, and Neon is still empty
shasum -a 256 -c ~/fantasy-football-backups/phase7-pre-ship-20260924-184322/SHA256SUMS.txt
docker compose exec -T db psql "$PROD_DIRECT" -c '\dn' -c '\dt'

# 1. restore — not import, and not after a migrate
docker compose cp "$DUMP" db:/tmp/fanclub.dump
docker compose exec -T db pg_restore --no-owner --no-privileges \
  --exit-on-error -v -d "$PROD_DIRECT" /tmp/fanclub.dump
docker compose exec -T db rm -f /tmp/fanclub.dump

# 2. prove the migration state travelled
DATABASE_URL="$PROD_DIRECT" npm run db:migrate         # expect: up to date — nothing to apply

# 3. count everything against the working database
DATABASE_URL="$PROD_DIRECT" npm run db:verify          # expect: 72 team-seasons, 2026 skipped

# 4. a new passphrase, typed at the prompt, twice, never an argument
DATABASE_URL="$PROD_DIRECT" npm run db:passphrase -- --league fan-club --yes

# 5. the guard that stays useful for years
npm run db:check                                       # DATABASE_URL must still say localhost:5433
```

Two notes on the restore command. **Pass the dump as a file path, not on stdin** —
a custom-format archive is seekable and `pg_restore -l` against a pipe can read
nothing at all while still exiting 0. And **`-v`**, so a restore that does nothing
says so instead of returning in silence.

### The pooler serves an empty `search_path`, so the app uses the direct endpoint

**Read on 2026-09-25, against the live Neon database.** The two endpoints do not
behave the same way:

| Endpoint | `show search_path` | `select count(*) from seasons` |
| --- | --- | --- |
| `...-pooler.c-5...` | *empty*, **five connections out of five** | `ERROR: relation "seasons" does not exist` |
| `...c-5...` (direct) | `"$user", public` | 7 |

**This would have failed the first deploy and looked like something else.**
`db/pool.mjs` reads `DATABASE_URL` and nearly every query in
`server/queries.mjs` names its tables unqualified, so every read would have
errored — while `/healthz` stayed **200**, because its `SELECT 1` names no table.
Every indicator 7.8 tells you to check would have been green.

**Two fixes were tried and the pooler refuses both, by design:**

1. *Role-level default.* `ALTER ROLE neondb_owner SET search_path TO "$user", public;`
   applies — `pg_roles.rolconfig` reads `{"search_path=\"$user\", public"}` — and the
   pooler **still** serves an empty path. It ignores role-level `search_path`.
2. *Startup parameter.* `?options=-c search_path=public` does not connect at all:
   `ERROR: unsupported startup parameter in options: search_path. Please use
   unpooled connection or remove this parameter from the startup package.`

**Decided: `DATABASE_URL` holds the direct (unpooled) endpoint — the host without
`-pooler` — everywhere.** Render's environment in 7.8, every `db/` command, and
(k)'s backup job. This is Neon's own instruction, printed by its own error.

It also costs nothing here. A pooler absorbs many short-lived connections —
serverless functions, per-request connects. This app is one long-lived Node
process holding at most **5** connections (`db/pool.mjs:30`), which is exactly the
shape that gains nothing from PgBouncer and inherits its surprises. **No code
change**, so `git diff -- db/` stays *comments only* as 7.12 asserts; the whole
change is which string goes in one environment variable. *This fills in a blank
in (f), which said "the Neon connection string" without saying which endpoint.*

The `ALTER ROLE` is left in place. It changes nothing on the direct endpoint,
which already had that value as its built-in default, but it makes explicit an
assumption the app had been depending on silently for six phases.

*A first diagnosis blamed the restore's `set_config('search_path', '', false)` on
line 16 of the dump, leaking across a pooled connection. It was wrong: leaked
session state would vary between connections, and five consecutive ones were
identical. Recorded because the wrong explanation was plausible enough to act on,
and acting on it would have meant re-running a restore that had already
succeeded.*

### How this presented, and the reading habit it should change

The restore succeeded on the first attempt and looked for an hour as though it
had failed. Every symptom came from the empty path:

| Symptom | What it actually meant |
| --- | --- |
| `pg_restore` exits 0, silent | The restore **worked** |
| `db:migrate` → `no schema has been selected to create in` | `migrate.mjs:14`'s unqualified `CREATE TABLE schema_migrations` has nowhere to go |
| `\dt` → *Did not find any tables* | `\dt` lists tables **in the search path**. All eight were there |
| A second restore → `relation "leagues" already exists` | Proof the first one succeeded |

**`\dt`'s answer was read twice as "the restore did nothing", and the second
reading nearly caused a re-run of a restore that had already worked.** The only
count that cannot lie is a schema-qualified one:

```sh
docker compose exec -T db psql "$PROD_DIRECT" -c 'select count(*) from public.seasons;'
```

**The rule: `pg_dump`, `pg_restore` and admin `psql` never point at the `-pooler`
host** — schema work goes to the direct endpoint, which is Neon's own guidance.
**(k)'s weekly backup job is specified against `DATABASE_URL_PROD` and must strip
`-pooler` the same way.**

Two smaller corrections from the same hour: pass a custom-format dump to
`pg_restore` as a **file path, not on stdin** — the archive is seekable and a pipe
can yield nothing while still exiting 0 — and pass **`-v`**, so a restore that does
nothing says so rather than returning in silence.

### The counts production must read

Read off the working database on 2026-09-25, and identical to 7.1's:

| | Count |
| --- | --- |
| leagues | 1 |
| seasons | 7 (2020–2026) |
| teams (team-seasons) | 84 |
| matchups | 618 |
| players | 16, including `id = 18` Patrick O'Donald |
| standings | 84 |
| `schema_migrations` | 4 |
| 2026 | 103 matchups, 12 scored, weeks 1–17 |

**Read back off production on 2026-09-25, through the direct endpoint:**
`1 / 7 / 84 / 618 / 16 / 84 / 4`, matching the working database exactly.
`db:migrate` reported *Up to date — nothing to apply*, so `schema_migrations`
travelled intact. `db:verify` compared **72** team-seasons, skipped 2026 as
*created after seasons.json*, and named the nine whitelisted `prev_place` nulls
one by one. **The load is done and production holds seven seasons.**

`db:verify` reads **72** team-seasons rather than 84 because it skips 2026 as
*created after seasons.json*. **Look at the 2026 row twice** — it is the row an
import would have silently removed.

### The passphrase is replaced, not inherited

The dump carries `leagues.write_secret_hash`, so the league **arrives already
unlockable with the local passphrase** — convenient and wrong. A development
secret that has been in a laptop's shell history since Phase 3 should not be the
thing standing between the internet and the score table. Set a new one, before
the service exists rather than after. Replacing it signs nobody out
(`db/passphrase.mjs:11`): sessions record the league, not the phrase.

The script prompts, twice, with echo off, and refuses `--passphrase` as an
argument outright — arguments land in shell history and in `ps`. It therefore
cannot be run unattended, by a person or by anything else.

**Replaced on 2026-09-25.** The first attempt was rejected — *passphrase must be
at least 12 characters* — which is `server/passphrase.mjs` refusing a weak secret
on the one credential that faces the internet. The second was accepted.

### The session secret

43 random characters, base64url, generated 2026-09-25 and held at
`~/fantasy-football-secrets/prod-session-secret.txt` (mode 600, outside the
repo). Different from the local one. It goes into **Render's environment in 7.8
and nowhere else** — never into `.env`, never into a commit.
`server/session.mjs:30–36` refuses to boot without one and refuses one shorter
than 32 characters in production, so a missing secret is a failed deploy rather
than a silently insecure site.

### The rollback

**If the restore is wrong, production is still disposable.** Either drop the
objects and restore again, or delete and recreate the Neon branch and restore
into it:

```sh
docker compose exec -T db psql "$PROD" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
shasum -a 256 -c .../SHA256SUMS.txt        # the same file, checked again
docker compose exec -T db pg_restore --no-owner --no-privileges --exit-on-error -d "$PROD" < "$DUMP"
```

Restoring twice from the same checksummed file is safe because the file is the
only source and it is immutable. **This stops being true at 7.9**, when the first
write lands through the public URL: from then on production holds something the
dump does not, the direction reverses, and recovery means (k)'s weekly dump
rather than this one.

## The 7.8 service, and the first deploy

**Smoke only.** Nothing here is the phase's gate — 7.9 is, because it redeploys
with a write in between. What 7.8 has to establish is narrower: the image Render
builds is the image 7.5 ran, the service reaches the database it is supposed to
reach, and the log lines say so without printing a credential.

### What was proven on the laptop first, and why it is not the same as 7.5

7.5 built the image from the working tree. **Render builds from the git
repository**, which is a different context and can differ in exactly the way
that matters: a file that was never committed, or one `.dockerignore` removes.
So the build was repeated from a clean clone of `main` before the dashboard was
opened at all.

| Read on 2026-09-25 | Value |
| --- | --- |
| commit Render will build | `b5e55aa`, and `git ls-remote origin refs/heads/main` is the same sha — GitHub holds exactly what the laptop holds |
| clone contents | no `.env` in the clone at all, so the bundle's relative base URL does not even depend on `.dockerignore` here — it depends on the file being gitignored, which it is |
| build | **30.5 s** cold, `fanclub:7.8-clone` |
| image | **69.7 MB** to pull (69,733,225 bytes), 315 MB on disk with the base layers — 7.5's figures |
| bundle | `dist/assets/index-DLKzlqb6.js`, **306,291 bytes** — *the same content hash and the same byte count as the `fanclub:7.5` image*, so the clean clone reproduces 7.5's build exactly |
| `localhost:5001` in the bundle | **0** — this is the number 7.12 asserts, now measured in a build made from the repository rather than from the tree |
| `docker run` → `/healthz` 200 | **1.47 s** |

**One correction to the plan page:** it records the no-base-URL bundle at
**306,292** bytes. The image's bundle is **306,291**, in both the 7.5 image and
the clean-clone image. The 306,292 came from a local `npm run build`; the image's
is one byte smaller and it is the one that ships. 5.2's rule again — trust the
tree, correct the page.

### The pre-flight smoke, against the image Render will build

Run in production mode against the *local* database, on port 5099 so nothing
already listening is disturbed:

| Check | Read |
| --- | --- |
| `/healthz` | `200`, `{"ok":true}` |
| boot log | `Server running on http://localhost:5001` and `Serving host.docker.internal:5433/fanclub` — `describeTarget()`, no credential |
| `GET /api/leagues` | `The Fan Club`, `season_years` **2020–2026**, `latest_year` 2026 |
| `GET /api/leagues/fan-club/seasons` | `seasons` keyed **2020,2021,2022,2023,2024,2025,2026** — seven |
| payload | **113,308 bytes** plain, **11,863** gzipped, `Content-Encoding: gzip` present |
| `GET /l/fan-club/season` | `200 text/html`, `Cache-Control: no-cache` — the SPA fallback |
| `/assets/index-*.js` | `Cache-Control: public, max-age=31536000, immutable` |
| CORS with `Origin: http://localhost:5173` | **no `Access-Control-Allow-Origin` at all** |
| anonymous `PUT .../2026/weeks/1` | **401** |
| helmet | CSP `default-src 'self'` with `style-src 'self' https: 'unsafe-inline'` and `font-src 'self' https: data:` — the two that keep the Google Fonts `@import` working; HSTS a year, `nosniff` |

### The service

| Setting | Value | Why |
| --- | --- | --- |
| repository | `github.com/ryanw1nn/FantasyFootballWebApp`, branch `main` | public, and the source of truth |
| environment | **Docker** | (b) |
| plan | **Free** | (a) |
| region | **Ohio (`us-east-2`)** | Neon's endpoint is `...c-5.us-east-2.aws.neon.tech`. A service in Oregon pays a cross-country round trip per query, and a whole-league read is several. **This cannot be changed later without recreating the service.** |
| health check path | `/healthz` | registered at `server/index.js:66`, above the session middleware and far above the SPA fallback, so it neither touches the session table nor gets answered with a cheerful 200 of HTML |
| Dockerfile path | repository root | the default |

### Four environment variables, and not a fifth

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the Neon string for the **direct** endpoint — host `ep-shiny-moon-aysjdm4c.c-5.us-east-2.aws.neon.tech`, database `neondb`, `?sslmode=require&channel_binding=require`. **Never the `-pooler` host**; see *The pooler serves an empty `search_path`*. |
| `SESSION_SECRET` | the 43 characters at `~/fantasy-football-secrets/prod-session-secret.txt`. Paste the characters, not the file's trailing newline. |
| `NODE_ENV` | `production` |
| `PORT` | only if Render does not inject it. `server/index.js:130` reads it and falls back to 5001. |

**Do not set `VITE_API_URL`.** It is read at *build* time, inside the image, and
setting it to anything at all — including the service's own URL — bakes an
absolute origin into the bundle and undoes 7.3. 7.12's bundle grep is what
notices.

**`DATABASE_URL_PROD` does not go to Render.** It exists only on the laptop, and
only so `db/` commands can be pointed at production deliberately; the running
service reads `DATABASE_URL` like everything else.

**The connection path is already exercised.** 7.7 ran `db:migrate` and
`db:verify` through `db/pool.mjs` against the direct endpoint, which is `pg`
connecting with `sslmode` pinned to `verify-full` by `db/url.mjs` — the same
library, the same string, the same host the service will use. *One note on the
string:* `pg` does not implement libpq's `channel_binding`, so that parameter is
ignored rather than enforced. It is harmless and it is not a guarantee.

**Worth confirming from the laptop before the deploy**, because it is the one
failure that would otherwise present as a blank site:

```sh
PROD=$(grep '^DATABASE_URL_PROD=' .env | cut -d= -f2-)
DATABASE_URL="$(printf '%s' "$PROD" | sed 's/-pooler//')" npm run db:verify
```

### Auto-deploy: off for the first one, then on

Leave it **off** for the first deploy so it can be triggered deliberately and the
whole log read, then turn it **on**. One committer, one branch, and the repo is
the source of truth, so a push to `main` deploying is the right default.

**The consequence, written down here so 7.14 is not a style preference: from the
moment auto-deploy is on, a commit to `main` is a deploy.** Branch for anything
uncertain. And (d) still holds — migrations are never run at boot, so a deploy
that needs one is two steps in a fixed order, migration first.

### The three ways the first deploy can fail, each with one cause

| Symptom | Cause | Not the fix |
| --- | --- | --- |
| **build fails** | the build context — something uncommitted, or removed by `.dockerignore`. The clean-clone build above is what makes this unlikely. | editing the Dockerfile |
| **boots and exits** | `server/index.js:174` *Refusing to start: SESSION_SECRET…*, or `:181` *Cannot reach the database at …* — both name themselves, and the second prints the host without the credential | a retry loop |
| **boots, health check fails** | the path, the port, or `/healthz` unreachable | a longer timeout |

### The first look, on the real URL

`/healthz` 200. The season dropdown offers **seven** years. The header reads
*The Fan Club* — which is `GET /api/leagues` having reached the database rather
than a cache. `curl -sI <url>/l/fan-club/season` is `200 text/html`. The log says
*Server running* and *Serving …neon.tech/neondb*, which is `describeTarget()`
confirming production is talking to production without printing a secret.

Then leave it alone for fifteen minutes, open it again, and **time the cold
start**. That is the number (j) decided to accept, and it is easier to accept one
that has been measured. The local baseline to compare it against is the 1.47 s
above — which is the container starting, not a host allocating one.

| Measured on the real URL, 2026-09-25 | |
| --- | --- |
| service URL | `https://fantasyfootballwebapp.onrender.com` |
| port | Render injects `PORT=10000`, so no `PORT` variable was set. `index.js:130` reads it; the log line's `http://localhost:10000` is a hardcoded string and not something the server discovered. |
| `DATABASE_URL` host in the log | `ep-shiny-moon-aysjdm4c.c-5.us-east-2.aws.neon.tech:5432/neondb` — **no `-pooler`**, read by eye, which is the one check on this list that a green health check cannot make for you |
| first deploy, build duration | *not captured — the log viewer would not scroll back that far. Taken instead at 7.9's redeploy.* |
| **cold start after idle** | **12.51 s** to a 200 on `/healthz`. DNS 0.08 s, connect 0.16 s, TLS 0.27 s, **first byte 12.51 s** — so Render's edge was awake throughout and the whole wait was the container booting plus Neon's compute waking behind it. *Better than the budget:* (j) accepted Render's documented "about one minute" plus Neon's own wake on top. One measurement, from a Mac on home broadband. |
| warm | `/healthz` **0.32 s**, the shell **0.33 s**, the whole-league read **0.83 s** at 11,221 bytes gzipped |
| auto-deploy | **on**, set after the first deploy succeeded. From here a commit to `main` is a deploy. |

### The live surface, read off the public URL on 2026-09-25

Every row measured against `https://fantasyfootballwebapp.onrender.com`, not against a container:

| Check | Read |
| --- | --- |
| `/healthz` | `200 {"ok":true}` |
| `GET /api/leagues` | `The Fan Club`, `season_years` **2020–2026**, `latest_year` 2026 — off Neon, seven seasons |
| seasons payload | keyed 2020…2026, **113,308** bytes plain, **11,221** gzipped |
| the shipped bundle | `/assets/index-DLKzlqb6.js`, **306,291 bytes**, `localhost:5001` → **0** — *the same content hash and byte count as the clean-clone image built on the laptop*, so the artefact a stranger downloads from Ohio is byte-identical to the one that was smoke-tested here |
| `/l/fan-club/season` | `200 text/html` over HTTP/2 |
| `/api/leagues/nope/seasons` | `404` JSON, not HTML |
| anonymous `PUT .../2026/weeks/1` | **401** |
| CORS with `Origin: http://localhost:5173` | no `Access-Control-Allow-Origin` |
| `http://` | `301` → `https://`, by the host |

### The spin-down, seen

The free instance's idle shutdown logged **`SIGTERM received, shutting down.`** — `index.js:147`, 7.4's handler, on a real host for the first time. Render's own idle notice varies by UI version; that line is the one to trust, and the gap between it and the next `Server running` pair is the spin-down window. *7.9's "watch the old instance take `SIGTERM` and exit cleanly" is therefore already observed once, before 7.9 starts.*

**Do not send the link to anyone yet.** 7.9 proves a write survives a redeploy
and 7.10 makes losing the database survivable; those are what make a link safe to
hand out.

## 7.9 — The second deploy, with a write in between

The card's gate, run literally: *"you can redeploy mid-season and lose nothing."*
That is not a property of a Dockerfile, it is a sequence, so the only record that
counts is one taken while performing it.

**Split by who can run it.** The refusals are machine-checkable from anywhere and
were taken first, below. Everything else needs the passphrase, a browser
inspector, and the Render dashboard, and is written here as an ordered runbook to
be performed and then filled in. *No part of this step writes to Neon from a
script;* the only write production takes is the one made through the UI.

### Taken first: the refusals, from the internet, 2026-09-25

The guard's claim, made against the real host with no cookie rather than against
a scratch server. `server/guard.mjs` keys on the **method, not the route**, and
runs ahead of every router, so a write to a path that does not exist is a 401
rather than a 404 — an anonymous caller cannot use the guard to enumerate the
write routes.

| Anonymous request, no cookie | Read |
| --- | --- |
| `PUT /api/leagues/fan-club/seasons/2026/weeks/1` | **401** `{"error":"Unlock this league to make changes."}` |
| `PUT /api/seasons/2026/weeks/1` — names no league, 7.6's retired shape | **401**, the same body — `slugOf()` returns null and there is no fallback to the one league |
| `PUT /api/leagues/other-league/seasons/2026/weeks/1` — names a league that does not exist | **401**, not 404 |
| `GET /api/leagues/fan-club/session` | `200 {"canWrite":false}`, and **no `Set-Cookie`** — `saveUninitialized: false`, so a reader never gets a session row |
| `GET /api/leagues/fan-club/seasons` | `200`, **113,308** bytes plain, **11,221** gzipped |
| `/healthz` | `200`, 0.44 s warm |
| shipped bundle | `/assets/index-DLKzlqb6.js` — the byte-identical artefact 7.8 recorded |

**One reading worth writing down, because it looks wrong and is not.**
`POST /api/leagues/fan-club/lock` with no cookie is **204**, not 401. Lock is one
of the two `OPEN_WRITES` (`guard.mjs:16`), and it has to be: a caller whose
session has already expired must still be able to lock. With no session there is
nothing to empty, so the 204 is an accurate no-op. *It is not a hole* — it grants
nothing and reads nothing. The sentence the gate asserts is about the write
routes the guard defends, and all three of those are 401 above.

### The runbook, in order — performed at a browser and the dashboard

Order matters twice: the score must be written **before** the redeploy, and the
dump must be taken **after** it.

**1. Unlock on the real URL, over HTTPS, and look at the cookie.** Open the
inspector's storage pane, not just the form. Expect `ffc.sid`, **`Secure`**,
**`HttpOnly`**, **`SameSite=Lax`**, `Path=/`, scoped to
`fantasyfootballwebapp.onrender.com`, `Max-Age` thirty days.

> **`Secure` is the whole check.** Render terminates TLS and forwards plain
> HTTP. Without `app.set("trust proxy", 1)` (`index.js:23`) Express sees `http`,
> `secure: isProduction` refuses to set the cookie, and the unlock *appears* to
> succeed while nothing persists. Everything about that failure says "the
> passphrase was wrong" and nothing about it says "the cookie was refused". It is
> the single most common works-locally-breaks-in-production bug in this shape of
> app, and this line is where it is found or ruled out.

**The unlock limiter is 10 attempts per 15 minutes** (`routes/session.js:19`),
keyed on the IP that `trust proxy` resolves. Ten wrong guesses lock the
commissioner out for a quarter of an hour; have the passphrase 7.7 set to hand
before starting.

**2. Write a real 2026 score.** The season actually in progress — the honest
test, and the one `db:import` would have deleted. Save it, and see it appear in
the season table **without a reload** (5.5's `refresh()`). Write down the week,
the matchup and both numbers; step 5 is meaningless without them.

**3. Redeploy.** Auto-deploy is on, so **the commit carrying this section is the
redeploy** — no throwaway commit is needed, and pushing it is the trigger. Watch
the log for `SIGTERM received, shutting down.` (`index.js:147`) from the old
instance, then the new `Server running` pair. **Capture the build duration**,
which is the one figure 7.8 could not scroll back far enough to read.

**4. The session survived, or it did not.** After the deploy, without unlocking
again, confirm you are still unlocked. You should be: sessions live in Postgres
(migration `004`, `connect-pg-simple`), not in the process, which is exactly why
Phase 3 decided it that way. A sign-out means either `SESSION_SECRET` changed
between deploys or the store is not being used, and both are worth stopping for.

**5. Find the score still there.** Reload and read the number back. *This is the
sentence the whole migration exists to make true:* on the old architecture the
score lived in `src/data/seasons.json`, and the deploy would have overwritten it
with whatever the commit said.

**6. Take a dump of production, immediately.** Through the container, direct
endpoint, both formats — the same idiom 7.7 used, and the pooler is avoided for
the same reason.

```sh
PROD=$(grep '^DATABASE_URL_PROD=' .env | cut -d= -f2-)
PROD_DIRECT=$(printf '%s' "$PROD" | sed 's/-pooler//')
OUT=~/fantasy-football-backups/phase7-post-write-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"

docker compose exec -T db pg_dump "$PROD_DIRECT" -Fc  > "$OUT/prod.dump"
docker compose exec -T db pg_dump "$PROD_DIRECT"      > "$OUT/prod.sql"
( cd "$OUT" && shasum -a 256 prod.dump prod.sql > SHA256SUMS.txt && shasum -a 256 -c SHA256SUMS.txt )

grep -c "<the score you wrote>" "$OUT/prod.sql"        # expect 1 or more
npm run db:check                                       # DATABASE_URL must still say localhost:5433
```

**This is the first backup that contains something the laptop does not.** From
this line the direction of truth has reversed: **production is upstream and the
working database is the copy**, which is (e)'s recorded consequence arriving.
7.10 turns this dump into a schedule, so the schedule automates something that
has been watched to work rather than something assumed.

### Fill in when performed

| Check | Read |
| --- | --- |
| cookie `Secure` / `HttpOnly` / `SameSite=Lax` | |
| the score written — year, week, matchup, both numbers | |
| redeploy trigger | the commit carrying this section |
| `SIGTERM received, shutting down.` seen | |
| **build duration** — 7.8's missing figure | |
| bundle after redeploy | expect `/assets/index-DLKzlqb6.js` **unchanged**: a docs-only commit must not move `dist/` |
| still unlocked after the deploy | |
| **the score, read back after the deploy** | |
| anonymous `PUT` on all three write shapes | **401 / 401 / 401**, taken above |
| production dump, checksummed, score present | |

**Done when:** a score saved through the public URL survives a redeploy, the
session survives it too, the cookie is `Secure`/`HttpOnly`/`Lax`, an anonymous
`PUT` is 401 on every write path, and a dump of production with that score in it
is on disk with a checksum. **The card's gate is met at that line**; everything
after it is what keeps it met.

## The declines, in one place

So the next reader knows they were considered: the **buildpack** (b), a **second
origin** (c), **migrations at boot** (d), **`db:import` against production** (e),
a **custom domain now** (g), **`pino`** (h), **paying for Render cron** and a
**GitHub Actions backup workflow** (k), and **Render's free Postgres** (a).
