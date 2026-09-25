# Runbook

Written 2026-09-25, for someone who is not enjoying themselves. Four procedures,
each one copy-pasteable, each one naming what "it worked" looks like.

Read these three facts first, because each one has cost an hour somewhere:

- **Everything in `db/` reads `DATABASE_URL`. Nothing reads `DATABASE_URL_PROD`**
  (`db/check-env.mjs:51–56` exists to say so). Every production command below
  carries the override in full. **Never edit `.env` "just for a minute"** — that
  minute is the one that contains a `db:reset`.
- **Use the direct Neon endpoint, never the pooler.** The pooler serves an empty
  `search_path`, so a restore lands in nowhere and reads fail with
  *relation "seasons" does not exist*. Every snippet strips `-pooler`.
- **There is no `pg_dump`, `pg_restore` or `psql` on this Mac.** They run inside
  the `fanclub-db` container — an 18.6 client against an 18.6 server, which is
  the pairing that makes a dump restorable at all.

Set these once per shell before anything below:

```sh
cd ~/fantasy-football-web
PROD=$(grep '^DATABASE_URL_PROD=' .env | cut -d= -f2-)
PROD_DIRECT=$(printf '%s' "$PROD" | sed 's/-pooler//')
npm run db:up            # the container is where the client lives
```

---

## 1. Restore production from a dump

**Do this when** production has lost data, or an edit went wrong more than six
hours ago (inside six hours, see *Neon's own recovery* below — it is faster and
does not overwrite anything).

**How long it takes: about a minute of typing and two seconds of machine.** The
drill below was measured end to end on 2026-09-25 at **2 seconds** for checksum,
restore, `db:migrate` and `db:verify` against a 35,854-byte dump. Restoring into
Neon adds network, not work. *The question during a failure is never "can it be
restored" but "how long until it is", and the answer is: minutes.*

```sh
# 0. pick the dump and prove it is the file that was written
ls -t ~/fantasy-football-backups/
DUMP=~/fantasy-football-backups/prod-weekly-<stamp>/prod.dump
( cd "$(dirname "$DUMP")" && shasum -a 256 -c SHA256SUMS.txt )   # expect: OK, OK

# 1. REHEARSE IT LOCALLY FIRST. Always. It costs two seconds.
docker compose exec -T db psql -U fanclub -d postgres -c 'CREATE DATABASE fanclub_restoredrill;'
docker compose exec -T db pg_restore --no-owner --no-privileges --exit-on-error \
  -U fanclub -d fanclub_restoredrill < "$DUMP"
DATABASE_URL='postgres://fanclub:fanclub@localhost:5433/fanclub_restoredrill' npm run db:migrate
DATABASE_URL='postgres://fanclub:fanclub@localhost:5433/fanclub_restoredrill' npm run db:verify
docker compose exec -T db psql -U fanclub -d fanclub_restoredrill -t -c \
  "select (select count(*) from seasons), (select count(*) from players), (select count(*) from matchups);"
docker compose exec -T db psql -U fanclub -d postgres -c 'DROP DATABASE fanclub_restoredrill;'

# 2. then production. Pass the dump as a FILE PATH, not on stdin, and keep -v:
#    a custom-format archive is seekable, and a restore that silently did
#    nothing exits 0 just like one that worked.
docker compose cp "$DUMP" db:/tmp/prod.dump
docker compose exec -T db pg_restore --no-owner --no-privileges --exit-on-error -v \
  -d "$PROD_DIRECT" /tmp/prod.dump
docker compose exec -T db rm -f /tmp/prod.dump

# 3. prove it, and prove you are still pointed at the laptop afterwards
DATABASE_URL="$PROD_DIRECT" npm run db:migrate      # expect: up to date — nothing to apply
DATABASE_URL="$PROD_DIRECT" npm run db:verify       # expect: 72 team-seasons, 2026 skipped
npm run db:check                                    # DATABASE_URL must still say localhost:5433
```

**What right looks like** — the drill's numbers on 2026-09-25, off the 7.9 dump:
7 seasons, 84 teams, 618 matchups, 16 players, 84 standings, 1 league, 4
migrations, 3 sessions, 2026 at 103 matchups, and `leagues.write_secret_hash`
not null.

