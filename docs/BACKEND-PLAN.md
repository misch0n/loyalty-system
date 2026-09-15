# Backend — build plan (prototype → production, Docker Compose bundle)

> **Active initiative.** Replaces the prototype's browser-local backing (IndexedDB +
> localStorage + PeerJS pairing) with a real **Node + TypeScript + Fastify + PostgreSQL**
> backend, shipped as a **Docker Compose bundle**. Executes SPEC §14 (Prototype →
> Production Migration) steps 1, 2, 4 and 5. Step 3 (Wallet) is **out of scope entirely** — the
> triage dropped wallet, retiring the `WalletProvider` port with it.
>
> **The promise this plan must keep:** *no UI or service rewrite.* Every screen and every
> `services/` call site stays byte-for-byte identical; only adapters and the composition
> root change. If a phase below requires touching `src/ui/`, that is a defect in the plan,
> not a licence to edit the UI. Two phases touch `src/` by design and only those two: **Phase 6**
> (additive adapter wiring) and **Phase 10** (the monorepo file move).

---

## 0 · HOW TO USE THIS ACROSS SESSIONS (read first)

Same protocol as [`REWARDS-PLAN.md`](REWARDS-PLAN.md) — written so work continues with
context cleared between tasks.

**Resume protocol for a new session:**
1. Work on branch **`claude/backend-implementation-2kqb08`**. Merge `origin/main` first —
   frontend work lands there and has already changed the `DataStore` port once mid-plan.
2. Read [`STATUS.md`](STATUS.md) (current state), [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md)
   (what is in scope — it **overrides** `../CLAUDE.md` where they differ), then this file.
3. Find the first **unchecked** box in the *Progress checklist* (§1) — that's the next task.
4. Do **only that phase**. Stay within its file list. Honour the architecture rules in
   [`../CLAUDE.md`](../CLAUDE.md), as amended by SCOPE-DECISIONS §5.
5. Before committing: root `npx tsc --noEmit` + `npm test` + `npm run build` must pass **and**,
   from Phase 0 on, the server's own `npm test -w @cafe/server` (**315** as of Phase 4). The SPA's
   461 tests must not regress — if a phase breaks them, the phase is wrong, not the tests. (They
   were 448 until Phase 2 moved the port contract into the shared conformance suite: +41
   conformance tests, −28 duplicates the shared suite absorbed from `IndexedDbStore.test.ts`.)
6. Tick the box here, update the `STATUS.md` "Last updated" line, commit + push.
7. Stop. The next session picks up the next box.

**Parallel work warning.** Frontend work has been landing on `main` in parallel with this
initiative (Appendix E arrived mid-plan and changed the `DataStore` port — see *Baseline*). **Phases 0–9 deliberately do not move or rewrite a single
existing frontend file** — new code lands in `packages/server/`, and the only edits to
`src/` are the two additive adapter changes in Phase 6. *(One exception so far: Phase 4 made
`src/domain/alerts.ts` index-safe so the server could import it under its stricter tsconfig —
a pure refactor, no behaviour change, recorded in "Phase 4 — as built". Expect the same for any
other shared file the server comes to import.)* The monorepo file move that would
conflict with every frontend diff is isolated into **Phase 10**, to be run *after* frontend
work has settled. Divergences get reconciled then. **Merge `main` at the start of every phase.**

