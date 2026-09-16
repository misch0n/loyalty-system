# Backend — build plan (prototype → production, Docker Compose bundle)

> **Active initiative.** Replaces the prototype's browser-local backing (IndexedDB +
> localStorage + PeerJS pairing) with a real **Node + TypeScript + Fastify + PostgreSQL**
> backend, shipped as a **Docker Compose bundle**. Executes SPEC §14 (Prototype →
> Production Migration) steps 1, 2, 4 and 5. Step 3 (Wallet) is **out of scope entirely** — the
> triage dropped wallet, retiring the `WalletProvider` port with it.
>
> ### ⚠ THE PLAN'S ORIGINAL PROMISE IS REVOKED (maintainer, 2026-09-16)
>
> **Was:** *no UI or service rewrite* — every screen and every `services/` call site stays
> byte-for-byte identical, only adapters and the composition root change, and a phase that
> needed to touch `src/ui/` was a defect in the plan.
>
> **Now:** *the backend is built the way it needs to be built, without consideration for the
> UI.* When the backend is complete the UI is adjusted to it, **taking the backend as ground
> truth**, and every place the two disagree is written down for the maintainer to confirm
> rather than quietly resolved. The register is
> [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md) — **add to it as you go**; it is what the UI
> pass starts from, and a conflict nobody recorded is a conflict nobody confirms.
>
> Three consequences, all load-bearing:
> - **`ports/DataStore.ts` and `src/services/` are now editable.** Every compromise taken
>   because Phases 0–9 may not touch a shared file is back on the table — §4 lists them.
> - **The IndexedDB prototype is retired, not frozen** (same decision). One store, one truth.
>   `IndexedDbStore`, the PeerJS pairing layer, the wallet and transport adapters, `EmailJsMailer`
>   and the GitHub Pages demo all go. See §2, *Prototype path*.
> - **The SPA stops building, knowingly, and stays broken until the UI pass.** From the phase
>   that deletes `IndexedDbStore` onward the release gate is the **server suite + server
>   `tsc`**, and nothing else. A red SPA build during the backend run is expected, not a
>   regression to chase.

---

## 0 · HOW TO USE THIS ACROSS SESSIONS (read first)

Same protocol as [`REWARDS-PLAN.md`](REWARDS-PLAN.md) — written so work continues with
context cleared between tasks.

**Resume protocol for a new session:**
1. Work on branch **`claude/backend-implementation-2kqb08`**. Merge `origin/main` first.
2. Read [`STATUS.md`](STATUS.md) (current state), [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md)
   (what is in scope — it **overrides** `../CLAUDE.md` where they differ), the revoked-promise
   box at the top of this file, then this file.
3. Find the first **unchecked** box in the *Progress checklist* (§1) — that's the next task.
4. Do **only that phase**. Stay within its file list. Honour the architecture rules in
   [`../CLAUDE.md`](../CLAUDE.md), as amended by SCOPE-DECISIONS §5 and §6.
5. Before committing, the gate is **`npm test -w @cafe/server`** (**442** as of Phase 8) plus
   **`npm run typecheck -w @cafe/server`** — the server suite does *not* typecheck itself.
   Phase 10 also gave `packages/shared` its own gate, and it is cheap, so run it too:
   **`npm test -w @cafe/shared`** (**73**) and **`npm run typecheck -w @cafe/shared`**.
   **Root `npm test` / `npm run build` are no longer a gate** and are expected to be red from
   Phase 6 (prototype retirement) until the UI pass; see the revoked-promise box. Until Phase 6
   they should still pass, so keep running them.
   *(Pre-Phase-10 sessions ran `npx tsc --noEmit -p packages/server/tsconfig.json` for the
   typecheck. That still works, but it needs `packages/shared/dist` to exist first — the
   `pretypecheck` script is what builds it, so prefer the npm script.)*
   **Since Phase 9 this gate also runs in CI** (`.github/workflows/ci.yml`), against a Postgres
   service container, alongside a bundle job that brings Compose up from nothing and smoke-tests
   it. CI is the check, not the substitute: run the four commands locally before you push, or you
   find out eight minutes later.
6. **Record every backend-vs-UI conflict you create** in
   [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md). This is not optional bookkeeping — it is the
   entire input to the UI pass, and the maintainer confirms from it.
7. Tick the box here, update the `STATUS.md` "Last updated" line, commit + push.
8. Stop. The next session picks up the next box.

**The parallel-frontend warning is retired.** It said Phases 0–9 must not move or rewrite a
single existing frontend file, because a frontend agent was landing work on `main` and the
monorepo move would conflict with every diff it produced. Both halves are gone: the UI is now
adjusted *after* the backend rather than beside it, and the prototype it was protecting is being
deleted. What survives from it is one habit worth keeping — **merge `main` at the start of every
phase**.

Its second legacy — two compilers disagreeing about `domain/` — is **closed**. Phase 4 had to make
`src/domain/alerts.ts` index-safe to import it under the server's stricter tsconfig, and Phase 10
found the identical problem waiting in `domain/insights.ts`. `packages/shared` now has **one**
tsconfig and it is the strict one, so there is no second, looser compiler left to drift from.

**Running the server tests.** The suite **requires** a real Postgres and fails without one:
`packages/server/src/testing/globalSetup.ts` checks reachability once per run and aborts with
setup instructions, so there is no way to get a green tick without a database. Most of the 434
tests are database-backed. Point the suite somewhere with `TEST_DATABASE_URL` (default
`postgres://cafe:cafe@localhost:5432/cafe_loyalty_test`). Until the Compose bundle lands in
Phase 8, a local server does the job:

```bash
export PGDATA=/var/lib/postgresql/testdata          # any directory postgres can own
mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l /tmp/pg.log -w start"
su postgres -c "psql -h localhost -c \"CREATE ROLE cafe LOGIN PASSWORD 'cafe' SUPERUSER;\""
su postgres -c "psql -h localhost -c 'CREATE DATABASE cafe_loyalty_test OWNER cafe;'"
npm test -w @cafe/server                             # expect: 434 passed, 0 skipped
```

