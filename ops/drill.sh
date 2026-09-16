#!/usr/bin/env bash
#
# The restore drill, performed rather than read.
#
#   ops/drill.sh
#
# `ops/README.md` describes this drill and Phase 8 performed it by hand once.
# Once is the problem: a backup path that was proven in September and never
# exercised again is a backup path nobody knows the state of, and the one moment
# it matters is the worst possible moment to find out. So this is the drill as a
# script, run by CI against the real bundle on every commit.
#
# It backs the live database up with `ops/backup.sh`, restores the dump into a
# SCRATCH database with `ops/restore.sh`, and asserts the four things a row count
# alone does not prove. The live database is never written to and never dropped —
# a failed drill costs nothing, which is what makes it safe to run this often.
#
# What it does NOT prove, and `ops/README.md` keeps as a manual step: that the
# restored database serves a real sign-in and a real commit through the API. That
# needs the bundle re-pointed at the scratch database. What is automated here is
# the part that silently rots — the schema objects, the constraints and the
# credential digests surviving the round trip.
#
# Requires: docker compose, and a bundle that is up.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRILL_DB="${DRILL_DB:-cafe_drill}"

env_value() {
  [ -f "$ROOT/.env" ] || return 0
  sed -n -E "s/^[[:space:]]*$1=//p" "$ROOT/.env" | tail -1 | sed -E 's/^"(.*)"$/\1/'
}
: "${POSTGRES_USER:=$(env_value POSTGRES_USER)}"
: "${POSTGRES_DB:=$(env_value POSTGRES_DB)}"
: "${POSTGRES_USER:?not set, and not found in .env}"
: "${POSTGRES_DB:?not set, and not found in .env}"

# Where `backup.sh` will write, on the host side of the bind mount. Compose
# resolves the same variable for the container, so the two must agree — hence
# reading `.env` rather than defaulting independently.
: "${BACKUP_DIR:=$(env_value BACKUP_DIR)}"
: "${BACKUP_DIR:=$ROOT/backups}"

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() {
  printf '  \033[31m✗\033[0m %s\n' "$1" >&2
  exit 1
}

# `-qtAX`: quiet, tuples only, unaligned, no ~/.psqlrc — so a query returns
# exactly its value and nothing that has to be trimmed.
live() { docker compose exec -T db psql -qtAX -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"; }
drill() { docker compose exec -T db psql -qtAX -U "$POSTGRES_USER" -d "$DRILL_DB" -c "$1"; }

# Runs a statement that MUST be refused, and reports the failure if it is not.
# `ON_ERROR_STOP` makes psql's exit status the assertion.
refused() {
  if docker compose exec -T db psql -qtAX -v ON_ERROR_STOP=1 \
    -U "$POSTGRES_USER" -d "$DRILL_DB" -c "$1" > /dev/null 2>&1; then
    fail "$2 — the statement was ACCEPTED"
  fi
  pass "$2"
}

cleanup() {
  docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$DRILL_DB" > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Restore drill: $POSTGRES_DB → $DRILL_DB"

# --- 1 · the state the drill has to reproduce -------------------------------

CUSTOMERS="$(live 'SELECT count(*) FROM customers')"
LEDGER="$(live 'SELECT count(*) FROM loyalty_transactions')"
AUDIT="$(live 'SELECT count(*) FROM audit_log')"
REWARDS="$(live 'SELECT count(*) FROM rewards')"
STAFF="$(live 'SELECT count(*) FROM staff_accounts')"
# The balance is summed from the ledger, never stored, so this is the number
# that proves the history restored coherently rather than merely completely.
POINTS="$(live 'SELECT coalesce(sum(points), 0) FROM loyalty_transactions')"
echo "  live: ${CUSTOMERS} customers · ${LEDGER} ledger rows (${POINTS} points) · ${AUDIT} audit · ${REWARDS} rewards · ${STAFF} staff"

if [ "$LEDGER" -eq 0 ] || [ "$CUSTOMERS" -eq 0 ]; then
  fail 'the live database has no card and no ledger — a drill over an empty database proves nothing'
fi

# --- 2 · back up, then restore into a scratch database ----------------------

docker compose --profile backup run --rm backup
DUMP="$(ls -1t "$BACKUP_DIR"/*.dump 2> /dev/null | head -1 || true)"
[ -n "$DUMP" ] || fail "no dump was written to $BACKUP_DIR"
pass "backup written: $(basename "$DUMP")"

cleanup
docker compose exec -T db createdb -U "$POSTGRES_USER" "$DRILL_DB"

# `-e PGDATABASE` is what makes this a drill rather than a restore: the dump goes
# into the scratch database and the live one is never touched.
docker compose --profile restore run --rm \
  -e "PGDATABASE=$DRILL_DB" -e RESTORE_CONFIRM=yes restore "$(basename "$DUMP")"

# --- 3 · what a row count does not prove ------------------------------------

# (a) Everything came back, including the derived balance.
for pair in "customers:$CUSTOMERS" "loyalty_transactions:$LEDGER" "audit_log:$AUDIT" \
  "rewards:$REWARDS" "staff_accounts:$STAFF"; do
  table="${pair%%:*}"
  expected="${pair##*:}"
  actual="$(drill "SELECT count(*) FROM $table")"
  [ "$actual" = "$expected" ] || fail "$table: restored $actual rows, expected $expected"
done
pass 'every table restored with the same row count'

RESTORED_POINTS="$(drill 'SELECT coalesce(sum(points), 0) FROM loyalty_transactions')"
[ "$RESTORED_POINTS" = "$POINTS" ] ||
  fail "the ledger sums to $RESTORED_POINTS, expected $POINTS — the derived balance would be wrong"
pass "the ledger still sums to $POINTS — the derived balance survives"

# (b) The append-only triggers came back. They are restored as post-data
#     objects, so a restore that loaded every row and stopped short would leave a
#     mutable ledger that looks perfectly healthy.
refused 'UPDATE loyalty_transactions SET points = 99' \
  'the append-only trigger still refuses an UPDATE on the ledger'
refused 'DELETE FROM audit_log' \
  'the append-only trigger still refuses a DELETE on the audit log'

# (c) The constraints came back. One active card per address is the rule the
#     whole registration flow leans on (SCOPE-DECISIONS §2.1).
refused "INSERT INTO customers (id, token, short_code, display_name, email, status, created_at)
         SELECT 'drill-dup', 'drill-token-0000000000000000000000000000', 'DRILLX',
                display_name, email, 'active', now()
         FROM customers WHERE status = 'active' AND email IS NOT NULL LIMIT 1" \
  'the unique-email constraint still refuses a second active card on one address'

# (d) The credential digests are in the dump. If they were not, the café would
#     discover it at the counter. A full sign-in needs the API pointed at this
#     database; that the digests are argon2id and not empty is what can be
#     checked from here.
HASHED="$(drill "SELECT count(*) FROM staff_accounts WHERE password_hash LIKE '\$argon2id\$%'")"
[ "$HASHED" = "$STAFF" ] ||
  fail "only $HASHED of $STAFF staff accounts restored an argon2id password digest"
pass 'the argon2id credential digests restored intact'

echo
echo 'Restore drill passed.'
