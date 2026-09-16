#!/bin/sh
#
# Backup job. Runs inside the stock `postgres:16-alpine` image so the client
# version always matches the server's:
#
#   docker compose --profile backup run --rm backup
#
# Writes a compressed custom-format dump to /backups (bind-mounted from
# BACKUP_DIR on the host), verifies it is readable, and prunes to the newest
# BACKUP_KEEP files.
#
# Why `pg_dump` and not the admin `GET /export` route: that route deliberately
# blanks every credential and omits recovery codes, because a snapshot travels to
# laptops and cloud drives (Phase 4, Phase 6). It is a config-and-ledger export,
# not a backup — a restore from it cannot restore sign-in. This is the backup.

set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

DIR=/backups
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/${PGDATABASE}-${STAMP}.dump"

if [ ! -d "$DIR" ]; then
  echo "ERROR: $DIR is not mounted. Set BACKUP_DIR in .env." >&2
  exit 1
fi
if [ ! -w "$DIR" ]; then
  echo "ERROR: $DIR is not writable by uid $(id -u)." >&2
  exit 1
fi

echo "Dumping $PGDATABASE from $PGHOST…"

# Written to `.partial` and renamed only on success. A dump interrupted by a
# killed container, a full disk or a restarting database must never be left
# looking like a good one — that is the backup an operator reaches for at the
# worst possible moment.
#
# Custom format (`-Fc`) rather than plain SQL: it is compressed, and it is what
# `pg_restore` needs to restore selectively or to list the contents without
# applying them, which is how the verify below works.
pg_dump --format=custom --compress=9 --file="$FILE.partial"

# Proves the file has a readable table of contents, so a truncated or corrupt
# dump is caught now rather than during an emergency. It is not a full restore —
# `ops/README.md` has the drill for that, and it is meant to be performed.
if ! pg_restore --list "$FILE.partial" > /dev/null 2>&1; then
  echo "ERROR: the dump is not readable by pg_restore; keeping it as $FILE.partial" >&2
  exit 1
fi

mv "$FILE.partial" "$FILE"
echo "Wrote $FILE ($(wc -c < "$FILE") bytes)"

# Retention. `ls -t` is newest-first, so everything past the KEEPth is older than
# every file kept. Only this job's own dumps are considered — a `.partial` from a
# failed run and anything an operator has put here are left alone.
if [ "$KEEP" -gt 0 ]; then
  ls -1t "$DIR/${PGDATABASE}-"*.dump 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
    echo "Pruning $old"
    rm -f "$old"
  done
fi

echo "Backup complete. Copy it OFF this machine — a backup stored beside the"
echo "database it protects survives everything except what actually happens."
