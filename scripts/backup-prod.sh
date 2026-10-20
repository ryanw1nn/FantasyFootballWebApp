#!/bin/bash
#
# Weekly backup of the production database, for the launchd agent in
# com.ryanwinn.fanclub.backup.plist. Also runnable by hand.
#
# Takes both formats into a dated directory, writes SHA256SUMS.txt beside them,
# enforces the retention rule, and appends one line per run to the log.
#
# It reads nothing out of the repo: the connection string arrives in the
# environment as FANCLUB_BACKUP_URL, and pg_dump runs in a throwaway container
# from a pinned image rather than through docker compose, so moving the checkout
# cannot break the schedule.
#
#   FANCLUB_BACKUP_URL      the production connection string, or
#   FANCLUB_BACKUP_URL_FILE a file holding it on one line — preferred for the
#                           scheduled job, so the credential lives in one
#                           mode-600 file instead of inside the plist.
#   FANCLUB_BACKUP_DIR      default ~/fantasy-football-backups
#   FANCLUB_BACKUP_PREFIX   default prod-weekly — the directory name this script
#                           owns; retention touches nothing else.
#   FANCLUB_BACKUP_TIMEOUT  default 300 seconds, per pg_dump.
#
#   --if-due   exit quietly unless no `ok` run has been logged since the most
#              recent Monday 09:00. The launchd job passes it and fires at
#              login and hourly as well as on Monday, so a week the Mac was
#              shut down is caught up the next time it is used, not skipped.
#              Run by hand without it to take a dump regardless.
#
# Exit codes: 0 ok, 1 misconfigured, 2 Docker unreachable, 3 dump failed,
# 4 dump timed out, 5 checksum verify failed.

set -u
set -o pipefail

PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH

PG_IMAGE="postgres:18-alpine"   # 18.6 client against an 18.6 server; see the runbook before moving it
BACKUP_DIR="${FANCLUB_BACKUP_DIR:-$HOME/fantasy-football-backups}"
PREFIX="${FANCLUB_BACKUP_PREFIX:-prod-weekly}"
TIMEOUT="${FANCLUB_BACKUP_TIMEOUT:-300}"
KEEP_WEEKLY=8
LOG="$BACKUP_DIR/backup.log"

log() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"
}

die() {
  local code="$1"; shift
  log "FAIL($code) $*"
  exit "$code"
}

# Run a command with a wall-clock limit, without depending on a `timeout` binary
# that launchd's PATH may not contain. Returns 124 when the limit is hit.
run_limited() {
  local limit="$1"; shift
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$limit" ]; then
      kill -TERM "$pid" 2>/dev/null
      sleep 2
      kill -KILL "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

# Runs the pinned client in a throwaway container, with the client's own
# complaint kept so a failed week says why in the log rather than only in
# launchd's stderr file.
pg_client() {
  run_limited "$TIMEOUT" docker run --rm --pull=never --name "$CNAME" \
    -e PGCONNECT_TIMEOUT=30 \
    -e DBURL="$DBURL" \
    -i "$PG_IMAGE" "$@" 2>"$ERRFILE"
}

why() {
  local last
  last=$(grep -v '^[[:space:]]*$' "$ERRFILE" 2>/dev/null | tail -1)
  [ -n "$last" ] && printf ' — %s' "$last"
}

ERRFILE="$(mktemp -t fanclub-backup)"
CNAME="fanclub-backup-$$"
started=""
# Killing `docker run` leaves its container running, so the name is the handle
# that lets a timed-out dump be cleaned up rather than left hanging on Neon.
# Docker Desktop is stopped again only if this run was the one that started it.
# Through its own CLI, not osascript: under launchd, macOS silently refuses
# the Apple Event that `quit app` sends (seen 2026-10-20), since there is no
# one to answer the Automation prompt.
trap 'rm -f "$ERRFILE"; docker rm -f "$CNAME" >/dev/null 2>&1; [ -n "$started" ] && docker desktop stop --timeout 60 >/dev/null 2>&1' EXIT

mkdir -p "$BACKUP_DIR" || { echo "cannot create $BACKUP_DIR" >&2; exit 1; }

# A skipped check writes nothing to the log: it runs hourly, and a line in the
# log still means a finished run.
if [ "${1:-}" = "--if-due" ]; then
  week_start=$(date -v-mon -v9H -v0M -v0S '+%s')
  [ "$week_start" -gt "$(date '+%s')" ] && week_start=$((week_start - 7 * 86400))
  last_ok=$(grep '  ok ' "$LOG" 2>/dev/null | tail -1 | cut -c1-19)
  if [ -n "$last_ok" ]; then
    last_ok_at=$(date -j -f '%Y-%m-%d %H:%M:%S' "$last_ok" '+%s' 2>/dev/null || echo 0)
    [ "$last_ok_at" -ge "$week_start" ] && exit 0
  fi
fi

if [ -z "${FANCLUB_BACKUP_URL:-}" ] && [ -n "${FANCLUB_BACKUP_URL_FILE:-}" ]; then
  [ -r "$FANCLUB_BACKUP_URL_FILE" ] || die 1 "cannot read $FANCLUB_BACKUP_URL_FILE"
  FANCLUB_BACKUP_URL="$(tr -d '\r\n' <"$FANCLUB_BACKUP_URL_FILE")"
fi
[ -n "${FANCLUB_BACKUP_URL:-}" ] || die 1 "neither FANCLUB_BACKUP_URL nor FANCLUB_BACKUP_URL_FILE is set"

# The app and every db/ command use the direct endpoint, never the pooler: the
# pooler serves an empty search_path, so schema work lands nowhere and reads
# fail. A dump follows the same rule even if the variable was handed the pooler.
DBURL="${FANCLUB_BACKUP_URL//-pooler/}"
export DBURL

# Docker Desktop does not start at login on this Mac, and 2026-10-12 and
# 2026-10-19 were both lost to that. So start it rather than fail, and give it
# DOCKER_START_WAIT seconds to come up; FAIL(2) now means it would not start.
# A wedged engine makes `docker info` hang rather than fail (seen 2026-10-20,
# every API call answering 500), so each probe gets its own limit.
DOCKER_START_WAIT=180
docker_up() { run_limited 15 docker info >/dev/null 2>&1; }
if ! docker_up; then
  open -ga Docker >/dev/null 2>&1 || die 2 "Docker is not reachable and Docker Desktop would not open — no dump was taken"
  waited=0
  until docker_up; do
    [ "$waited" -ge "$DOCKER_START_WAIT" ] && die 2 "Docker is not reachable — started Docker Desktop, still down after ${DOCKER_START_WAIT}s — no dump was taken"
    sleep 5
    waited=$((waited + 5))
  done
  started=" docker_started=${waited}s"
fi

STAMP="$(date '+%Y%m%d-%H%M%S')"
DEST="$BACKUP_DIR/$PREFIX-$STAMP"
mkdir -p "$DEST" || die 1 "cannot create $DEST"

# Custom format first: it is the one pg_restore wants, and the one that matters.
pg_client sh -c 'pg_dump -Fc --no-owner --no-privileges "$DBURL"' >"$DEST/prod.dump"
case $? in
  0) : ;;
  124) docker rm -f "$CNAME" >/dev/null 2>&1; rm -rf "$DEST"; die 4 "pg_dump -Fc exceeded ${TIMEOUT}s and was killed" ;;
  *)   rm -rf "$DEST"; die 3 "pg_dump -Fc failed$(why)" ;;