**Running the server tests.** The suite **requires** a real Postgres and fails without one:
`packages/server/src/testing/globalSetup.ts` checks reachability once per run and aborts with
setup instructions, so there is no way to get a green tick without a database. Most of the 208
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
npm test -w @cafe/server                             # expect: 208 passed, 0 skipped
```

**Do not reintroduce a skip.** The conformance harness has no `skip` option, and the database
check lives in the Vitest config rather than in a `skipIf` per file — so a new database-backed
test cannot opt out by accident. A suite whose entire purpose is proving `PostgresStore` behaves
like `IndexedDbStore` is worthless skipped, and worse than worthless when the skip reports green.

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

> **NEXT TASK: Phase 5** — the server-side `Mailer` + the recovery flow.
> Phase 4 landed 2026-09-15: every `ApiStore` path has a route, on three tiers, with the actor
> derived from the session, audit written server-side, cross-account activity reachable only as
> derived *findings*, and the whole surface pinned by a route inventory and an authorization
> matrix. **315 server tests** (was 208); the SPA's **461** are untouched.
>
> **The server suite needs a real Postgres and FAILS without one** — it does not skip. Most of
> its tests are database-backed, and before Phase 2 they skipped themselves when no database was
> reachable, so a run with no Postgres reported `22 passed | 84 skipped` and exited **0** — green,
> having tested nothing. It now aborts in `globalSetup` with the commands to start one. See §0
> *Running the server tests*.
>
> Read §5 Phase 5 and the decisions Phases 1–4 recorded at the foot of §5 before starting. Phase 5
> inherits four calls in particular:
> - **`createRecoveryCode` and `consumeRecoveryCode` deliberately have no routes yet.** Phase 4
>   built neither: minting a recovery code is an *internal step* of the request flow, not something
>   a client asks for, and the consume route's security is the lockout that Phase 5's reshape
>   introduces. Build both here, together, or neither.
> - **Recovery codes are SHA-256 at rest, sized for the prototype's high-entropy code.** The typed
>   code (SCOPE-DECISIONS §2.3) is short, so length stops carrying the security: the `attempts`
>   column and per-address rate limiting do. Revisit the hash choice, and add the limiter to
>   `createAuthDeps` beside `registerLimiter` and `commitLimiter`.
> - **Registration already answers `email_in_use`** (§3.4 requires it), and that answer is an
>   enumeration oracle held shut by a failure-counting lockout. Recovery must be the opposite —
>   an unknown address indistinguishable from a known one — so do not copy registration's shape.
> - **`LoyaltyService` sends the reward-available and welcome mails through the `Mailer` port
>   client-side.** In a server build the routes are where the send belongs (the commit route knows
>   what was minted; the register route knows the card was created). Decide that explicitly rather
>   than leaving two senders.
>
> **A live gap Phase 4 found and did not fix, for whoever reaches Phase 8:** `bootstrap.ts` is
> built and tested but **nothing calls it**. `index.ts` does not (a long-running API should not
> seed), and `migrate.ts`'s CLI entrypoint does not either — so a freshly migrated database has no
> admin and no way to create one over HTTP, since `POST /staff` is admin-tier. The one-shot
> `migrate` container is the natural place; wire it there.

- [x] **Phase 0** — Workspace scaffolding + Fastify skeleton (no frontend files touched)
- [x] **Phase 1** — Postgres schema + migrations
- [x] **Phase 2** — `PostgresStore` + the shared `DataStore` conformance suite  ⟵ the core
- [x] **Phase 3** — Auth: password/PIN hashing, sessions, epoch revocation, rate limits
- [x] **Phase 4** — HTTP API surface + the authorization boundary
- [ ] **Phase 5** — Server-side `Mailer` + recovery flow
- [ ] **Phase 6** — Client adapters: real `ApiStore`, `ServerIdentityStore`, composition root
- [ ] **Phase 7** — Realtime push (SSE) — replaces what device pairing provided
- [ ] **Phase 8** — Docker Compose bundle + ops (backups, health, logging)
- [ ] **Phase 9** — CI + integration tests against a real Postgres
- [ ] **Phase 10** — Monorepo flip (`packages/shared` + `packages/web`) — **after** frontend lands
- [ ] **Phase 11** — Docs (STATUS divergences, README, CLAUDE.md, SPEC §15 rows)

Phase 2 was the big one and everything from 4 onward builds on it (Phases 0+1 landed together).
The wallet phase is gone — the triage dropped wallet entirely.

---

## 2 · Locked decisions (settled with the maintainer)

| # | Decision | Rationale |
|---|---|---|
| Code layout | **npm workspaces monorepo** — `packages/shared` (domain + ports), `packages/web` (the SPA), `packages/server`. One source of truth for the contract; no drift. | Chosen over a path-alias `server/` and over a duplicated copy. A drifting copy of `ports/DataStore.ts` is exactly the failure the ports architecture exists to prevent. |
| Move timing | The **physical file move is Phase 10**, last. Phases 0–9 build the server at `packages/server` importing `domain`/`ports` **through the workspace alias `@cafe/shared`, resolved for now to the existing `src/domain` + `src/ports`**. Phase 10 moves those two folders into `packages/shared` and `src/` into `packages/web/src` — a pure move, no logic change. | A restructure that renames every frontend file would conflict with every diff the parallel frontend agent produces. Destination is unchanged; only the ordering is chosen to avoid a merge disaster. |
| HTTP + DB | **Fastify + `pg` + hand-written numbered SQL migrations.** No ORM. | Matches the repo's "small and boring" rule. The commit transaction is the one piece of logic that must be *obvious* — explicit `BEGIN` / `SELECT … FOR UPDATE` / `COMMIT` beats an ORM's transaction abstraction. Fastify's JSON-schema route validation covers the boundary without a validation dependency. |
| Sessions | **HttpOnly, `Secure`, `SameSite=Lax` cookie sessions for both staff and customers**, server-side session rows. CSRF via double-submit token on all mutating routes. | Server-set HttpOnly cookies are the **only** customer recognition that survives iOS ITP — the durability gap [`COLLAB-NOTES.md`](COLLAB-NOTES.md) records as unsolvable client-side, and a large part of why the backend is worth building. Cookie sessions also make `sessionEpoch` revocation real (delete the rows) rather than "wait for the JWT to expire". |
| Passwords/PINs | **argon2id**, hashed **server-side from the plaintext**. The client never hashes. | See §4-A: `setStaffPassword(id, passwordHash)` as written would make the hash itself the password. |
| Actor | `staffId` / actor identity is **always derived from the session server-side** and overrides anything in the request body. | The client is untrusted. This is the anti-fraud anchor from `CLAUDE.md` ("staff initiates the credit") made real. |
| Audit | Audit rows are written **by the route handler**, server-side, in the same transaction as the action. The client's `appendAudit` becomes a rejected/no-op call. | A client-writable audit log is not an audit log. |
| Migrations | Numbered, forward-only `.sql` files applied by a one-shot `migrate` container before `api` starts. No down-migrations. | Restores are from backups, not from down-migrations. |
| Prototype path | The IndexedDB prototype **stays fully working and is not deleted**. Both stores must pass the same conformance suite. | The prototype is the demo and the reference implementation. It is also how we prove the swap is behaviour-preserving. |
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

## 4 · Contract problems to resolve before Phase 4 (read before writing routes)

`ApiStore` mirrors `DataStore` 1:1. That is right for *shape* — it is what keeps the UI
unchanged — but a `DataStore` method is a **trusted, in-process call** in the prototype and
becomes an **untrusted, cross-network call** over HTTP. Six of them are unsafe as literally
specified. The fix in each case is server-side, so `ports/DataStore.ts` and every UI call
site stay untouched:

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

**One more, not a security issue but a behaviour change:** `IndexedDbStore` never fails
offline; `ApiStore` will. No screen currently has a network-error path. Phase 6 must decide
the posture — surface a retry/offline state, or accept that a server-backed build requires
connectivity — and Phase 11 must record it (the plan has no Phase 12). This is one of two places
where "no UI rewrite" is under real pressure; the intended answer is a shared error surface in the
adapter plus the existing toast, not per-screen changes. **The other is `LoyaltyService.getAlerts`,
which Phase 4 left without a `DataStore` path** — see "Phase 4 — as built".

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

### Phase 6 — Client adapters + composition root
Fill in `ApiStore.request` (credentials, CSRF header, typed errors, one error surface); new
`ServerIdentityStore`; `createServices` wires the server adapters under `VITE_DATASTORE=api`;
`isPrototype` already flips correctly and drops the dev panel + pairing. **The only phase
that edits `src/`**, and only additively.
Done when: the SPA runs fully against the API with no screen changed.

### Phase 7 — Realtime push (SSE)
`GET /events` + a client subscriber feeding the existing `dataVersion` refresh.
Done when: a commit on the till updates the customer's open card without a reload.

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

### Phase 10 — Monorepo flip (after the frontend work lands)
Move `src/domain` + `src/ports` → `packages/shared/src`, `src/` → `packages/web/src`; point
the alias at the real package. Pure move, no logic change. Reconcile frontend divergences here.
Done when: root `npm test` + `npm run build` + the server suite are all green post-move.

### Phase 11 — Docs
STATUS divergences (§4 A–E, the PIN-semantics change, offline posture, the scaling note),
close divergence `l`, README architecture + diagrams, `CLAUDE.md` stack/adapters,
SPEC §15 rows, and the Appendix E guarantees restated as server-side invariants. Per the
`CLAUDE.md` documentation rule.

---

## 6 · Acceptance

| Criterion | Proven by |
|---|---|
| The swap changes only the composition root | `git diff` over `src/ui/` + `src/services/` is empty across Phases 0–10 |
| `PostgresStore` is behaviourally identical to `IndexedDbStore` | One conformance suite, two stores, both green |
| The commit is genuinely atomic under concurrency | Two-till concurrent-commit test (Phase 2) |
| Idempotent commit survives retries | Same-key retry returns the cached result, no second write |
| No client can act above its tier | Authz test matrix (Phase 4) |
| Cross-account activity has no endpoint | No route returns another account's activity; the ranged query is internal-only (Phase 4) |
| No post-commit undo was reintroduced | `grep` for `undo` across `packages/server` stays empty; correction is `reverse` only |
| Credentials are never stored or logged recoverably | argon2id at rest; redacting log serializer; PIN/password never in logs |
| No PII in logs, URLs, or error payloads | Log-redaction test + a route audit |
| Customer recognition survives iOS ITP | HttpOnly cookie identity (manual device check) |
| The bundle comes up clean from nothing | `docker compose up` on a fresh machine |
| Backups restore | A restore drill actually performed, not just scripted |

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
