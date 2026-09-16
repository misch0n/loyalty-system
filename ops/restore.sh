#!/bin/sh
#
# Restore a dump written by `ops/backup.sh`. DESTRUCTIVE — it replaces the entire
# contents of the target database.
#
#   docker compose stop api
#   RESTORE_CONFIRM=yes docker compose --profile restore run --rm restore <file>
#   docker compose start api
#
# Stop `api` first. Not for correctness — the schema is dropped and rebuilt
# inside one transaction-per-object either way — but because a server holding a
# connection pool against a database whose tables are vanishing produces a
# minute of alarming and meaningless errors, and because a till writing to a
# database mid-restore is writing into something it will lose.
#
# There are no down-migrations in this system (BACKEND-PLAN §2). This is the
# entire recovery story, which is why the drill in `ops/README.md` is meant to be
# performed rather than read.

set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

if [ $# -lt 1 ]; then
  echo "Usage: restore.sh <dump-file>   (a name inside /backups, or a full path)" >&2
  echo >&2
  echo "Available:" >&2
  ls -1t /backups/*.dump 2>/dev/null | sed 's|/backups/|  |' >&2 || echo "  (none)" >&2
  exit 64
fi

FILE="$1"
[ -f "$FILE" ] || FILE="/backups/$1"
if [ ! -f "$FILE" ]; then
  echo "ERROR: no such dump: $1" >&2
  exit 66
fi

# A restore is not a thing to do by tab-completion. The flag is an environment
# variable rather than a prompt so that `run --rm` works non-interactively, and
# so the confirmation appears in whatever shell history or runbook invoked it.
if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  echo "REFUSING: this REPLACES every row in \"$PGDATABASE\" on $PGHOST." >&2
  echo "Re-run with RESTORE_CONFIRM=yes if that is what you want." >&2
  exit 1
fi

echo "Verifying $FILE…"
pg_restore --list "$FILE" > /dev/null

echo "Restoring $FILE into $PGDATABASE on $PGHOST…"

# Drop and recreate the schema rather than `pg_restore --clean`. `--clean` emits
# a DROP for each object and reports failures for the ones that were not there,
# which turns "did the restore work?" into an exercise in reading error output.
# An empty schema makes the answer unambiguous.
psql --set ON_ERROR_STOP=1 --quiet --command 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

# `--no-owner`: the dump records the role that owned each object, which need not
# exist on the cluster being restored into — a drill restores into a scratch
# database, and a rebuild may use a different role name. Objects end up owned by
# the connecting user, which is what the application connects as anyway.
#
# `--exit-on-error`: the default is to report failures and carry on, which
# produces a half-restored database and a zero exit status.
pg_restore --no-owner --exit-on-error --dbname "$PGDATABASE" "$FILE"

echo
echo "Restored. Sanity check:"
psql --quiet --tuples-only --command "
  SELECT '  customers:    ' || (SELECT count(*) FROM customers)
  UNION ALL SELECT '  ledger rows:  ' || (SELECT count(*) FROM loyalty_transactions)
  UNION ALL SELECT '  rewards:      ' || (SELECT count(*) FROM rewards)
  UNION ALL SELECT '  audit rows:   ' || (SELECT count(*) FROM audit_log)
  UNION ALL SELECT '  staff:        ' || (SELECT count(*) FROM staff_accounts)
  UNION ALL SELECT '  migrations:   ' || (SELECT count(*) FROM schema_migrations)"

echo
echo "Sessions restored from the dump are stale but harmless — they expire, and"
echo "the epoch check and the idle lock apply to them as normal."
echo "Start the API again: docker compose start api"