esac

# Plain SQL second: what a human reads when the custom one will not load.
pg_client sh -c 'pg_dump --no-owner --no-privileges "$DBURL"' >"$DEST/prod.sql"
case $? in
  0) : ;;
  124) docker rm -f "$CNAME" >/dev/null 2>&1; rm -rf "$DEST"; die 4 "pg_dump (plain) exceeded ${TIMEOUT}s and was killed" ;;
  *)   rm -rf "$DEST"; die 3 "pg_dump (plain) failed$(why)" ;;
esac

# An empty or truncated dump is a failure that otherwise looks like a success.
if [ ! -s "$DEST/prod.dump" ] || [ ! -s "$DEST/prod.sql" ]; then
  rm -rf "$DEST"
  die 3 "a dump file came out empty"
fi

( cd "$DEST" && shasum -a 256 prod.dump prod.sql >SHA256SUMS.txt ) || die 1 "cannot write SHA256SUMS.txt"
( cd "$DEST" && shasum -a 256 -c SHA256SUMS.txt >/dev/null 2>&1 ) || die 5 "checksums did not verify"

DUMP_BYTES=$(wc -c <"$DEST/prod.dump" | tr -d ' ')
SQL_BYTES=$(wc -c <"$DEST/prod.sql" | tr -d ' ')

# Retention, enforced rather than remembered: the last KEEP_WEEKLY runs, plus the
# first run of every calendar month, and nothing outside this script's own
# prefix — the phase dumps, phase7-pre-ship-* above all, are never candidates.
pruned=0
listing=$(find "$BACKUP_DIR" -maxdepth 1 -type d -name "$PREFIX-*" | sort)
total=$(printf '%s\n' "$listing" | grep -c .)
index=0
seen_months=""
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  index=$((index + 1))
  # The newest KEEP_WEEKLY runs are kept whatever month they fall in.
  if [ "$index" -gt $((total - KEEP_WEEKLY)) ]; then
    continue
  fi
  name="$(basename "$dir")"
  month="${name#"$PREFIX"-}"
  month="${month:0:6}"
  # Oldest first, so the first directory seen in a month is that month's first dump.
  case " $seen_months " in
    *" $month "*) rm -rf "$dir"; pruned=$((pruned + 1)) ;;
    *) seen_months="$seen_months $month" ;;
  esac
done <<EOF
$listing
EOF

log "ok $(basename "$DEST") dump=${DUMP_BYTES}B sql=${SQL_BYTES}B checksums=verified pruned=${pruned}${started}"
exit 0
