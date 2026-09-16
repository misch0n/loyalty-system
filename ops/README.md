# Running the bundle

Operational notes for the Docker Compose deployment. Architecture is in
[`../README.md`](../README.md); the build plan is
[`../docs/BACKEND-PLAN.md`](../docs/BACKEND-PLAN.md).

---

## What is in the bundle

| Service | What it is | Published |
|---|---|---|
| `db` | `postgres:16-alpine`, state in the `db-data` named volume | no |
| `migrate` | one-shot: applies migrations, then creates the first admin | no |
| `api` | the Fastify server on emitted `dist/`, non-root | `127.0.0.1:3000` |
| `web` | nginx serving the SPA and proxying `/api` — **behind a profile**, see below | `:8080` |
| `mailpit` | dev override only: catches every outbound mail | `127.0.0.1:8025` |
| `backup` / `restore` | profile-gated jobs, not long-running services | no |

**`web` does not build yet, and that is deliberate.** Phase 6 retired the
IndexedDB prototype and left the screens that used it standing, so the SPA does
not compile; the maintainer chose that ordering on 2026-09-16
(`SCOPE-DECISIONS.md` §6). Until the UI pass lands, `docker compose up` brings up
the database and the API, and the API is published on loopback so it can be
probed and used. The image, the nginx config and the proxy rules are written and
reviewed — removing `profiles: ['web']` from `compose.yml` is the whole of what
the UI pass has to change here.

---

## First run

```bash
cp .env.example .env         # then fill in POSTGRES_PASSWORD and the three BOOTSTRAP_ADMIN_* values
docker compose up -d
docker compose logs -f migrate     # "Created the first admin account: <username>"
curl -s http://127.0.0.1:3000/readyz
```

`migrate` runs to completion before `api` starts, and both halves of it are
idempotent — it applies nothing on a redeploy, and the bootstrap is a no-op once
any admin exists, so it can never reset a live credential back to the
environment's.

**Without the `BOOTSTRAP_ADMIN_*` values the stack comes up with nobody able to
sign in**, because every staff route is admin-tier and there is no way to create
the first account over HTTP. The migrate container warns loudly rather than
failing, so a deploy that only needed a schema change still succeeds.

### TLS

The bundle speaks plain HTTP and the session cookies are `Secure`, so it will
not work over HTTP in production — by design (`env.ts` refuses
`COOKIE_SECURE=false` under `NODE_ENV=production`). Put Cloudflare or a
host-level reverse proxy in front of `web`. The API runs with `trustProxy`, and
nginx forwards `X-Forwarded-For` / `X-Forwarded-Proto`, so client addresses in
the logs and the rate-limit buckets are the real ones.

---

## Development

```bash
docker compose -f compose.yml -f compose.dev.yml up
```

The API runs from source under `tsx watch`; mail goes to mailpit's inbox at
<http://localhost:8025>; Postgres is on `127.0.0.1:5432`; the session cookies
drop `Secure` so a plain-HTTP page can receive them.

One thing it does not watch: editing `packages/shared` needs
`npm run build -w @cafe/shared`, because `@cafe/shared` resolves through its
`exports` map to `dist`.

---

## Health

- **`/healthz`** — liveness. Answers as long as the process is up and
  deliberately never touches the database, so a database blip cannot get a
  healthy API process killed.
- **`/readyz`** — readiness. 503 when the database is unreachable. This is what
  the container healthcheck uses and what `web` waits on.

`SIGTERM` drains in-flight requests, the background mail sender and the open SSE
streams before the pool closes (`installShutdownHandlers`); `stop_grace_period`
is 30s, which is far more than it needs.

---

## Backups

```bash
docker compose --profile backup run --rm backup
```

Writes a compressed `pg_dump` custom-format file to `BACKUP_DIR` (default
`./backups`), verifies it is readable with `pg_restore --list`, and prunes to the
newest `BACKUP_KEEP` files. A dump in progress is named `.partial` and only
renamed on success, so an interrupted run never leaves something that looks like
a good backup.

Schedule it from the host — a container that sleeps between runs is a worse cron
than cron:

```cron
17 3 * * *  cd /srv/cafe-loyalty && docker compose --profile backup run --rm backup >> /var/log/cafe-backup.log 2>&1
```

**Copy the dumps off the machine.** A backup stored beside the database it
protects survives everything except what actually happens.

Not to be confused with the admin `GET /export` route: that blanks every
credential and omits recovery codes, because a snapshot travels to laptops and
cloud drives. It is a config-and-ledger export, and a restore from it cannot
restore sign-in. `pg_dump` is the backup.

---

## Restore

Destructive — it replaces the entire contents of the target database.

```bash
docker compose stop api
RESTORE_CONFIRM=yes docker compose --profile restore run --rm restore cafe_loyalty-20260916T105655Z.dump
docker compose start api
```

The script refuses without `RESTORE_CONFIRM=yes`, verifies the dump before
touching anything, drops and recreates the `public` schema rather than relying on
`pg_restore --clean`, and prints row counts at the end.

There are no down-migrations in this system. This is the entire recovery story,
which is why the drill below is meant to be **performed**, not read.

### The drill

Restore into a scratch database rather than over the live one, so a failed drill
costs nothing:

```bash
docker compose --profile backup run --rm backup
docker compose exec db createdb -U "$POSTGRES_USER" cafe_drill
RESTORE_CONFIRM=yes PGDATABASE=cafe_drill \
  docker compose --profile restore run --rm -e PGDATABASE=cafe_drill restore <file>
```

Then check the four things that a row count alone does not prove:

1. **The append-only triggers came back.** `UPDATE loyalty_transactions SET points = 99;`
   and `DELETE FROM audit_log;` must both be refused. They are restored as
   post-data objects, so a restore that loaded the rows and stopped would leave a
   mutable ledger that looks perfectly healthy.
2. **The constraints came back.** Inserting a second active card on an existing
   email must hit `customers_email_active_key`.
3. **Sign-in works.** The argon2id digests are in the dump; if they were not, the
   café would discover it at the counter.
4. **The ledger continues.** Commit one point against a restored card and check
   the derived balance moves by one. The balance is summed from the ledger, not
   stored, so this is the assertion that the history restored coherently.

**Last performed: 2026-09-16** (Phase 8), against PostgreSQL 16.13 with the
scripts in this directory. A card with 9 accruals, a minted `unspent` reward, 10
ledger rows and 12 audit rows was dumped and restored into an empty database:
every count matched, both append-only triggers and the unique-email constraint
refused their test mutations, the bootstrapped admin signed in, and a commit
against the restored card took the derived balance from 0 to 1. Sessions restore
too and are stale but harmless — they expire, and the epoch check and idle lock
apply to them as normal.