**Do not reintroduce a skip.** The conformance harness has no `skip` option, and the database
check lives in the Vitest config rather than in a `skipIf` per file — so a new database-backed
test cannot opt out by accident. A skipped conformance run proves nothing while still reporting
green, which is worse than not running it at all. (It was written to prove `PostgresStore` and
`IndexedDbStore` behaved alike; Phase 6 deleted the second store, and the suite survives as
`PostgresStore`'s own specification — see its header.)

**Scope.** The maintainer's feature triage (2026-09-02) is recorded in
[`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md) and **supersedes this plan wherever they differ** —
it retires the wallet and transport seams, drops every admin stats/export surface, makes name and
email mandatory, and reshapes recovery. The wallet phase is deleted and §3 below is trimmed accordingly.
Read that file before starting any phase.

**Baseline.** Written against `main` at **`8588e44`**, which includes the completed
**Appendix E** rework ([`INTEGRITY-PLAN.md`](INTEGRITY-PLAN.md) — pre-commit hold, two
configurable detectors, no ambient activity feeds, audited export). Merged into this branch
clean; `tsc` + **448 tests** green at the merge. Appendix E changed the `DataStore` port
(dropped `undoCommit` → **33** methods) and `AuditFilter` (ranged, multi-value), so §3 and §4
below are stated against the post-Appendix-E contract, not the rewards-rework one.

---

## 1 · Progress checklist

> **NEXT TASK: the UI pass** — and it is **a separate initiative, not the next box in this plan**.
> Every backend phase is now built. **Read the revoked-promise box at the top of this file first,**
> then [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md), which is the pass's entire input: 30-odd
> rows, each saying what the server does, what the screens do today, and whether the maintainer
> still has to rule on it. Several are **Open** or **Confirm** — the offline posture (X2), the PIN
> that no longer identifies anyone (S1), the services that no longer compile (C3, A3, P5–P8) —
> and those want answers before screens are written, not during. **It deserves its own
> phase-by-phase plan**, written from the register the way this file was written from SPEC §14; do
> not start editing screens straight out of this box. The other unchecked box, **Phase 11**
> (docs), is deliberately *after* it: most of what it has to write down is what the UI pass
> decides.
>
> Phase 9 landed 2026-09-16, and it is what makes every phase above self-checking rather than
> merely once-verified: `.github/workflows/ci.yml` — four jobs, `contract` · `server` · `bundle` ·
> `web`. `server` runs the suite against a **Postgres service container** and then proves the
> database gate still fails closed by pointing the same suite at a dead port. `bundle` brings the
> Compose stack up **from an empty volume**, smoke-tests the running API over HTTP
> (`ops/smoke.sh`), scans the container logs for the credentials and PII that just passed through
> it, and performs the **restore drill** (`ops/drill.sh`) into a scratch database. `web` is
> `continue-on-error` — the SPA is red by decision and must not gate anything.
>
> Phase 8 landed 2026-09-16: `compose.yml` (db · migrate · api · web · backup · restore) and
> `compose.dev.yml` (db · migrate · api · mailpit), non-root images, healthchecks, `.env.example`,
> `ops/backup.sh` + `ops/restore.sh` + `ops/README.md`. **The restore drill was performed, not
> just scripted** — a custom-format dump round-tripped all 11 tables into a fresh database via
> `pg_restore`. `logging.ts` now separates `code` (a recovery credential at a call site) from
> `err.code` (a Postgres SQLSTATE or Node error code), which blanket redaction had been censoring
> — the single most useful field when diagnosing a 500. **442 server tests** (was 434).
> **`docker compose up` deliberately does not build the SPA**: the `web` service sits behind a
> `web` profile because `@cafe/web` does not compile, so the bundle brings up the database and the
> API and nothing stalls on a known-red package.
>
> Phase 7 landed 2026-09-16: **`GET /events`**, a one-way SSE channel carrying a `changed`
> **signal** (`{scope, id, reason}`) per customer and per till. The subjects are derived from the
> session, never named by the client. **434 server tests** (was 390); **73 shared tests**,
> unchanged. The client subscriber is UI-pass work — register rows **X6** and **X7**.
>
> Phase 10 landed 2026-09-16: the repo is a **three-package npm workspaces monorepo** —
> `@cafe/shared` (the contract), `@cafe/server`, `@cafe/web`. `@cafe/shared` is a real package
> resolved through its `exports` map, not an alias, and the server **emits and runs on plain
> `node`** — `tsx` is only the `dev` watcher now, which closes the Phases 0–1 open item.
>
> **The SPA is still red, on purpose** — 9 of its now-47 test files fail to load and `tsc -b`
> fails, which is the outcome the 2026-09-16 decision chose. Do not chase it. **The gate is
> `npm test -w @cafe/server` + `npm run typecheck -w @cafe/server`** (and, cheaply,
> the same two for `@cafe/shared`), **and nothing else**, until the UI pass.
>
> **The server suite needs a real Postgres and FAILS without one** — it does not skip. Most of
> its tests are database-backed, and before Phase 2 they skipped themselves when no database was
> reachable, so a run with no Postgres reported `22 passed | 84 skipped` and exited **0** — green,
> having tested nothing. It now aborts in `globalSetup` with the commands to start one. See §0
> *Running the server tests*.
>
> Read §5 Phase 7 and the decisions Phases 1–10 recorded at the foot of §5 before starting.
>
> **A live gap Phase 4 found and did not fix, for whoever reaches Phase 8:** `bootstrap.ts` is
> built and tested but **nothing calls it**. `index.ts` does not (a long-running API should not
> seed), and `migrate.ts`'s CLI entrypoint does not either — so a freshly migrated database has no
> admin and no way to create one over HTTP, since `POST /staff` is admin-tier. The one-shot
> `migrate` container is the natural place; wire it there.
>
> **And one for Phase 8, carried from Phase 4 and now slightly sharper:** `logging.ts` lists `code`
> among `SENSITIVE_KEYS`, which is exactly right for a recovery code and also redacts a Postgres
> error's SQLSTATE. Phase 5 works around it by putting the provider's error code in the *message*
> (`SMTP send failed for a "recovery" mail (ESOCKET)`); narrow the key when Phase 8 revisits logging.

> **Phase numbers are labels, not sequence.** The 2026-09-16 decision reordered the work and
> gave **Phase 6** entirely new contents; renumbering the rest would invalidate every forward
> reference the "as built" notes already carry (*"whoever reaches Phase 8"*, *"Phase 10 or 11"*,
> …). So each number keeps its subject and the list below is in **execution order**. Old Phase 6
> (client adapters) is no longer a backend phase at all — it moved into the UI pass, because
> `ApiStore` cannot be finished without the service and screen decisions the UI pass makes.

- [x] **Phase 0** — Workspace scaffolding + Fastify skeleton (no frontend files touched)
- [x] **Phase 1** — Postgres schema + migrations
- [x] **Phase 2** — `PostgresStore` + the shared `DataStore` conformance suite  ⟵ the core
- [x] **Phase 3** — Auth: password/PIN hashing, sessions, epoch revocation, rate limits
- [x] **Phase 4** — HTTP API surface + the authorization boundary
- [x] **Phase 5** — Server-side `Mailer` + recovery flow
- [x] **Phase 6** — **Retire the prototype + reshape the shared port**  ⟵ the SPA went red here
- [x] **Phase 10** — Monorepo flip (`packages/shared` + `packages/web`) — pulled forward
- [x] **Phase 7** — Realtime push (SSE) — replaces what device pairing provided
- [x] **Phase 8** — Docker Compose bundle + ops (backups, health, logging)
- [x] **Phase 9** — CI + integration tests against a real Postgres  ⟵ **the backend build ends here**
- [ ] **— UI pass —** a separate initiative: client adapters, services reshaped to the API,
      screens reconciled against [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md)
- [x] **Phase 11** — Docs — **backend half done 2026-09-16**; the UI half is UI-PLAN's UI-9.
      Done: `CLAUDE.md`'s architecture rules (five ports → three, `Transport`/`WalletProvider`
      gone, PII now required, the PeerJS section replaced by the server-backed one, the stale
      warning box consolidated), `README.md`'s header, seam table, ports/adapters diagram, file
      tree and migration diagram. Deferred to UI-9 because the screens still exist: `CLAUDE.md`'s
      `## UI` section and `README.md`'s feature table, both explicitly bannered as pre-UI-pass.

Phase 2 was the big one and everything from 4 onward builds on it (Phases 0+1 landed together).
The wallet phase is gone — the triage dropped wallet entirely.

**Why Phase 10 moved forward.** It was last for one reason: a monorepo move renames every
frontend file and would have conflicted with every diff the parallel frontend agent produced.
That agent is gone, and Phases 8 and 9 both *encode the file layout* — a Dockerfile and a CI
workflow written against `src/` would be rewritten days later. Flipping before them costs
nothing and saves that rework. It is also much cheaper than it was: Phase 6 deletes most of what
`src/` contains before anything has to be moved.

---

## 2 · Locked decisions (settled with the maintainer)

| # | Decision | Rationale |
|---|---|---|
| Code layout | **npm workspaces monorepo** — `packages/shared` (domain + ports), `packages/web` (the SPA), `packages/server`. One source of truth for the contract; no drift. | Chosen over a path-alias `server/` and over a duplicated copy. A drifting copy of `ports/DataStore.ts` is exactly the failure the ports architecture exists to prevent. |
| Move timing | **REVISED 2026-09-16 — the move runs straight after Phase 6**, not last. **Done** (Phase 10, 2026-09-16): `packages/shared` holds `domain` + `ports`, `packages/web` holds what remained of `src/`, and `@cafe/shared` is a real workspace package resolved through its `exports` map rather than a tsconfig alias. | It was last to avoid conflicting with every diff the parallel frontend agent produced. That agent is gone, and Phases 8 and 9 both encode the file layout — writing a Dockerfile and a CI workflow against `src/` and then moving it is pure rework. Destination unchanged; only the ordering moved, and Phase 6 shrinks the thing being moved first. |
| HTTP + DB | **Fastify + `pg` + hand-written numbered SQL migrations.** No ORM. | Matches the repo's "small and boring" rule. The commit transaction is the one piece of logic that must be *obvious* — explicit `BEGIN` / `SELECT … FOR UPDATE` / `COMMIT` beats an ORM's transaction abstraction. Fastify's JSON-schema route validation covers the boundary without a validation dependency. |
| Sessions | **HttpOnly, `Secure`, `SameSite=Lax` cookie sessions for both staff and customers**, server-side session rows. CSRF via double-submit token on all mutating routes. | Server-set HttpOnly cookies are the **only** customer recognition that survives iOS ITP — the durability gap [`COLLAB-NOTES.md`](COLLAB-NOTES.md) records as unsolvable client-side, and a large part of why the backend is worth building. Cookie sessions also make `sessionEpoch` revocation real (delete the rows) rather than "wait for the JWT to expire". |
| Passwords/PINs | **argon2id**, hashed **server-side from the plaintext**. The client never hashes. | See §4-A: `setStaffPassword(id, passwordHash)` as written would make the hash itself the password. |
| Actor | `staffId` / actor identity is **always derived from the session server-side** and overrides anything in the request body. | The client is untrusted. This is the anti-fraud anchor from `CLAUDE.md` ("staff initiates the credit") made real. |
| Audit | Audit rows are written **by the route handler**, server-side, in the same transaction as the action. The client's `appendAudit` becomes a rejected/no-op call. | A client-writable audit log is not an audit log. |
| Migrations | Numbered, forward-only `.sql` files applied by a one-shot `migrate` container before `api` starts. No down-migrations. | Restores are from backups, not from down-migrations. |
| ~~Prototype path~~ **REVERSED 2026-09-16** | The IndexedDB prototype is **retired, not kept**: `IndexedDbStore`, `adapters/sync/` (PeerJS pairing), `adapters/transport/`, `adapters/wallet/`, `EmailJsMailer`, `demoSeed`, the `VITE_*` adapter flags and the GitHub Pages deploy all go in Phase 6. One store, one truth. | It was kept to be the demo, the reference implementation, and the proof that the swap preserves behaviour. The third reason is gone — the maintainer has dropped behaviour preservation as a goal — and the first two do not justify mirroring every server-shaped port change into a second adapter. The cost is accepted and stated: **no demoable build at all until the server-backed UI is deployable.** |
| Corrections | **No post-commit undo, server-side or otherwise.** The staff counter's 3-second **pre-commit hold** is purely client-side and survives the swap untouched; the only correction primitive is `LoyaltyService.reverse` (a ledger entry). | Appendix E decision — a "reverse an already-committed transaction" endpoint is exactly the affordance staff misuse. `CLAUDE.md`: do not reintroduce `undo`/`undoCommit`/`planUndo`. The backend must not add one back under a new name. |
| Cross-account reads | The API exposes **no cross-account activity endpoint at all** — the triage dropped the export surface too (SCOPE-DECISIONS §1). Audit rows are collected and reachable only by querying the database directly. The ranged audit query survives as an **internal** server function feeding the detectors, with no route attached. | Appendix E deleted every ambient feed; the triage went further and deleted the sanctioned export as well. A backend makes both *easy* to re-expose, which is why it's locked here. |

---

## 3 · What the backend has to cover (the scope list)

Trimmed to the triage outcome ([`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md)). Each area maps to a phase.

### A · Data & storage

1. **Postgres schema** — `program_config` (singleton row, now including the four Appendix E
   detector thresholds), `staff_accounts`, `customers`, `loyalty_transactions`, `rewards`,
   `reward_events`, `idempotency_keys`, `recovery_codes`, `audit_log`, `sessions`. Mirrors
   IndexedDB schema **v6** (`src/adapters/storage/schema.ts`) plus a `sessions` table the
   prototype never needed. Note `idempotency_keys` is now **dedup-only** (`key` + cached
   `result`) — Appendix E stripped the commit-effect columns the old undo needed — so it is a
   cache, not a record, and wants a TTL sweep. Everything else is retained unbounded
   (Appendix E: no retention policy, which also sidesteps the ledger-balance pruning trap).
   *(Phase 1)*
2. **Indexes + constraints** carrying every IDB index across: customers by token /
   short code / email; rewards by owner / token / status / short code; reward events by
   reward / owner; transactions by customer + timestamp; audit by action / actor /
   timestamp — the last of these now has to serve Appendix E's **ranged, multi-value**
   `AuditFilter` (`actions[]` / `actorIds[]` / `from` / `to`), so index on `(timestamp)`,
   `(action, timestamp)` and `(actor_id, timestamp)`. Plus what IndexedDB *couldn't*
   enforce: unique short codes among active cards, unique PIN among active accounts, FK
   integrity, and **append-only enforcement** on `loyalty_transactions` / `reward_events` /
   `audit_log` (revoke UPDATE/DELETE from the app role, or a rule/trigger). *(Phase 1)*
3. **`PostgresStore implements DataStore`** — all **33** port methods, unchanged
   signatures. *(Phase 2)*
4. **The atomic commit** — `commitCounterTransaction` as one SQL transaction with
   `SELECT … FOR UPDATE` on the customer row: idempotency-key lookup → `over_cap` /
   `customer_not_found` short-circuit → accrual → `mintFold` → per-reward re-validation and
   subset redeem → cache the `CommitResult` under the key. **This closes STATUS divergence
   `l`** — IndexedDB gives transaction scope but no row lock, so two concurrent tills can
   interleave; Postgres row locking makes the atomicity claim actually true. There is **no
   `undoCommit`** to implement (Appendix E removed it); the pre-commit hold is client-side
   and needs nothing from the server, and corrections are `reverse` ledger entries.
   *(Phase 2)*
5. **The `DataStore` conformance suite** — the single highest-value item here. Generalize
   `tests/adapters/IndexedDbStore.test.ts` into a store-agnostic suite run against **both**
   `IndexedDbStore` (fake-indexeddb) and `PostgresStore` (real container). If both pass,
   the composition-root swap is provably safe. *(Phase 2, extended every phase after)*
6. **Seeding & backup** — a production bootstrap (first admin from env, default
   `ProgramConfig`) that is *not* `demoSeed`; `exportAll`/`importAll` as admin-only
   endpoints. Note the pre-existing **JSON-snapshot gap** (`Snapshot` doesn't carry the
   three v5 stores) — fix it here rather than porting it. *(Phases 1, 4, 8)*

### B · Auth, identity & security

7. **Staff auth** — argon2id password verify, argon2id PIN verify, session issue, 5-minute
   idle lock enforced server-side (not just in `AuthContext`), `sessionEpoch` revocation
   ("sign out all devices" = delete every session row + bump the epoch). *(Phase 3)*
8. **Customer identity** — `ServerIdentityStore` adapter behind the existing
   `IdentityStore` port: `GET/PUT/DELETE /me`, backed by an HttpOnly cookie. Solves the iOS
   home-screen durability problem. *(Phases 3, 6)*
9. **The authorization boundary** — three tiers over one `DataStore` port: **public**
   (register, read own card by token, recovery request/consume, self-delete), **staff**
   (scan resolve, commit, read config, own-actor last-hour activity), **admin** (staff CRUD,
   config write, snapshot export/import). Enforced per-route from the session.
   Appendix E narrows this usefully: the staff tier reads only *its own* recent activity, and
   no tier gets a browsable cross-account feed. See §4 for the port methods that are *unsafe
   as literally specified*. *(Phase 4)*
10. **Hardening** — per-route rate limiting (login, PIN, recovery request, commit), CSRF
    double-submit, security headers, strict boundary validation via Fastify JSON schemas,
    no account-enumeration oracle on recovery, `trust proxy` for Cloudflare, server-side
    token generation. *(Phases 3, 4, 8)*
11. **PII discipline server-side** — the `CLAUDE.md` "never log PII" rule now applies to
    request logs too: a redacting serializer (no name/email/phone in access logs, error
    payloads, or query logs), and no PII in URLs (note: `GET /customers?term=…` currently
    puts an email in a query string — move to `POST` or a hashed lookup). *(Phases 4, 8)*
12. **No activity-read surface, and server-side config clamping** — the triage dropped the
    export (SCOPE-DECISIONS §1), so there is **no route that returns another account's
    activity**, audited or otherwise. The ranged audit query exists only as an internal
    function feeding the detectors. Detector thresholds on `ProgramConfig` must be
    **re-validated and clamped server-side** — `ConfigService.sanitizeConfig` runs on the
    client, which is presentation, not enforcement. *(Phase 4)*

### C · Services the browser can no longer do

13. **Server-side `Mailer`** — Resend/SES/Brevo behind the existing `Mailer` port; EmailJS
    (which exposes its public key in the bundle and can be driven by anyone) is dropped in
    the server build. Recovery, reward-available and card-created templates. Email is now
    **mandatory at registration**, so the welcome mail is guaranteed, not best-effort.
    *(Phase 5)*
14. **Recovery by typed code** (reshaped — SCOPE-DECISIONS §2.3) — email → the page waits →
    a short single-use code arrives by mail → the customer types it on the device in their
    hand → the server sets the identity cookie. Codes hashed at rest, single-use, short
    expiry, constant-shape response. A typed code is short, so **rate limiting and lockout
    carry the security that length no longer does**. *(Phase 5)*
15. **Realtime push** — the prototype's PeerJS pairing layer (`src/adapters/sync/`) is
    **dropped entirely** in the server build, and with it the live cross-device refresh it
    provided. Replacement: an **SSE** channel (`GET /events`) pushing a `changed` signal
    per customer and per till, feeding the same `dataVersion` refresh the screens already
    use. Without this, a customer's phone won't update when staff commits. *(Phase 7)*
16. **Server-side detection** — the two detectors run on the server (BE-S-09), reading the
    internal ranged audit query. `domain/alerts.ts` stays pure and moves server-side
    unchanged. *(Phase 4)*
17. **Deletion that actually deletes** — a customer's delete is a server operation that keeps
    the row as a tombstone (`id`, `createdAt`, `status`) and erases name, email, token and
    short code, leaving the ledger internally consistent and anonymous. Frees the email for
    re-registration. See SCOPE-DECISIONS §3.3. *(Phase 4)*

**Retired by the triage, formerly in this section:** the wallet service (Apple PassKit +
APNs, Google REST), the server registration handoff, and bounded stats reads. The
`WalletProvider` and `Transport` ports go with them — **five seams become three**.

### D · Delivery

18. **Docker Compose bundle** — `db` (postgres:16, named volume, healthcheck), `migrate`
    (one-shot, runs before api), `api` (multi-stage Node build, non-root, healthcheck),
    `web` (nginx serving the built SPA + reverse-proxying `/api`), and `mailpit` in the dev
    override for local email. `.env.example` with no real secrets; a `compose.dev.yml`
    override with hot reload. Plus: `pg_dump` backup job **with a verified restore drill**,
    `/healthz` + `/readyz`, graceful shutdown, structured logs with request ids, and CI that
    builds and tests the server. *(Phases 8, 9)*

---

## 4 · Contract problems (resolved at the boundary in Phases 3–5; **resolved in the port in Phase 6**)

A `DataStore` method is a **trusted, in-process call** in the prototype and becomes an
**untrusted, cross-network call** over HTTP. Six of them are unsafe as literally specified.

**Read this section twice.** Every fix below was taken *server-side, at the route boundary*, for
one reason that stopped holding on 2026-09-16: `ports/DataStore.ts` was off limits, so a signature
had to survive even where it was actively misleading about what it does. **Phase 6 took the honest
fix in the port for all six** — see its as-built notes in §5 for which workaround each one deleted.
The boundary defence stays in place regardless, and that is the point worth keeping: a correct
signature is not a substitute for a guard, and the guards are what the authorization matrix tests.
Nothing below was removed when the port was fixed.

- **A · `setStaffPassword(id, passwordHash)`** — **resolved in Phase 3 for sign-in**; the reset
  *routes* are Phase 4's and must follow the same rule. The parameter name promises the client
  sends a hash. If the server stores what it's given, that "hash" *is* the password: anyone
  who reads the database can authenticate with it, and the client can set an account's
  credential to a known value. **Fix:** the route takes the plaintext over TLS and hashes
  with argon2id server-side. Keep the port signature; document that in a server-backed build
  the value is a plaintext credential in transit, hashed before it is stored. Same for
  `setStaffPin`.
- **B · `getStaffByPin(pin)`** — **resolved in Phase 3**, and enforced by
  `src/routes/guardrails.test.ts`. A *global* search for whichever account has that PIN. Over
  HTTP that is an unauthenticated credential oracle, brute-forceable across the whole staff
  table at 4 digits. **Fix:** the route becomes "verify this PIN for the account this
  device's session already identifies" (the Unlock screen re-auths a *known* account), never
  "find the account with this PIN". Rate-limit and lock out. **Record as a divergence** — the
  prototype's global-PIN semantics genuinely cannot be preserved.
- **C · `appendAudit(entry)`** — **resolved in Phase 4.** A client-supplied actor and action.
  **Fix:** route handlers write audit rows themselves; `POST /audit` answers 204 and writes
  nothing. *As built:* the row is written immediately **after** the action, not inside its
  transaction — `DataStore` exposes no transaction boundary and widening it is a shared-port
  change Phases 0–9 may not make. The append-only log tolerates the gap; the commit route's
  replay check is what keeps a retry from doubling the rows.
- **D · `CounterTransaction.staffId`** — **resolved in Phase 4.** Body-supplied. **Fix:**
  overridden from the session on both the commit and the append routes; a customer's device holds
  a customer session and `requireStaff` refuses it before the body is read.
- **E · `listAllTransactions()` / `exportAll()`** — **resolved in Phase 4** at the route boundary
  (`GET /transactions` requires `from`/`to` ≤ 366 days, caps at 1000 rows and reports
  `truncated`; the store still returns everything for the in-process readers). "Fetch everything"
  is free against
  IndexedDB and an unbounded table scan plus a multi-megabyte response over HTTP. The admin
  stats screens feed `domain/insights.ts`, which is pure and consumes raw rows.
  **Fix for this pass:** keep the raw-row shape but require a date range and cap the page
  size; add real aggregate endpoints only if the stats screens get slow. Record as a known
  scaling divergence rather than pre-optimising. `listAudit()` is **no longer** in this
  category — Appendix E gave `AuditFilter` a real ranged, multi-value query
  (`actions[]`/`actorIds[]`/`from`/`to`), which maps straight onto an indexed SQL query;
  just enforce a server-side `limit` ceiling since the client picks the limit. *(Phase 4 caps
  `GET /audit` at 200 and pins its actor filter to the session — see F.)*
- **F · `AuditService.exportActivity(actor, filter, reason)`** — **resolved by deletion**, and
  enforced in Phase 4: `GET /audit` replaces the request's `actorId`/`actorIds` with the session's
  own, at every tier, so there is no filter that reaches another account's rows. Cross-account data
  leaves the server only as derived findings (`GET /alerts`).
  It was the one method whose integrity guarantee lived in client-side orchestration (it
  writes the `audit.export` row, then reads the rows, as two separate `DataStore` calls — over
  HTTP a client could skip the first and call `listAudit` directly). The triage dropped the
  export surface entirely, so there is nothing to protect: **build no route for it.**
  `AuditService.exportActivity`, `parseExportRecord` and the `audit.export` action become dead
  code in the prototype and are removed in Phase 11. `GET /audit` must not accept a
  cross-account filter at all.

**One more, not a security issue but a behaviour change:** `IndexedDbStore` never fails offline;
its replacement will. No screen has a network-error path, and after Phase 6 there is no store
that cannot fail. This was listed here as one of the two places "no UI rewrite" was under real
pressure (the other being `LoyaltyService.getAlerts`, which Phase 4 left without a `DataStore`
path). Both are now simply **UI-pass decisions** rather than constraints to design around, and
both live in [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md). SCOPE-DECISIONS §2.4 already
specifies what staff must see for each failure the terminal can detect — that is the starting
point, not a blank page.

---

## 5 · Phases (each = one task)

### Phase 0 — Workspace scaffolding + Fastify skeleton
**Files (all new except the root manifest):**
- `package.json` (root) — add `"workspaces": ["packages/*"]`. **Do not move `src/`**; the SPA
  keeps building exactly as it does today.
- `packages/server/package.json` — name `@cafe/server`; deps `fastify`, `pg`, `argon2`;
  devDeps `vitest`, `tsx`, `@types/pg`. Scripts: `dev`, `build`, `start`, `test`.
- `packages/server/tsconfig.json` — strict; `paths` maps `@cafe/shared/*` →
  `../../src/*` so `domain/` and `ports/` are imported, never copied (see §2, *Move timing*).
- `packages/server/src/env.ts` — parse + validate every environment variable at boot; the
  process **exits** on a missing or malformed one rather than failing later.
- `packages/server/src/server.ts` — Fastify instance, `/healthz` (liveness) and `/readyz`
  (reports DB reachability once Phase 1 lands), structured logger with a PII-redacting
  serializer, graceful shutdown on `SIGTERM`.
- `packages/server/src/index.ts` — entrypoint.
- `packages/server/src/server.test.ts` — one test asserting `/healthz` responds.

**Done when:** `npm run dev -w @cafe/server` serves `/healthz`; `npm test -w @cafe/server`
passes; and root `npx tsc --noEmit`, `npm test` (448) and `npm run build` are all still green —
the SPA must be completely unaffected.

### Phase 1 — Postgres schema + migrations
**Read first:** `src/adapters/storage/schema.ts` (IndexedDB v6 — the shape to mirror) and
`src/domain/models.ts` (the entity types).

**Files:** `packages/server/migrations/001_initial.sql` … and
`packages/server/src/migrate.ts` (applies pending files in order, records each in a
`schema_migrations` table, idempotent and safe to re-run).

**Ten tables:** `program_config` (single row), `staff_accounts`, `customers`,
`loyalty_transactions`, `rewards`, `reward_events`, `idempotency_keys`, `recovery_codes`,
`audit_log`, `sessions`.

**Carry across from the triage — do not copy the prototype blindly:**
- `customers.email` is **NOT NULL and unique among active rows**, and `display_name` is
  **NOT NULL** (SCOPE-DECISIONS §2.1, §3.4). This is the biggest schema-level difference from
  the prototype, which allows token-only cards.
- **No PIN uniqueness constraint** — it is unimplementable against hashed PINs and no longer
  needed (SCOPE-DECISIONS §3.6).
- Deletion is a tombstone: the row survives with `display_name`, `email`, `token` and
  `short_code` **nullable** so they can be erased (§3.3). That nullability exists *only* for
  deleted rows — enforce "active ⇒ present" with a CHECK constraint.
- `program_config` carries the four Appendix E detector thresholds.
- Indexes per §3-A-2, including `audit_log` on `(timestamp)`, `(action, timestamp)` and
  `(actor_id, timestamp)` for the internal ranged query.
- Append-only on `loyalty_transactions`, `reward_events`, `audit_log` (§3-A-3).

**Bootstrap seed:** first admin from environment variables, `ProgramConfig` from the current
`DEFAULT_CONFIG` (threshold **9** + the detector thresholds). **Never `demoSeed`.**

**Done when:** a fresh `db` container migrates clean, re-running is a no-op, and a test
asserts both.

#### Phases 0–1 — as built (2026-09-15), and the decisions taken

Everything above landed as specified. These are the calls the phases forced, recorded so the
next session inherits them rather than re-deriving them:

- **`tsx` is the server's runtime, and `build` is a typecheck.** The shared `domain/`/`ports/`
  sources use *extensionless* relative specifiers, which `NodeNext` rejects — so the server
  compiles under `moduleResolution: "Bundler"`, and `tsc` will not rewrite the `@cafe/shared/*`
  alias on emit. `dev`/`start` therefore run through `tsx`, whose resolution matches. The
  emit-based build lands with **Phase 10**, when `@cafe/shared` becomes a real package and the
  alias stops being an alias. Phase 8's image must run `tsx` until then.
- **No foreign key on `loyalty_transactions.staff_id` or `audit_log.actor_id`.** Staff accounts
  are hard-deletable (`StaffService.remove` → `deleteStaff`) and historical attribution has to
  survive that; an FK would either block the delete or cascade away the ledger. `customer_id`
  *is* an FK, because customers are tombstoned, never deleted. **Open for Phase 4:** whether
  staff deletion should become a soft-delete server-side — until it does, a deleted account's
  id appears in the ledger with nothing to resolve it to.
- **Append-only is a trigger (`reject_mutation`), not a role grant.** Self-contained in the
  migration, so it holds however the app role is provisioned. It covers
  `loyalty_transactions`, `reward_events` and `audit_log`; `rewards` stays mutable, being a
  projection rather than a log.
- **Two vocabularies are narrowed by CHECK constraints, deliberately.** The ledger rejects
  `'redemption'` (retired by the rewards rework) and the audit log rejects `'audit.export'` —
  the triage deleted the export surface, so the database refuses the row outright. That is the
  cheapest possible enforcement of BACKEND-PLAN §4-F and SCOPE-DECISIONS §1.
- **Detector thresholds carry CHECK bounds**, which is the server-side clamp §3-B-12 asks for.
  Phase 4 still validates at the boundary so the client gets a clean error rather than a 500.
- **The `program_config` singleton is seeded by migration 001, not by `bootstrap.ts`.** Its
  values mirror `DEFAULT_CONFIG` in `src/adapters/storage/schema.ts`; going through the
  migration keeps the server from importing a *prototype adapter* to learn its own defaults.
  Phase 2's conformance suite is what will catch drift between the two.
- **`bootstrap.ts` creates only the first admin**, from the environment, idempotently — once any
  admin exists it is a no-op, so it can never reset a live credential. Explicitly not `demoSeed`.
- **PII redaction needed a third layer.** The request serializer was not enough: Fastify's
  *default* 404 handler logs the raw request URL as a plain message, which sailed past it (found
  by curling a live server, now a regression test). Fixed with a custom `setNotFoundHandler`
  plus a pino `logMethod` hook that scrubs every message, whoever logs it.
- **The server suites need a real Postgres** at `TEST_DATABASE_URL` (default
  `postgres://cafe:cafe@localhost:5432/cafe_loyalty_test`). They skip with a loud warning when
  none is reachable — **Phase 9 must make CI provide one**, or the schema assertions silently
  stop running.

### Phase 2 — `PostgresStore` + conformance suite  ⟵ the core
All 33 `DataStore` methods; `commitCounterTransaction` with row locking (§3-A-4), and the
ranged `AuditFilter` as a real indexed query. Generalize the IDB adapter tests into a shared
suite run against both stores.
Done when: the same suite passes against `IndexedDbStore` and `PostgresStore`, including a
**concurrency test** two tills committing at once — the case IndexedDB cannot win.

#### Phase 2 — as built (2026-09-15), and the decisions taken

**Files:** `packages/server/src/PostgresStore.ts` (+ `PostgresStore.test.ts`),
`tests/conformance/dataStoreConformance.ts` (the shared suite),
`tests/adapters/IndexedDbStore.conformance.test.ts` (runs it against the prototype), a trimmed
`tests/adapters/IndexedDbStore.test.ts`, and a `@cafe/conformance` alias in the server's
`tsconfig.json` + `vitest.config.ts`. **No `src/` file was touched** — Phase 6 is still the first.

- **The conformance suite is imported by both projects, never copied.** It lives at
  `tests/conformance/` and reaches the server through a `@cafe/conformance` alias, exactly as
  `domain/`+`ports/` reach it through `@cafe/shared/*`. A duplicated suite would stop proving the
  two stores agree the moment one copy was edited. It takes a `StoreHarness` (`create`, optional
  `dispose`, `skip`) and asserts **behaviour only** — never storage shape, because the two stores
  legitimately differ there (plaintext vs argon2id). It also never assumes an empty store is
  *completely* empty: the prototype seeds mock staff, a production database does not.
- **`Promise.all` is not a concurrency test.** The first version of the two-till race passed with
  the row lock deleted — the two connections happened to serialize. Every race in
  `PostgresStore.test.ts` now holds the customer row open on a **third connection** until both
  commits are provably queued behind it. Re-verified by deleting `FOR UPDATE`: the two-till test
  fails, as it must. If you touch the commit, re-run that check — it is the phase's whole claim.
- **Four deliberate divergences from the prototype adapter**, each tested and each load-bearing:
  (1) credentials are **hashed in the store** with argon2id, so no later caller can forget (§4-A);
  (2) `softDeleteCustomer` erases the **token and short code** as well, so a dead card can never be
  scanned and its address is freed (SCOPE-DECISIONS §3.3); (3) a **tombstone cannot be committed
  against** — it keeps its history and gains none; (4) `redeemReward` **throws**. The schema
  refuses the `'redemption'` entry it writes, and returning `ok: false` would read to staff as
  "not enough points"; nothing in the product calls it (only tests do). It is excluded from the
  conformance suite with that reasoning recorded there, and goes in Phase 11.
- **`getStaffByPin` verifies against each active account** with a PIN, since a hashed PIN cannot
  be looked up by value. That is the prototype's answer, for a café's handful of accounts.
  **Phase 3/4 must not give it a route** (§4-B) — it is a credential oracle over HTTP.
- **Recovery codes are SHA-256 at rest.** Right for the prototype's high-entropy code; Phase 5
  reshapes recovery into a *short typed* code, where length stops carrying the security and the
  `attempts` lockout column takes over. Revisit the hash choice there.
- **No limit ceiling is clamped inside `listAudit` or `listAllTransactions`.** §4-E's cap is a
  *route*-boundary concern (Phase 4): the same store call feeds the detectors' internal ranged
  query and the stats derivation, and a silently truncated read would make both quietly wrong.
- **`importAll` uses TRUNCATE**, which is what makes a restore possible at all — the append-only
  triggers reject row deletes, and must. The `Snapshot` gap (§3-A-6: no rewards, reward events or
  recovery codes) is carried, not fixed: widening `Snapshot` changes a shared domain type and
  belongs with the export/import routes.
- **Ledger reads order by `(timestamp, id)`.** The accrual and the `reward_issue` minted beside it
  share one timestamp by design, so `id` is what keeps the order deterministic.

### Phase 3 — Auth: hashing, sessions, revocation, rate limits
argon2id password + PIN, `sessions` table, cookie issue/verify, idle lock, epoch
revocation, per-route rate limits, CSRF. Resolves §4-A and §4-B.
Done when: sign-in, PIN unlock, idle lock and "sign out all devices" work end-to-end
against the API, with tests.

#### Phase 3 — as built (2026-09-15), and the decisions taken

**Files (all new, all under `packages/server/`):** `src/auth/cookies.ts`, `src/auth/rateLimit.ts`,
`src/auth/sessions.ts`, `src/auth/guards.ts`, `src/routes/auth.ts`, each with a test beside it,
plus `src/routes/guardrails.test.ts`. Edited: `src/server.ts` (hooks, routes, one error shape),
`src/env.ts` (+`COOKIE_SECURE`, +`ALLOWED_ORIGINS`), `src/index.ts`, `.env.example`. **No `src/`
file was touched** — Phase 6 is still the first.

**Five routes.** `POST /auth/login`, `POST /auth/unlock`, `POST /auth/logout`,
`POST /auth/logout-all`, `GET /auth/session` (public: "am I signed in?" is the SPA's boot question,
and not being signed in is not an error).

- **§4-A is closed by verifying, never comparing.** The route takes the plaintext over TLS and
  calls `argon2.verify` against what `PostgresStore` hashed at creation. A test sends the stored
  digest *as the password* and expects 401 — which is the whole of §4-A in one assertion: if the
  server compared, the hash would **be** the password.
- **§4-B is closed by inverting the lookup, and that is a real divergence.** `getStaffByPin` finds
  *whichever* account holds a PIN; over HTTP that is an unauthenticated oracle over the whole staff
  table at four digits. `/auth/unlock` instead verifies the PIN against the account **this
  device's session already names**. Consequence, recorded in `STATUS.md`: a device with no session
  cannot PIN in at all — the prototype's "PIN alone identifies you" is gone. `guardrails.test.ts`
  fails if any file outside `PostgresStore` ever calls `getStaffByPin`, and the same file holds
  §6's "no `undo` in the server" and "no export surface" greps.
- **The epoch is a counter (`+ 1`), not `Date.now()`.** `program_config.session_epoch` is an
  `integer`; a millisecond timestamp overflows `int4`, so the prototype's `revokeAllSessions` would
  throw against Postgres. Monotonic is all the comparison needs. **Phase 4 must therefore not let
  the config-update route accept a client-supplied `sessionEpoch`** — revocation is a route, not a
  config field.
- **"Sign out all devices" deletes rows *and* bumps the epoch, in one transaction.** Either alone
  would do; together, the rows make it true now and the epoch covers a device that had already
  loaded a page. The admin's own session goes with the rest.
- **Customer sessions are in the same table and obey different rules**, stated on
  `SessionStore.resolve`: no idle lock (a fortnightly customer must still be recognised — that
  recognition *is* the feature) and no epoch check ("sign out all devices" is about staff
  terminals). Issuing them is built and tested here; the `/me` routes and `ServerIdentityStore` are
  Phases 4 and 6.
- **A disabled or deleted staff account loses its live sessions immediately** — the resolve query
  joins `staff_accounts`. Without it, "disable this employee" would only bite at their next
  sign-in, which is precisely when it doesn't matter.
- **CSRF is a double-submit token *bound to the session*.** The partner token is stored hashed on
  the session row and compared in constant time, so a token minted for another session does not
  pass (tested). It is delivered in a deliberately **non**-HttpOnly cookie: a token the page cannot
  read is a token the page cannot submit.
- **Plus a same-origin check on every mutating request**, because sign-in has no session and so no
  token to double-submit — that is the one CSRF hole `SameSite=Lax` alone leaves (login CSRF).
  `ALLOWED_ORIGINS` exists for a Vite dev server on another port; the deployed bundle is
  single-origin and leaves it empty.
- **Rate limiting counts *failures*, not requests**, so a till signing in all day is never
  throttled. Three buckets: 5 per account, 20 per source address (a café shares one NAT address —
  locking it out locks out the till), 5 per account on the PIN. All 15-minute window and lockout.
  **In-memory and per-process**, which is right for one container; more than one instance needs
  these in Postgres or Redis.
- **The idle lock moved server-side, and the client's timer is now only a UI affordance.**
  `last_seen_at` is touched on the way in, awaited, on every active request — one primary-key
  update, and the semantics stay exact rather than up-to-30-seconds-stale.
- **`/healthz` and `/readyz` skip session resolution entirely**, so the Phase 0 promise that
  liveness never touches the database survives a probe that happens to carry a cookie.
- **One error shape for every failure** (`setErrorHandler`). Fastify's default names the field that
  failed validation and echoes what it failed on, and an error thrown from a handler is returned
  verbatim — §3-B-11 rules PII out of error payloads as firmly as out of logs. The real error still
  reaches the log, where the serializer scrubs it.
- **Cookies are hand-written** (`auth/cookies.ts`, ~50 lines, fully tested) rather than adding
  `@fastify/cookie`. Nothing here is cryptographic — signing is pointless when the cookie carries a
  256-bit random token that is looked up server-side — and `CLAUDE.md` is explicit about not adding
  dependencies the spec didn't call for.
- **Session tokens are SHA-256 at rest, not argon2id.** They are 256 bits of `randomBytes`, not a
  secret a person chose, so there is no dictionary to slow down — and a stretched hash would be
  recomputed on *every* authenticated request. The reason to hash at all is that a dumped database
  must not yield live sessions, which a fast hash of a high-entropy value achieves completely.
- **The security-critical rules were verified by breaking them.** Deleting the CSRF check, the
  origin check, the epoch comparison and the idle rule each fails the tests that claim them (3, 1
  and 8 failures respectively). Re-run that check if you touch them — the same discipline Phase 2
  applied to `FOR UPDATE`.
- **Smoke-tested against a live socket, not just `app.inject`.** Sign-in, session, CSRF refusal,
  cross-origin refusal and revocation over `curl`, with the log inspected afterwards for the
  password, the PIN and both tokens: none present. This is how Phase 0's 404-logging leak was
  found, and it is worth repeating each phase.

### Phase 4 — HTTP API surface + authorization boundary
Routes for every `ApiStore` path, three authz tiers, server-written audit, session-derived
actor, server-side config clamping, boundary validation, PII kept out of URLs and logs.
Server-side detection (BE-S-09) reads the internal ranged audit query. Resolves §4-C, D, E
(F is resolved by deletion).
Done when: an authz test matrix passes — each tier is proven to be refused everything above
it — and **no route returns another account's activity at all**.

#### Phase 4 — as built (2026-09-15), and the decisions taken

**Files (all new under `packages/server/src/` unless noted):** `routes/index.ts` (the surface in
one place, with the absences documented beside the routes), `routes/shared.ts`, `routes/customers.ts`,
`routes/identity.ts`, `routes/staff.ts`, `routes/config.ts`, `routes/activity.ts`,
`routes/snapshot.ts`, `config/clamp.ts`, `detection.ts`, `testing/http.ts`, each with a test
beside it, plus `routes/authz.test.ts`. Edited: `auth/guards.ts` (+2 limiters), `server.ts`
(registers the surface), `logging.ts` (+credential path-segment redaction), `routes/guardrails.test.ts`.

- **`src/domain/alerts.ts` is the one `src/` file Phase 4 touched, and the edit is a pure
  refactor.** The server compiles with `noUncheckedIndexedAccess`, which the SPA does not, and the
  two detector loops index arrays directly — so importing `deriveAlerts` failed to typecheck. The
  loops now bind `rows[i]` to a local before use; behaviour is identical and the SPA's 12 alert
  tests are unchanged. The alternative was reimplementing the detectors server-side, which is
  exactly the drift the shared-`domain/` rule exists to prevent. **Expect the same friction for
  any other shared file the server comes to import**; fixing it in place is cheaper than the
  duplicate, and Phase 10 ends the mismatch by giving `packages/shared` one tsconfig.
- **Three tiers, and a fourth thing that is not a tier.** public / staff / admin are guards;
  "the card's own device" is a *check inside the handler* (`readableCustomer`), because it depends
  on which card is being asked about. A caller who may not read a card gets **404, not 403** — 403
  confirms the id exists to someone with no business knowing it.
- **The authorization matrix is exhaustive, not representative** (`routes/authz.test.ts`). Every
  route is listed with the callers entitled to it and driven by five real devices. It asserts both
  halves: each tier refused everything above it, *and* every entitled caller getting through — a
  matrix that only proved refusals would pass with every route returning 403, which is a broken
  system rather than a secure one.
- **A route inventory pins the whole surface** (`guardrails.test.ts`). Every other guardrail bans
  something by name, which only catches the mistakes already thought of. This one snapshots
  `printRoutes()`, so a route added anywhere fails until someone writes it down — and writing it
  down means deciding its tier in the matrix, which is the step a helpful-looking new route skips.
  **If you add a route, both files change. That is the point.**
- **`POST /audit` answers 204 and writes nothing**, rather than 403. §4-C says "rejected/no-op";
  rejecting would break `AuditService.log` inside otherwise-unchanged services, which is the
  promise the plan is built on. The attempt is logged at `warn`, so a *missing* server-side audit
  row shows up as noise rather than silence.
- **A replayed commit must not re-write its audit rows**, and `CommitResult` does not say whether
  it was served from the cache. The route checks `idempotency_keys` directly (`isCommitReplay`)
  because widening the result type means editing a shared port, which Phases 0–9 may not do. Two
  *simultaneous* retries could still both see "fresh"; the ledger is correct either way, and the
  realistic retry (a client re-sending after a timeout) is covered. **Fold a `replayed` flag into
  `CommitResult` in Phase 10 or 11 and delete the direct read.**
- **`GET /alerts` is the phase's one genuinely new endpoint, and it has no port method behind it.**
  With `GET /audit` pinned to the caller's own actor, `LoyaltyService.getAlerts` — which derives
  alerts in the browser from two cross-account `listAudit` reads — cannot work over HTTP. Detection
  moves server-side (`detection.ts`, running `domain/alerts.ts` unchanged) and returns findings.
  **Phase 6 must decide how `getAlerts` reaches it**; alongside the offline posture this is the
  second place "no service rewrite" is under real pressure, and it is better decided than
  discovered.
- **Detection reads a 30-day window**, where the prototype reads everything. Both detectors measure
  a pattern inside seconds or minutes, so a year-old pair contributes nothing but a table scan.
- **`GET /customers/by-token/:token` issues a customer session** when the request carries no staff
  session and is not already bound to that card. This is `IdentityStore.set` moved server-side: the
  last card opened on a device is the card that device is recognised as, which is the prototype's
  one-token-in-localStorage semantics exactly. A till is exempt — three routes make that same
  exemption (`by-token`, `POST /customers`, `PUT /me`) and a staff device is refused outright by
  the third. It is a GET with a side effect, which is the cost of keeping the adapter's shape.
- **Two credential-carrying path segments are redacted from logs** (`/customers/by-token/`,
  `/customers/by-code/`). Neither is PII — that is the opaque-token design working — but both are
  what grants access to a card, and Phase 3's rule that a credential never reaches a log holds
  whatever shape it arrives in.
- **`StaffService.remove`'s "last admin" guard is deliberately NOT restated.** Every staff route is
  admin-tier and refuses to act on the caller's own account, so the caller is always an active
  admin other than the target — the branch is unreachable. A branch no request can enter is a
  branch no test can cover, so the invariant ("an active admin always remains") is asserted
  directly instead. Disabling *is* guarded, where the prototype guards nothing.
- **The config clamp is stricter than `sanitizeConfig` in two ways**: every numeric field gains a
  ceiling (the client only needed floors, because its inputs are spinners a person drives), and
  `selfDealCount`/`repeatCount` floor at **2**, matching migration 001's `BETWEEN 2 AND 100` — at 1
  the self-dealing detector fires on a single ordinary pair, and clamping to the client's floor
  would turn an admin's typo into a 500.
- **The snapshot export blanks credentials**, which means **a restore cannot restore sign-in**.
  Deliberate: a backup file travels to laptops and cloud drives, and one carrying every argon2id
  digest in the café is a credential dump waiting to leak. An operator restoring resets passwords.
  Note this compounds the carried `Snapshot` gap (§3-A-6: no rewards, reward events or recovery
  codes) — **`/export` is a config-and-ledger backup, not a full one**, and Phase 8's backup job
  should use `pg_dump`, not this route.
- **Two new failure-counting limiters**, reusing Phase 3's `AttemptLimiter` rather than adding a
  request-counting mechanism: registration (5 per source address — the `email_in_use` answer §3.4
  requires is an enumeration oracle, and counting the failures is what stops an address list being
  walked) and commit (20 per staff account — a till doing ordinary work never fails, a client
  walking the id space fails every time).
- **The security-critical rules were verified by breaking them**, as Phases 2 and 3 did. Removing
  the admin guard on `GET /staff`, honouring the client's `actorIds` on `GET /audit`, trusting the
  body's `staffId` on commit, deleting the replay check, and un-blanking the password digest each
  fail the tests that claim them (5, 2, 1, 1 and 2 failures). **Re-run that check if you touch
  any of them.**
- **Smoke-tested against a live socket**, not just `app.inject`: sign-in, registration, a till
  committing while claiming to be a colleague (recorded as itself), a customer device refused the
  commit, `actorIds` ignored on `/audit`, `sessionEpoch` refused, CSRF and cross-origin refusals.
  The log was then searched for the name, address, phone, password, PIN, card token, short code and
  both session tokens — none present, and both credential path segments redacted. **This is how
  Phase 0's 404-logging leak and this phase's bootstrap gap were both found; keep doing it.**
- **Observed, not fixed:** `logging.ts` lists `code` among `SENSITIVE_KEYS` (for recovery codes),
  which also redacts a Postgres error's SQLSTATE — the most useful field when diagnosing a 500.
  Worth narrowing when Phase 8 revisits logging.

### Phase 5 — Server `Mailer` + recovery
Provider adapter behind the `Mailer` port, templates, hashed single-use codes, no
enumeration oracle, rate limits.
Done when: the recovery round-trip works against mailpit, and an unknown address is
indistinguishable from a known one.

#### Phase 5 — as built (2026-09-16), and the decisions taken

**Files (all new under `packages/server/src/` unless noted):** `mail/templates.ts`,
`mail/SmtpMailer.ts`, `mail/LogMailer.ts`, `mail/links.ts`, `mail/index.ts` (the mail composition
root), `recovery/codes.ts`, `routes/recovery.ts`, `background.ts`, `testing/mail.ts`,
`testing/smtp.ts`, each with a test beside it. Edited: `env.ts` (+`MAIL_SMTP_URL`, `MAIL_FROM`,
`APP_URL`), `auth/guards.ts` (+mailer, +appUrl, +background, +4 limiters), `index.ts`,
`routes/index.ts`, `routes/customers.ts` (the two transactional sends), `PostgresStore.ts` (the
recovery hash is now shared), `routes/guardrails.test.ts`, `routes/authz.test.ts`, `.env.example`.
**No `src/` file was touched** — Phase 6 is still the first.

- **`nodemailer` is the one new dependency, and SMTP is the one transport.** `CLAUDE.md` rules out
  dependencies the spec didn't call for; §3-C-13 called for a server-side mail provider, and SMTP
  with STARTTLS and AUTH is where hand-rolling is the *clever* option rather than the boring one.
  One transport also covers every case the plan needs — mailpit in Phase 8's dev override, and SES,
  Brevo or Resend in production, all three over `MAIL_SMTP_URL` — so changing provider is a change
  to an environment variable and to nothing else. A provider-specific HTTP adapter would have been
  a second adapter to write and a second one to keep working.
- **The mail bodies move into the repository** (`mail/templates.ts`). The prototype's `Mailer` port
  carries a `kind` and a bag of params because EmailJS holds the template; a server has no
  provider-side template, and the three mails are transactional product copy that belongs beside
  the routes that send them rather than in a third-party dashboard. A missing param **throws**
  rather than substituting a blank: "your code is undefined" is worse than a failed send, because
  the customer cannot tell it went wrong and waits for a second one. This retires divergence **b**
  for the server build.
- **The routes are the only sender.** `POST /customers` sends the welcome mail and
  `POST /customers/:id/commit` the reward-available one, because the route is what knows a card was
  created or a reward minted — and the provider credential must not be in a client bundle, which is
  the whole reason `EmailJsMailer` is retired. A **replayed commit sends nothing**, for the same
  reason it writes no audit rows. **Phase 6 must wire the SPA with `NoopMailer`**, or every mail
  goes out twice.
- **Sending happens *after* the response, and for recovery that is a security property.** An
  awaited send makes a known address measurably slower than an unknown one — the enumeration oracle
  §2.3 forbids, readable with a stopwatch, and the same one `routes/auth.ts` spends an argon2
  verify to close on sign-in. `background.ts` removes the difference instead of paying to hide it:
  `POST /recovery/request` answers `202 {"status":"sent"}` **before it has looked the address up at
  all**, which is the strongest available form of the guarantee. It tracks its promises rather than
  bare `void`-ing them, which buys a shutdown that drains before the pool closes and tests that can
  await the work instead of sleeping. It must not become a job queue: a task lost to a crash is
  acceptable for a mail the customer can ask for again, and not for anything that writes the ledger.
- **A short code cannot carry its own security, so three other things do** (`recovery/codes.ts`).
  (1) **Scoping** — a guess is checked against the codes issued to *that address*, never against
  every live code in the table; without it a guesser plays the whole outstanding set at once and
  the odds improve with every customer who asks for a code. (2) **A durable `attempts` count** —
  five wrong guesses burn the code *in the database*, so restarting the process does not buy five
  more, which an in-memory limiter alone would. (3) **Superseding** — issuing a code kills the last
  one, so a caller cannot stack live codes to widen the target. The in-memory limiters are the
  cheap first line on top of all three.
- **The port's recovery pair keeps working and gets no route — the recovery twin of §4-B.**
  `DataStore.consumeRecoveryCode` looks a code up by value across the whole table, which is right
  for the prototype's 128-bit token and wrong for six typed characters. `recovery/codes.ts` inverts
  it to "verify this code for the address that asked", exactly as `/auth/unlock` inverted the PIN
  lookup, and `guardrails.test.ts` fails if anything outside `PostgresStore` calls the port pair.
  Recorded as divergence **x**; the conformance suite still holds the port methods to the
  prototype's answer. **The SHA-256 hash stays** (the open question Phase 2 left): it is not what
  stands between a guesser and the code, and a stretched hash would only slow down someone who has
  already read the database — and who can equally read the customer's address and walk in.
- **The consume takes `{ email, code }`, which Phase 6 has to carry into `RecoveryService`.** The
  page already has the address from step 1, so it costs the customer nothing; it costs the service
  a signature. Together with `getAlerts` (divergence **u**) that is two services the composition
  root must point at routes — see the Phase 6 note in §1.
- **`APP_URL` is required exactly when mail is configured**, not when `NODE_ENV=production`. It
  exists only to build the card links in outbound mail, and the failure it prevents is the quiet
  kind: a link pointing at `localhost` arrives in a customer's inbox and is simply dead. The server
  cannot infer it — behind Cloudflare the request host is the proxy's.
- **The recovery mail carries no link, and the absence is asserted.** That is the entire point of
  §2.3: a link opens on whichever device reads the mail, which is frequently the wrong one. A
  helpful "or just click here" would quietly undo the decision.
- **`SmtpSink` (≈60 lines of `node:net`) stands in for mailpit until Phase 8.** It proves what a
  fake transport cannot — that the adapter genuinely speaks SMTP, that the envelope carries
  `MAIL_FROM` and the customer's address, and that the rendered subject and body reach a server.
  Test scaffolding only; nothing outside `testing/` may import it.
- **A provider error never reaches a log intact.** `SmtpMailer` replaces it with the mail *kind*
  plus the error code, because a rejection routinely quotes the recipient ("550 no such user
  <someone@example.com>") and that travels straight into a log line or an error payload.
- **The security-critical rules were verified by breaking them**, as Phases 2–4 did. Removing the
  per-address scoping, the `attempts` predicate, the code superseding, the constant-shape response
  (answering 404 for an unknown address) and the till refusal on consume each fail the tests that
  claim them (2, 1, 1, 1 and 4 failures). One of those checks found a real gap first: the original
  `attempts` test passed with the predicate deleted, because `recordFailedAttempt` was burning the
  code anyway — so the predicate now has a test that drives it directly. **Re-run the whole check
  if you touch any of them.**
- **Smoke-tested against a live socket and a live SMTP sink**, not just `app.inject`: registration,
  the welcome mail, a recovery request for a known and an unknown address (same status, same body,
  1–3 ms either way), a consume with the wrong address, a consume with the wrong code, a successful
  consume typed hyphenated and in lower case, the identity cookie it sets, a replay of the spent
  code, and a delivery against a **dead** mail server (still 202, error logged, nothing leaked).
  The log was then searched for the name, address, phone, card token, short code, recovery code,
  sender address and both session tokens — none present.

### Phase 6 — Retire the prototype + reshape the shared port
**Redefined 2026-09-16.** The old Phase 6 (client adapters, additive, no screen changed) moved
into the UI pass; see the revoked-promise box.

**Delete.** `src/adapters/storage/IndexedDbStore.ts` and its tests; `src/adapters/sync/` (the
whole PeerJS pairing layer — `PeerJsHost`, `ConnLink`, `joinHost`, `SwitchableStore`);
`src/adapters/transport/` and `src/ports/Transport.ts`; `src/adapters/wallet/` and
`src/ports/WalletProvider.ts` (both retired by the triage, SCOPE-DECISIONS §1);
`src/adapters/email/EmailJsMailer.ts`; `demoSeed` and the preset card tokens; the `VITE_TRANSPORT`
/ `VITE_WALLET` / `isPrototype` adapter flags; the GitHub Pages deploy workflow. Drop `peerjs`
and `idb`/Dexie from `package.json`. **Leave the screens alone** — `ProtoPanel`, `DevTrigger`,
`PairDevices`, `PairingContext` and `/pair` are UI-pass deletions; record them in the register
rather than chasing them here.

**Reshape.** §4's six contract problems, now that the port is editable:
`setStaffPassword(id, passwordHash)` → a name that admits it takes a plaintext credential;
`getStaffByPin` and `redeemReward` off the port entirely; `createRecoveryCode` /
`consumeRecoveryCode` → the scoped shape `recovery/codes.ts` already implements;
`CommitResult` → `+ replayed`, so `routes/shared.ts` stops reading `idempotency_keys` behind the
store's back; `appendAudit` off the client-facing surface; `Snapshot` → the three stores it is
missing (§3-A-6). Each one deletes a workaround — say which, in the as-built notes.

**Keep.** `tests/conformance/dataStoreConformance.ts`. It stops being a cross-store contract and
becomes `PostgresStore`'s specification; rename its role in the file so the missing second store
reads as a decision rather than an accident.

Done when: `npm test -w @cafe/server` and the server `tsc` are green, no workaround from §4
survives that the port could have fixed, and every screen-level consequence is a row in
[`UI-RECONCILIATION.md`](UI-RECONCILIATION.md). **The root build and the SPA suite are red, and
that is the expected outcome, not a failure of the phase.**

#### Phase 6 — as built (2026-09-16), and the decisions taken

**Deleted:** `src/adapters/storage/IndexedDbStore.ts`, `schema.ts` and `demoSeed.ts`;
`src/adapters/sync/` and `tests/adapters/sync/`; `src/adapters/transport/` + `src/ports/Transport.ts`;
`src/adapters/wallet/` + `src/ports/WalletProvider.ts` + `src/wallet/` (the preset card tokens);
`src/adapters/email/EmailJsMailer.ts`; the IndexedDB, demoSeed, EmailJS, PeerTransport and wallet
test files; `.github/workflows/deploy.yml`; the `peerjs` and `idb` dependencies.
**Edited:** `src/ports/DataStore.ts` and `src/domain/models.ts` (the reshape), `src/config/env.ts`,
`src/services/Services.ts`, `src/services/CustomerService.ts`, `src/adapters/storage/ApiStore.ts`,
`tests/conformance/dataStoreConformance.ts`, and across the server `PostgresStore.ts`,
`auth/guards.ts`, `routes/{customers,recovery,snapshot,staff,activity,auth,index,shared}.ts` and
their tests. **390 server tests** (was 389).

- **The port got a second interface, and that is the phase's one structural idea.** §4-C says a
  client-writable audit log is not an audit log, and the recovery pair says the same thing about
  a client naming whose code it is guessing. Both were "the port demands it, a route refuses it,
  a guardrail test greps for callers". They are now on **`TrustedStore extends DataStore`** —
  `appendAudit`, `createRecoveryCode`, `consumeRecoveryCode`, `recordFailedRecoveryAttempt` —
  which `PostgresStore` implements and `AuthDeps.store` requires. `DataStore` is what a browser
  may ask for; an HTTP adapter *cannot implement* `TrustedStore`, which is a stronger statement
  than any guardrail was making.
- **Every reshape deleted a workaround, and here is which.** `setStaffPassword(id, password)` +
  `CreateStaffInput.password` delete the comment in `routes/staff.ts` apologising for the
  parameter name. `getStaffByPin` leaving the port deletes both its implementation and the
  guardrail that kept callers off it — the guard now asserts the identifier appears **nowhere**
  in the server. The scoped recovery trio deletes `PostgresStore`'s second, prototype-shaped
  implementation of the same table, so `recovery/codes.ts` is the only one and the routes reach
  it through the store. `CommitResult.replayed` deletes `routes/shared.ts`'s `isCommitReplay`,
  which read `idempotency_keys` behind the store's back and could disagree with it under two
  simultaneous retries. `redeemReward` leaving deletes a method whose whole body was a `throw`.
- **`Snapshot` gained rewards and reward events but NOT recovery codes**, and the omission is a
  decision rather than the same gap left open. A recovery code expires fifteen minutes after it
  is issued, so every code in a file old enough to restore is long dead — carrying them would add
  nothing a restore can use while putting credential hashes in a file that travels to laptops and
  cloud drives, which is exactly what Phase 4's credential-blanking decision was about. Version
  **6 → 7**; a version-6 file still imports, minus those tables, rather than being refused.
- **The conformance suite was kept and re-framed, not quietly left to look abandoned.** Its
  header now says in full that the second store was deleted on purpose and that what survives is
  `PostgresStore`'s specification. It also gained four recovery tests it could not have had
  before (scoping, superseding, durable attempt lockout) because the port now carries the shape
  those behaviours live in, and the snapshot round-trip now mints a reward first — which is the
  assertion that would have caught §3-A-6 in the first place.
- **The two new claims were verified by breaking them**, as Phases 2–5 did. Deleting the
  `replayed` stamp from `readCommitResult` fails 4 tests (the idempotent-commit test, the
  concurrent-retry test, and both "no second audit row / no second mail on replay" route tests);
  emptying `rewards`/`rewardEvents` in `exportAll` fails the snapshot round-trip. **Re-run both
  if you touch either.**
- **The screens were left alone, as the phase says, but the composition root could not be.**
  `Services.ts` imported five deleted modules, so it was rewritten: one store (`ApiStore`), a
  `NoopMailer` — the routes are the only sender, and a client mailer means every customer gets
  each mail twice — and `LocalStorageIdentityStore` until `ServerIdentityStore` lands. `Services`
  lost `transport`, `wallet`, `sync` and `reset`; every caller of those is a screen already
  slated for deletion (register P5). `env.ts` lost every adapter flag, because with one store,
  one sender and no peer connection there is nothing left to select.
- **`CustomerService.issueCard` stopped handing out preset tokens.** The first three cards used to
  get fixed tokens so the pre-generated wallet passes resolved to them. Wallet is gone, and a
  predictable card token was the one place this system's opaque-identity rule had an exception.
- **What the SPA redness actually is**, so the next session recognises it rather than investigates
  it: `tsc -b` fails, and **9 of 53 SPA test files fail to load** — the six `tests/services/`
  suites (they build their graph on `IndexedDbStore` through `tests/helpers/freshStore.ts`) plus
  `Card`, `EnlargedQr` and `Panel`. The other 44 files (262 tests) still pass. `fake-indexeddb`
  was left in `devDependencies` because `freshStore.ts` still imports it; both go together in the
  UI pass. **How the services get tested again is genuinely undecided** and is register row P6.
  The `e2e/` suite is dead for the same reason — `npm run e2e` runs `vite build` first — and was
  left in place rather than deleted, because what it should cover is a UI-pass question.
- **`.github/workflows/` is now empty.** Deleting the Pages deploy left it with no workflow at
  all, which is honest — there is nothing to deploy until Phase 8 serves the SPA from nginx — and
  Phase 9 is what puts a workflow back.

### — UI pass — (a separate initiative, after Phase 9)
What the old Phase 6 was, plus everything the register accumulated. `ApiStore.request`
(credentials, CSRF header, typed errors, one error surface); `ServerIdentityStore`;
`createServices` wiring the server adapters and **`NoopMailer`** (the routes send the mail now —
leaving a client mailer in means every customer gets each mail twice); `LoyaltyService.getAlerts`
and `RecoveryService` reshaped to the routes that replaced them; the offline posture built
against SCOPE-DECISIONS §2.4; the prototype's screens deleted.
Starts from [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md) with the maintainer's confirmations
against it — not from discovery.

### Phase 7 — Realtime push (SSE)
`GET /events` + a client subscriber feeding the existing `dataVersion` refresh.
Done when: a commit on the till updates the customer's open card without a reload.

#### Phase 7 — as built (2026-09-16), and the decisions taken

**Files (all new under `packages/server/src/`):** `events/hub.ts`, `events/sse.ts`,
`routes/events.ts`, `testing/sse.ts`, each with a test beside it. **Edited:** `auth/guards.ts`
(+`events` on `AuthDeps`), `routes/index.ts` (the surface doc + registration),
`routes/customers.ts` (the publish call sites), `routes/auth.ts`, `routes/identity.ts`,
`routes/staff.ts` (a stream ends with the session it belongs to), `routes/authz.test.ts`,
`routes/guardrails.test.ts`. **434 server tests** (was 390). The client subscriber is UI-pass
work, as the phase brief says — register rows **X6** and **X7**.

- **The stream carries a signal, never data, and that is the phase's one load-bearing idea.**
  `event: changed` with `{scope, id, reason}`; the screen then re-reads through the routes it was
  already entitled to. The alternative — pushing the new `CustomerState` down the wire — would
  have put a second copy of the authorization boundary inside a long-lived socket, where the
  session that opened it may since have been revoked. This way a stream can never carry a row its
  subscriber could not have fetched, which is a property rather than a discipline.
- **A subscriber never names its subject.** `topicsFor` reads `request.auth` and nothing else: a
  customer session subscribes to its own card, an *active* staff session to its own actor. This is
  the same rule `GET /audit` spends a route file enforcing, and it is easy to break here because a
  stream looks like plumbing rather than like a read — so `guardrails.test.ts` fails if
  `routes/events.ts` ever mentions `request.query`/`body`/`params`, and a route test asks for
  another card's subject from outside and gets its own.
- **SSE, not WebSockets.** One-way traffic, `EventSource` reconnects by itself, and it is plain
  HTTP over the same cookie session — no second authentication path and no second protocol for
  Phase 8's nginx to proxy. The framing is twenty lines (`events/sse.ts`) rather than a
  dependency, for the reason `auth/cookies.ts` is hand-written.
- **Anonymous is refused, and so is a locked terminal.** `GET /auth/session` is public because
  "not signed in" is a real answer to its question; here there is genuinely nothing to subscribe
  to. The locked case is the more interesting one: an open socket is the one part of a session the
  idle lock would otherwise not reach, and a till showing the PIN pad has no feed to keep fresh.
  It answers `401 locked` rather than `unauthorized`, matching `requireStaff`.
- **Nothing else in this server holds a socket open, so four things had to be added that no other
  route needed.** (1) A `preClose` hook closing every stream — without it `app.close()` waits
  forever and a `SIGTERM` escalates to `SIGKILL` mid-request. (2) A keep-alive comment every 25
  seconds, two beats inside nginx's default 60s `proxy_read_timeout`. (3) `x-accel-buffering: no`,
  because nginx otherwise buffers the stream and the channel looks broken rather than buffered —
  **Phase 8's proxy config has to keep this working**. (4) A 64 KiB backpressure ceiling: a
  subscriber that has stopped reading makes `write` buffer in this process rather than fail, which
  unbounded is a memory leak with an HTTP request as its trigger. Hanging up is safe *because* the
  events carry no data.
- **A stream never outlives its session, and that took six call sites rather than one.** Sign-out,
  "sign out all devices" (staff scope only — a customer's card recognition is outside staff
  revocation, as it is in `SessionStore.resolve`), `PUT`/`DELETE /me`, the account being disabled
  or deleted, and the card being deleted (which publishes `deleted` first, then closes the topic).
  The staff pair is the one worth noticing: `routes/staff.ts` carried a comment saying no session
  cleanup was needed because `resolve` joins `staff_accounts` and a dead account's sessions
  delete themselves *on their next request* — and a held-open stream never makes one. That comment
  now names its own exception.
- **Three concurrent streams per session, and a 429 past it.** An SSE request holds a socket for
  as long as the client wants it, so an authenticated caller opening them in a loop pins the
  process a file descriptor at a time. The subscribe happens **before** the response is hijacked,
  so the refusal is an ordinary JSON reply; nothing can interleave, because that block runs to the
  `writeHead` without awaiting.
- **In-process and single-instance, exactly like `AttemptLimiter`.** The Compose bundle runs one
  `api` container. A second instance needs this in Postgres (`LISTEN`/`NOTIFY`) rather than in a
  `Map`, and the constraint is stated in the module header so it is inherited rather than
  rediscovered. Publishing is fire-and-forget and deliberately outside the store call: a dropped
  signal costs a stale screen until the next read, and a commit that failed because nobody was
  listening would be indefensible.
- **A replayed commit publishes nothing**, for the same reason it writes no audit rows and sends
  no mail — nothing changed the second time, and one accrual would look like two.
- **The channel is narrower than the prototype's `dataVersion`, on purpose**, and that is the one
  thing the maintainer should look at. Pairing bumped a *global* counter, so any shared-data write
  refreshed every paired screen; here a `PATCH /config` (the reward threshold every card renders)
  and staff-account changes publish nothing, because the brief scopes this per customer and per
  till. Cheap to widen (a `program` scope every session subscribes to), much harder to narrow once
  screens assume it. Recorded as register row **X7**, status *Confirm*.
- **The route tests run against a real socket, not `app.inject()`.** The claims are about a
  connection that stays open — that an event arrives while the request that triggered it is still
  in flight, that the socket is still there afterwards, and that it is gone when it should be —
  and a simulated request has none of those properties. `testing/sse.ts` is an `EventSource`-shaped
  client that parses the wire format; its `silentFor` is how "hears only its own subject" is
  asserted, because that claim can only be established by waiting through a silence.
  `authz.test.ts` still covers `/events` like every other route, via `payloadAsStream: true` —
  which resolves at header time — so the matrix stays exhaustive rather than gaining an exception.
- **The security-critical rules were verified by breaking them**, as Phases 2–6 did. Letting the
  client name its own subject (`?topic=`) fails the guardrail; publishing on a replayed commit,
  dropping the `logout-all` close, and removing the per-session cap each fail the tests that claim
  them (1, 1 and 2 failures). **Re-run that check if you touch any of them.**
- **Smoke-tested from `dist/` against a live socket with `curl -N`**, not just the harness:
  `hello` on connect, a commit pushing `changed` to the customer's open card, a replay pushing
  nothing, an admin's delete pushing `deleted` and then ending the stream, and `SIGTERM`
  completing in 1.8s with a stream open. The log was then searched for the name, address, phone,
  card token, password, PIN, both session tokens and the CSRF token — none present. One thing to
  know when reading those logs: `/events` logs `incoming request` and **no** completion line,
  because the response is hijacked and never completes. That is expected, not a lost request.

### Phase 8 — Docker Compose bundle + ops
`compose.yml` + `compose.dev.yml`, four services + mailpit, `.env.example`, healthchecks,
non-root images, backup job **and a performed restore drill**, structured logging with PII
redaction.
Done when: `docker compose up` on a clean machine yields a working system, and a backup has
been restored into a fresh volume at least once.

### Phase 9 — CI + integration tests
Extend `.github/workflows/` to build/test the server against a Postgres service container
and build the images.
Done when: CI is green on this branch.

#### Phase 9 — as built (2026-09-16), and the decisions taken

**Files (all new):** `.github/workflows/ci.yml`, `ops/smoke.sh`, `ops/drill.sh`. **Edited:**
`ops/README.md` (the two scripts, and what the automated drill does and does not prove) and this
file. **No code changed** — the phase adds no product behaviour, which is why the test counts are
Phase 8's unchanged: **442 server**, **73 shared**.

**Four jobs, and three of them exist because an obvious default would have been wrong.**

- **`contract`** — `@cafe/shared` typecheck + 73 tests. No database, no network, and no
  `@cafe/web`: these are the only tests `domain/` has and they must run in a package that is green.
- **`server`** — the gate, against a **`postgres:16-alpine` service container**. It carries
  `POSTGRES_INITDB_ARGS: '--encoding=UTF8 --locale=C'` to match `compose.yml`, because a cluster
  initialised with the runner's collation orders text differently from the deployed one — a
  difference that shows up as a test that passes in one place and not the other. The healthcheck
  names the database rather than just running `pg_isready`, for the reason `compose.yml` already
  records: `pg_isready` answers true while a first boot is still running its init scripts.
- **`bundle`** — `docker compose build api`, then **up from an empty volume**, then
  `ops/smoke.sh`, then a log scan, then `ops/drill.sh`. See below.
- **`web`** — `continue-on-error`, at the job **and** at the typecheck step (without the second
  one the typecheck's failure would stop the job before the test run, which is the half that
  reports the *shape* of the red). It judges nothing; it reports. The `web` **image is not built
  at all**: the SPA does not compile by decision, and a red image build is a red nobody should act
  on.

**The most valuable ten lines in the workflow are a test of the test suite.** `globalSetup.ts`
exists because a run with no database once reported `22 passed | 84 skipped` and exited 0 — green,
having tested nothing. A CI job whose Postgres quietly failed to come up would be that same bug
wearing a bigger hat. So after the suite passes, the workflow runs it **again** against a closed
port and requires it to fail *at the gate*, matching on the message. Verified locally before it was
committed: exit non-zero, `needs a real PostgreSQL database` present.

**`ops/smoke.sh` is the phase's real integration test, and it is a script rather than inline YAML
on purpose.** Every other test in the repo reaches the server in-process (`app.inject`) or reaches
Postgres directly. This one talks to the artifact: emitted `dist/` in a non-root container, behind
the real cookie and CSRF rules, on a database a one-shot `migrate` container built from nothing. It
is what Phases 0, 3, 5 and 10 each did by hand at the end of the phase — sixteen assertions,
including the two refusals (no CSRF header, cross-origin sign-in) that prove the boundary is wired
into the *running* server and not merely into the tests, and a repeated commit that must come back
`replayed: true` with the balance still 1. Living in `ops/` means an operator can run it against a
deployment after a change, which is the other half of why it was worth writing down.

- **Cookies are carried by hand, not in a curl jar**, and that is not a style choice: the bundle
  sets `Secure` cookies (it is meant to sit behind TLS) and **curl will not send a Secure cookie
  back over plain HTTP** — so a jar would have silently smoke-tested an unauthenticated server and
  passed. Holding the pair in a variable keeps the test honest about the production cookie flags.
- **`.env` is read, never sourced.** A real one holds `MAIL_FROM="Ckyka" <no-reply@…>`, and
  `.`-ing that file has the shell treat the angle bracket as a redirect.
- **The log scan names the values that just went through the server** — the admin password, the
  admin PIN, the customer's name and the customer's address — rather than grepping for a pattern.
  `CLAUDE.md` says never log PII, and this is Phase 0's 404-handler leak turned into a check that
  runs every time. The CI bootstrap PIN is **eight digits**, because a four-digit needle is short
  enough to turn up inside a timestamp and fail the build for nothing.

**`ops/drill.sh` turns Phase 8's restore drill from a thing that was done once into a thing that is
done every commit.** A backup path proven in September and never exercised again is a backup path
whose state nobody knows, and the moment it matters is the worst possible moment to find out. It
backs the live database up with `ops/backup.sh`, restores into a **scratch** database (so a failed
drill costs nothing and the live data is never touched), and asserts what a row count does not: the
ledger still **sums** to the same number, the append-only triggers still refuse an `UPDATE` on
`loyalty_transactions` and a `DELETE` on `audit_log`, the unique-active-email index still refuses a
second card on one address, and the argon2id digests came back. All four assertions were run
against a real migrated database before being committed — each refusal fires for the intended
reason, not an incidental one.

**What it deliberately does not automate**, and `ops/README.md` keeps as a manual step: a real
sign-in and a real commit *through the API* against the restored database. That needs the bundle
re-pointed at the scratch database, which is a lot of moving parts to assert something the digest
check covers most of. What is automated is the part that rots silently — schema objects,
constraints and credentials surviving the round trip.

**The whole phase was verified against a live server before it was pushed**, since no Docker daemon
is available in the session container: the server was built, migrated and bootstrapped against a
local Postgres, `ops/smoke.sh` run against it (16/16), then re-run with a wrong password to confirm
it **fails loudly and non-zero** rather than passing over a broken assertion, and the drill's four
SQL assertions executed directly. The Compose-level steps were the part CI ran first.

**And it earned its keep on the first run, which is the whole argument for the phase.** The image
build failed — on `packages/server/Dockerfile`'s *own* "did a production dependency fail to hoist?"
guard, reporting `packages/server/node_modules/@types`. Nothing had failed to hoist: `@types/node`
does not hoist (the workspaces pin different versions), so `npm prune --omit=dev` deletes it as a
devDependency and leaves the empty `@types/` scope directory standing, which a check that listed
*directories* read as a stranded dependency. The guard now looks for
`*/node_modules/*/package.json` — a real unhoisted production dependency still fails the build,
scoped or not, and an empty directory no longer does. Phase 8 built that image by hand and never
hit it; the difference is that CI builds it from a clean checkout every time.

**The second run is green** (`contract` · `server` · `bundle` all pass; `web` fails and does not
gate). Numbers from it, worth keeping because they set the expectation for the next session:
`server` runs 442 tests against the service container in **85s**; the image builds in **17s**; the
bundle is healthy **16s** after `up`; `ops/smoke.sh` clears all 16 assertions in **240ms**; the
drill dumps, restores and asserts in **4s**. One quiet corroboration in the drill's output: it
reports the live database as *1 customer, 1 ledger row, 1 point, 4 audit rows*. Four is exactly
right for what the smoke test did — `card.issue`, `customer.register`, `staff.login`,
`loyalty.accrue` — which is a second, independent proof that the **replayed** commit wrote no
ledger row and no audit row. A fifth would have meant the idempotency cache was not holding.

### Phase 10 — Monorepo flip (**runs second, straight after Phase 6**)
Move `src/domain` + `src/ports` → `packages/shared/src`, what remains of `src/` →
`packages/web/src`; point the alias at the real package. Pure move, no logic change. Also the
moment the server can stop running on `tsx` — with `@cafe/shared` a real package the alias stops
being an alias, and `build` can emit (Phases 0–1 as built).
Done when: the server suite + server `tsc` are green post-move. The root build is red for the
reason Phase 6 made it red; it is not this phase's to fix.

#### Phase 10 — as built (2026-09-16), and the decisions taken

**Moved** (`git mv`, no content change beyond import specifiers): `src/domain` +
`src/ports` → `packages/shared/src`; `tests/domain` → `packages/shared/tests`; everything
else in `src/` → `packages/web/src`; everything else in `tests/` → `packages/web/tests`;
`e2e/` → `packages/web/e2e`; `index.html`, `public/`, `vite.config.ts`,
`vitest.e2e.config.ts`, the three SPA tsconfigs and `.env.example` → `packages/web/`;
`tests/conformance/dataStoreConformance.ts` → `packages/server/src/testing/`.
**New:** `packages/shared/{package.json,tsconfig.json,tsconfig.test.json,vitest.config.ts}`,
`packages/web/package.json`, `packages/server/tsconfig.build.json`.
**Edited:** the root `package.json` (workspace root only), `packages/server/{package.json,
tsconfig.json,vitest.config.ts}`, `domain/insights.ts` + two domain tests (index-safety),
every import specifier in `packages/server/src` and `packages/shared/src` (`.js` extensions),
every `domain`/`ports` import in `packages/web` (now `@cafe/shared/…`), and
`routes/guardrails.test.ts`. **390 server tests** (unchanged) and **73 shared tests**.

- **`@cafe/shared` resolves one way, everywhere, and that is the phase's real deliverable.**
  Before, the contract reached the server through a tsconfig `paths` alias *and* a duplicate
  Vite alias, both hand-pointed at `../../src/*` and both needing to agree — the config
  comments said so in as many words ("Both must point at the same place — Phase 10 repoints
  both"). It is now a workspace package with an `exports` map, so `tsc`, `vitest` and a
  running `node` all resolve `@cafe/shared/domain/models` by the same rule. Both aliases are
  deleted, and so is `@cafe/conformance`: the suite had exactly one consumer left after
  Phase 6 deleted the second store, so it moved beside `PostgresStore.test.ts` and is now a
  relative import.
- **The price of that is a build step, and it is paid by a `pretest` rather than by a
  condition.** `exports` points at `dist`, so every consumer runs
  `npm --prefix ../shared run build` in `pretest`/`prebuild`/`predev`. The tempting
  alternative — a `development` export condition resolving to `.ts` source — would make the
  test run and the shipped artifact resolve *differently*, which is precisely the drift
  killing the two aliases was meant to end. `tsc` is incremental here, so the cost is
  a few hundred milliseconds.
- **`tsx` is no longer the server's runtime**, which closes the Phases 0–1 open item and the
  instruction it left for Phase 8 ("Phase 8's image must run `tsx` until then" — it no longer
  has to). `moduleResolution` moved `Bundler` → `NodeNext`, every relative specifier in the
  server and in shared gained `.js`, and `esModuleInterop` went on (`Bundler` had been
  supplying `allowSyntheticDefaultImports` implicitly for `import pg from 'pg'` and friends).
  `start`, `migrate` and `bootstrap` run `node dist/…`; only `dev` still watches through `tsx`.
  Both paths were booted and checked.
- **`dist/` carries production code only** (`tsconfig.build.json` excludes `**/*.test.ts` and
  `src/testing/`), so the deployed image contains no SMTP sink, no HTTP harness and no
  conformance suite. `tsconfig.json` still type-checks all of it — the exclusion is about what
  ships, not about what is checked.
- **One guardrail was widened, along exactly that line.** The conformance suite calls
  `listAudit`, legitimately, and moving it under `src/` tripped the "only detection reads
  cross-account rows" guard. `guardrails.test.ts` now exempts `src/testing/` wherever it
  already exempted `*.test.ts`, with `tsconfig.build.json` as the definition of the line: a
  guard that exempts "tests" exempts precisely what a deployed server does not contain. The
  guards that exempt *nothing* — no `undo`, no `getStaffByPin` — still scan every file, which
  is why this is opt-in per guard rather than applied to the whole scan.
- **The predicted friction turned up, in the file Phase 4 hadn't needed.** `domain/insights.ts`
  had never been compiled under `noUncheckedIndexedAccess`, because the server imports
  `alerts.ts` and not `insights.ts` — so giving shared one strict tsconfig produced six errors
  in it (plus two in the moved tests). Fixed the same way Phase 4 fixed `alerts.ts`: bind or
  optional-chain the indexed access, no behaviour change, tests unchanged and still green.
  **That is the phase's quiet win** — there is no longer a looser compiler for a shared file
  to drift into.
- **`packages/shared` compiles with `types: []`, and that is a purity guard, not a detail.**
  No ambient `@types/*` at all, so nothing in `domain/` can reach a Node built-in and have it
  typecheck. `lib` is `["ES2023", "DOM"]` only because `domain/tokens.ts` uses
  `crypto.getRandomValues` and `btoa` — web-platform globals Node also implements, which is
  what makes the file shared in the first place. `CLAUDE.md`'s "`domain/` is pure" is still a
  review rule; this is the nearest the compiler can get to enforcing it.
- **The domain tests went to `packages/shared`, not to `packages/web`.** They test the
  contract the *server* depends on, and `packages/web` is knowingly red — parking them there
  would have left the only tests `domain/` has inside a package nobody can run clean. They are
  73 tests that now pass on their own.
- **The SPA is red for the same nine reasons and no new ones, and the arithmetic proves it.**
  47 test files (53 − the 6 domain suites that moved), 38 passing (44 − 6), 189 tests
  (262 − 73), and the same 9 failures: `tests/helpers/freshStore.ts` → `IndexedDbStore`,
  `PairingContext` → `adapters/sync/`, `EnlargedQr` → `wallet/passes`. Every remaining `tsc`
  error is a Phase 6 deletion, and the single unresolved `@cafe/shared` import is
  `ports/Transport`, deleted on purpose. If a future session sees a *tenth* failure, the move
  is not the explanation.
- **Smoke-tested against a live socket from `dist/`, not just `app.inject`**, as Phases 0–5
  did: `node dist/migrate.js` against an empty database, `node dist/bootstrap.js` creating the
  first admin, `node dist/index.js` serving `/healthz` and `/readyz`, a sign-in issuing both
  cookies, and a customer registration — then the log searched for the name, address, password
  and PIN: none present. This is what proves the emit is real rather than merely type-correct.
- **Carried, not fixed: `packages/web/.env.example` is stale.** It moved unedited and still
  documents EmailJS, TURN and the `VITE_TRANSPORT`/`VITE_DATASTORE` flags, all deleted in
  Phase 6. Rewriting it means deciding what the SPA's environment *is* (`VITE_API_BASE` and
  what else), which is a UI-pass question — register row X4. `packages/web/vite.config.ts`
  still carries the GitHub Pages `base` for the same reason.

### Phase 11 — Docs
STATUS divergences (§4 A–E, the PIN-semantics change, offline posture, the scaling note),
close divergence `l`, README architecture + diagrams, `CLAUDE.md` stack/adapters,
SPEC §15 rows, and the Appendix E guarantees restated as server-side invariants. Per the
`CLAUDE.md` documentation rule. Also, post-2026-09-16: retire every doc statement that describes
the prototype adapters as current (README's seam table and file tree, `CLAUDE.md`'s "Prototype
transport" section and its `Transport`/`WalletProvider` non-negotiables, SPEC §15's wallet and
token-only rows), and fold the settled rows of `UI-RECONCILIATION.md` into `STATUS.md` so there
is one record rather than two.

---

## 6 · Acceptance

> Two criteria were **struck on 2026-09-16** and are recorded here rather than deleted, so that
> a reader who remembers them can see they were retired on purpose:
> - ~~*The swap changes only the composition root* — `git diff` over `src/ui/` + `src/services/`
>   is empty across Phases 0–10.~~ The maintainer revoked the promise this enforced. Replaced by
>   the reconciliation register: **no backend-vs-UI conflict reaches the UI pass unrecorded.**
> - ~~*`PostgresStore` is behaviourally identical to `IndexedDbStore`* — one conformance suite,
>   two stores, both green.~~ There is no second store. The suite survives as `PostgresStore`'s
>   own specification; what it no longer proves is a cross-store equivalence nobody needs.

| Criterion | Proven by |
|---|---|
| Every backend-vs-UI conflict is written down before the UI pass | [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md), one row per conflict, each with a status |
| The port is shaped for the server, not for the retired prototype | §4's six contract problems each resolved in `ports/DataStore.ts`, not worked around at the boundary |
| The commit is genuinely atomic under concurrency | Two-till concurrent-commit test (Phase 2) |
| Idempotent commit survives retries | Same-key retry returns the cached result, no second write |
| No client can act above its tier | Authz test matrix (Phase 4) |
| Cross-account activity has no endpoint | No route returns another account's activity; the ranged query is internal-only (Phase 4) |
| No post-commit undo was reintroduced | `grep` for `undo` across `packages/server` stays empty; correction is `reverse` only |
| Credentials are never stored or logged recoverably | argon2id at rest; redacting log serializer; PIN/password never in logs |
| No PII in logs, URLs, or error payloads | Log-redaction test + a route audit |
| Customer recognition survives iOS ITP | HttpOnly cookie identity (manual device check) |
| The bundle comes up clean from nothing | `docker compose up` on a fresh machine — and on every commit, from an empty volume, in CI's `bundle` job |
| Backups restore | A restore drill actually performed, not just scripted — by hand in Phase 8, and by `ops/drill.sh` in CI since Phase 9 |
| Every claim above stays true | CI (`.github/workflows/ci.yml`), including a check that the suite still **refuses to run** without a database — the failure mode that would make every other green meaningless |

---

## 7 · Risk notes

- **The parallel frontend agent** is the biggest practical risk, and it is a live one: the
  Appendix E rework landed on `main` between this plan being written and any code being
  written, and it changed the `DataStore` port. Mitigated by deferring the file move to
  Phase 10 and keeping Phases 0–9 additive — that first merge came through clean. **Merge
  `main` at the start of every phase** and re-check §3/§4 against the port before building;
  do not "helpfully" restructure early.
- **Appendix E's guarantees are product decisions, not implementation details.** No undo, no
  ambient cross-account feed, and — after the triage — no activity export at all. A backend makes each trivially easy
  to undo by accident — an "admin activity" endpoint, a "reverse transaction" route added for
  convenience. §2 locks them; treat a request to relax one as a maintainer decision, not a
  design shortcut.
- **Offline behaviour** (§4, last item) is the one place "no UI rewrite" is genuinely under
  pressure. Decide it in Phase 6 deliberately; don't let it leak into per-screen changes.
- **The PIN semantics change** (§4-B) is a real, unavoidable divergence from prototype
  behaviour, not a refactor. Flag it to the maintainer rather than silently changing it.
- **Scope is now the triage's, not this plan's.** [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md)
  is authoritative on what gets built; re-read it at the start of every phase alongside `main`.
- **Scope discipline.** `CLAUDE.md`: no money handling, no gifting, no marketing automation,
  no multi-tenant, no dependencies the spec didn't call for. A backend makes all of those
  *newly easy to build*, which is exactly why the restraint matters more here, not less.
