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
# Killing `docker run` leaves its container running, so the name is the handle
# that lets a timed-out dump be cleaned up rather than left hanging on Neon.
trap 'rm -f "$ERRFILE"; docker rm -f "$CNAME" >/dev/null 2>&1' EXIT

mkdir -p "$BACKUP_DIR" || { echo "cannot create $BACKUP_DIR" >&2; exit 1; }

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

docker info >/dev/null 2>&1 || die 2 "Docker is not reachable — no dump was taken"

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

log "ok $(basename "$DEST") dump=${DUMP_BYTES}B sql=${SQL_BYTES}B checksums=verified pruned=${pruned}"
exit 0