**If the database is not empty first,** a second restore says
`relation "leagues" already exists` — that is proof the *first* one succeeded,
not a failure of this one. Drop the schema deliberately before restoring over
live data:
`docker compose exec -T db psql "$PROD_DIRECT" -c 'drop schema public cascade; create schema public;'`

**Two things the dump carries that an import cannot reconstruct:** the league's
**passphrase hash** and the `session` rows. **A passphrase survives a restore but
not an import** (learned in 6.1). Which is also why **`npm run db:import` must
never be pointed at production** — it is truncate-and-reload, and it would delete
the 2026 season and Patrick O'Donald (`players.id = 18`), and the site would look
fine afterwards.

**The dump is a recovery point, not a mirror.** It is a photograph of a moment
that has since moved on; restoring it discards every edit made after it was
taken. Check the date before you use it.

### Neon's own recovery, and what it is not

**6 hours of instant-restore history, capped at 1 GB-month of change history, on
the free plan — re-read at Neon's own plan page on 2026-09-25**, unchanged from
the figure 7.2(k) recorded on 2026-09-24. Storage is 0.5 GB/project; compute
suspends after 5 minutes and that cannot be disabled.

**It is an undo for a bad edit made this morning, never archival.** Anything
noticed on a Monday about a Sunday is out of the window. That is what the dumps
are for. *Re-check this number and write the date next to it — a limit recorded
without a date is a limit nobody re-checks.*

---

## 2. Roll back a bad deploy

**Do this when** the site is broken and the last deploy is the reason.

Render keeps previous deploys. **A rollback is a code rollback and nothing else
— it does not touch the database**, which is the whole reason (d) keeps
migrations out of the boot path.

1. Render dashboard → the service → **Events** → find the last deploy that was
   good → **Rollback to this deploy**.
2. Or push the revert, since auto-deploy is on:
   `git revert <sha> && git push origin main`. Slower, and it leaves the history
   honest, which is usually worth the two minutes.
3. Watch `/healthz` come back: `curl -s -o /dev/null -w '%{http_code}\n' https://fantasyfootballwebapp.onrender.com/healthz` → **200**.
   A **cold start is about 12.5 seconds** (measured 7.8) and up to a minute by
   Render's documentation — wait that long before concluding anything.

**If a migration was applied for the bad deploy, the rollback is two steps and
the database one comes second.** Old code against a new schema is the case (d)
requires to be tolerable; new code against an old schema is not.

**Three ways a boot fails, each naming itself in the log** (`server/index.js`):
*Refusing to start: SESSION_SECRET…* (too short or missing), *Cannot reach the
database at …* (host printed without the credential), or a crash loop. The first
two are environment, not code, and no rollback will fix them.

**Where to look:** Render → **Logs**. The two searches worth knowing before you
need them are **`Internal error`** (the 500 handler) and
**`Idle database client error`** (the pool).

---

## 3. Rotate the league passphrase

**Do this when** the passphrase has been shared too widely, or someone who had it
should no longer have it.

```sh
DATABASE_URL="$PROD_DIRECT" npm run db:passphrase -- --league fan-club --yes
npm run db:check     # confirm you are back on localhost:5433
```

**Typed at the prompt, twice — never as an argument.** `db/passphrase.mjs:41`
refuses an argument on purpose: arguments land in shell history and in `ps`.

**It takes effect immediately, and it signs nobody out.** Existing unlocked
sessions keep working; only the next unlock needs the new words. If the point of
the rotation is to *remove* someone's access, rotate `SESSION_SECRET` too (§4) —
that is the step that ends existing sessions.

**A restore taken before the rotation carries the old hash back.** After
restoring an older dump, rotate again.

---

## 4. Rotate `SESSION_SECRET`

**Do this when** the secret may have leaked, or you need every session ended now.

**This signs everyone out.** For sixteen readers that costs nothing — reading
needs no session — and for the one commissioner it costs one unlock. Do it
deliberately, not as a side effect of something else.

1. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   **At least 32 characters or the server refuses to boot** in production
   (`server/session.mjs:33`, `MIN_PRODUCTION_SECRET_LENGTH`), which is a good failure but an avoidable one.
