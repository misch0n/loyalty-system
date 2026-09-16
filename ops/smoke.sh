#!/usr/bin/env bash
#
# End-to-end smoke test against a RUNNING bundle, over HTTP.
#
#   ops/smoke.sh [base-url]        default http://127.0.0.1:3000
#
# Every other test in this repo reaches the server in-process (`app.inject`) or
# reaches Postgres directly. This one talks to the deployed artifact: the emitted
# `dist/` inside a non-root container, behind the real cookie and CSRF rules, on
# a database that a one-shot `migrate` container brought up from nothing. It is
# what Phases 0, 3, 5 and 10 each did by hand at the end of the phase, written
# down so CI does it on every commit.
#
# It checks the boundary, not the logic — the 442 server tests own the logic.
# What only a live bundle can prove:
#
#   1. migrate ran, the admin was bootstrapped, and the API can reach the database
#   2. the CSRF and same-origin refusals are wired into the running server
#   3. a card can be registered, scanned, credited, and the credit is idempotent
#   4. the balance derived from the restored ledger is the one the counter wrote
#
# Needs the bootstrap admin's credentials. It reads `.env` beside `compose.yml`
# if there is one, so after a `docker compose up` this runs with no arguments.
#
# Requires: curl, jq.

set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

for tool in curl jq; do
  if ! command -v "$tool" > /dev/null 2>&1; then
    echo "ERROR: $tool is required and was not found on PATH." >&2
    exit 1
  fi
done

# The credentials come from the environment, or from the `.env` Compose reads.
#
# Read, never sourced: a real `.env` holds values like `MAIL_FROM="Ckyka"
# <no-reply@cafe.example>`, and `.`-ing that file would have the shell treat the
# angle bracket as a redirect. Only the two variables below are ever looked up,
# and neither is echoed.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
env_value() {
  [ -f "$ROOT/.env" ] || return 0
  sed -n -E "s/^[[:space:]]*$1=//p" "$ROOT/.env" | tail -1 | sed -E 's/^"(.*)"$/\1/'
}
: "${BOOTSTRAP_ADMIN_USERNAME:=$(env_value BOOTSTRAP_ADMIN_USERNAME)}"
: "${BOOTSTRAP_ADMIN_PASSWORD:=$(env_value BOOTSTRAP_ADMIN_PASSWORD)}"
: "${BOOTSTRAP_ADMIN_USERNAME:?not set, and not found in .env — the first admin of the bundle}"
: "${BOOTSTRAP_ADMIN_PASSWORD:?not set, and not found in .env}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

STATUS=''
BODY=''
FAILED=0

# --- plumbing ---------------------------------------------------------------

# req METHOD PATH [JSON-BODY]
#
# Sets $STATUS and $BODY. Cookies are carried in $COOKIE rather than in a curl
# jar on purpose: the deployed bundle sets `Secure` cookies (it is meant to sit
# behind TLS), and curl will not send a Secure cookie back over plain HTTP — so a
# jar would silently test an unauthenticated server. Holding the pair by hand
# keeps this honest about the production cookie flags.
req() {
  local method="$1" path="$2" body="${3:-}"
  local -a args=(-sS -o "$TMP/body" -D "$TMP/head" -w '%{http_code}' -X "$method" "$BASE$path")
  if [ -n "${COOKIE:-}" ]; then args+=(-H "Cookie: $COOKIE"); fi
  if [ -n "${CSRF:-}" ]; then args+=(-H "X-CSRF-Token: $CSRF"); fi
  if [ -n "${ORIGIN:-}" ]; then args+=(-H "Origin: $ORIGIN"); fi
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data "$body"); fi
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$TMP/body")"
}

# The value of a Set-Cookie on the last response, by name.
cookie_value() {
  tr -d '\r' < "$TMP/head" | grep -i "^set-cookie: $1=" | tail -1 | sed -E 's/^[^=]*=([^;]*).*/\1/'
}

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }

fail() {
  printf '  \033[31m✗\033[0m %s\n' "$1" >&2
  printf '      status: %s\n      body:   %s\n' "$STATUS" "${BODY:0:400}" >&2
  FAILED=1
  # Every later step assumes the earlier ones worked (a commit needs a card, a
  # card needs a session), so a cascade of failures would say nothing the first
  # one did not.
  exit 1
}