2. Render dashboard → the service → **Environment** → edit `SESSION_SECRET` →
   **Save**. Saving triggers a deploy on its own.
3. Wait for the deploy, then confirm: `/healthz` is 200, the site reads, and the
   editor asks for the passphrase again.

**Never commit it. The repo is public**, so a secret in a commit is a secret on
the internet within seconds — **rotate, never amend**. And nothing prefixed
`VITE_` is ever a secret: Vite inlines those into the bundle every visitor
downloads.

**The production secret is different from the local one**, deliberately, so that
rotating one is never accidentally rotating both.

---

## The weekly backup job

`scripts/backup-prod.sh`, run by `com.ryanwinn.fanclub.backup` — **Mondays at
09:00**, both formats, `SHA256SUMS.txt` beside them, one line per run in
`~/fantasy-football-backups/backup.log`.

### Installing it, once

The credential does not live in the plist, so `launchctl print` never shows it
and the template stays committable:

```sh
mkdir -p ~/.config/fanclub && chmod 700 ~/.config/fanclub
grep '^DATABASE_URL_PROD=' ~/fantasy-football-web/.env | cut -d= -f2- | tr -d '\r\n' \
  > ~/.config/fanclub/prod-url
chmod 600 ~/.config/fanclub/prod-url

cp ~/fantasy-football-web/scripts/com.ryanwinn.fanclub.backup.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ryanwinn.fanclub.backup.plist
launchctl kickstart -k gui/$(id -u)/com.ryanwinn.fanclub.backup      # the first run, by hand
sleep 30                                                             # kickstart returns at once; the run takes ~25 s
tail -1 ~/fantasy-football-backups/backup.log                        # expect: ok prod-weekly-… checksums=verified
```

The script strips `-pooler` itself, so it does not matter which endpoint that
line of `.env` holds. **Wait for the run before reading the log:** `kickstart`
returns immediately and the dump takes about 25 seconds, and *the log line is
written at the end of a run by design* — a line in that file means a complete,
checksummed dump, never an attempt. An empty or missing log right after
`kickstart` means the job is still working, not that it failed. **`launchctl bootout gui/$(id -u)/…` unloads it** — and
`bootout` then `bootstrap` again is how a plist edit takes effect; editing the
file alone does nothing.

### Checking on it

```sh
launchctl print gui/$(id -u)/com.ryanwinn.fanclub.backup | head -20   # is it loaded
launchctl kickstart -k gui/$(id -u)/com.ryanwinn.fanclub.backup       # run it now
tail -5 ~/fantasy-football-backups/backup.log
ls -t ~/fantasy-football-backups/ | head
```

**Retention is enforced by the script, not remembered:** the last **8** runs plus
the **first run of every calendar month**, and it only ever touches directories
it named itself (`prod-weekly-*`). **`phase7-pre-ship-20260924-184322` is never a
candidate and must never be deleted** — it is the last state before the app was
public, and the only artefact that can answer *what did this look like before
anyone else could touch it*.

**The failure modes, named rather than discovered:**

| Symptom | What happened | Log line |
| --- | --- | --- |
| No new directory this week | The Mac was asleep or off at 09:00 and has not woken since | *nothing* — the directory listing is the monitor |
| `FAIL(2)` | Docker was not running. **No dump was taken** | `Docker is not reachable — no dump was taken` |
| `FAIL(3)` | `pg_dump` refused; the client's own words are on the same line | `pg_dump -Fc failed — …` |
| `FAIL(4)` | The dump hung and was killed at 300 s. **A backup that hangs is worse than one that errors**, which is why there is a timeout at all | `exceeded 300s and was killed` |
| `FAIL(5)` | The files were written but did not checksum | `checksums did not verify` |

A failed run **deletes its own half-written directory**, so every directory that
exists is a complete, checksummed dump. An empty week is an absence, never a
corrupt file pretending to be a backup.

**If the checkout moves**, one line changes: `ProgramArguments` in
`~/Library/LaunchAgents/com.ryanwinn.fanclub.backup.plist`. Nothing else in the
job depends on a working directory.

**Drill it quarterly** — procedure 1, step 1, against the newest dump. *A dump
nobody has read back is a file, not a backup.*