expect_status() {
  if [ "$STATUS" = "$1" ]; then pass "$2"; else fail "$2 — expected HTTP $1"; fi
}

# expect_json JQ-FILTER EXPECTED DESCRIPTION
expect_json() {
  local actual
  actual="$(printf '%s' "$BODY" | jq -r "$1" 2> /dev/null || true)"
  if [ "$actual" = "$2" ]; then pass "$3"; else fail "$3 — expected $1 = $2, got \"$actual\""; fi
}

json_field() { printf '%s' "$BODY" | jq -r "$1"; }

echo "Smoke-testing $BASE"

# --- 1 · the process is up and can reach the database -----------------------

COOKIE='' CSRF='' ORIGIN=''
req GET /healthz
expect_status 200 'liveness answers'

req GET /readyz
expect_status 200 'readiness answers — the API reached the database'

# --- 2 · the admin the migrate container bootstrapped can sign in -----------

req POST /auth/login \
  "$(jq -n --arg u "$BOOTSTRAP_ADMIN_USERNAME" --arg p "$BOOTSTRAP_ADMIN_PASSWORD" \
    '{username: $u, password: $p}')"
expect_status 200 'the bootstrapped admin signs in'
expect_json '.actor.role' 'admin' 'the session is an admin session'

STAFF_COOKIE="cafe_session=$(cookie_value cafe_session)"
STAFF_CSRF="$(cookie_value cafe_csrf)"
if [ "$STAFF_COOKIE" = 'cafe_session=' ] || [ -z "$STAFF_CSRF" ]; then
  fail 'sign-in did not set both the session cookie and its CSRF partner'
fi
pass 'both cookies were set (HttpOnly session + readable CSRF partner)'

COOKIE="$STAFF_COOKIE" CSRF='' ORIGIN=''
req GET /auth/session
expect_json '.status' 'active' 'the session resolves as active'

# --- 3 · the CSRF boundary is live in the running container -----------------
#
# Logout, deliberately: it is mutating, it carries a session, and a server that
# let this through would have signed us out — so a false pass here fails the
# rest of the run rather than hiding.

COOKIE="$STAFF_COOKIE" CSRF='' ORIGIN=''
req POST /auth/logout
expect_json '.error' 'csrf_failed' 'a mutating request without the CSRF header is refused'

COOKIE='' CSRF='' ORIGIN='https://evil.example'
req POST /auth/login '{"username":"x","password":"y"}'
expect_json '.error' 'forbidden_origin' 'a cross-origin sign-in is refused'

# --- 4 · a card is registered, scanned and credited -------------------------

EMAIL="smoke-$(date -u +%Y%m%d%H%M%S)-$$@example.test"

COOKIE='' CSRF='' ORIGIN=''
req POST /customers "$(jq -n --arg e "$EMAIL" '{displayName: "Smoke Test", email: $e}')"
expect_status 201 'a customer registers'
CUSTOMER_ID="$(json_field '.id')"
CUSTOMER_TOKEN="$(json_field '.token')"

req GET "/customers/by-token/$CUSTOMER_TOKEN"
expect_status 200 'the card resolves by its token, as the QR does'

IDEMPOTENCY_KEY="smoke-$(date -u +%s)-$$"
COMMIT_BODY="$(jq -n --arg k "$IDEMPOTENCY_KEY" \
  '{pointsDelta: 1, redeemRewardIds: [], idempotencyKey: $k, source: "a"}')"

COOKIE="$STAFF_COOKIE" CSRF="$STAFF_CSRF" ORIGIN=''
req POST "/customers/$CUSTOMER_ID/commit" "$COMMIT_BODY"
expect_status 200 'staff commits a point'
expect_json '.ok' 'true' 'the commit succeeded'
expect_json '.replayed' 'false' 'the first commit was not a replay'

req POST "/customers/$CUSTOMER_ID/commit" "$COMMIT_BODY"
expect_json '.replayed' 'true' 'the same idempotency key replays instead of double-writing'

req GET "/customers/$CUSTOMER_ID/state"
expect_status 200 'the card state reads back'
expect_json '.balance' '1' 'the balance derived from the ledger is 1, not 2'

echo
if [ "$FAILED" -eq 0 ]; then
  echo 'Smoke test passed.'
else
  exit 1
fi
