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
   from Phase 0 on, the server's own `npm test -w @cafe/server`. The SPA's 448 tests must not
   regress — if a phase breaks them, the phase is wrong, not the tests.
6. Tick the box here, update the `STATUS.md` "Last updated" line, commit + push.
7. Stop. The next session picks up the next box.

**Parallel work warning.** Frontend work has been landing on `main` in parallel with this
initiative (Appendix E arrived mid-plan and changed the `DataStore` port — see *Baseline*). **Phases 0–9 deliberately do not move or rewrite a single
existing frontend file** — new code lands in `packages/server/`, and the only edits to
`src/` are the two additive adapter changes in Phase 6. The monorepo file move that would
conflict with every frontend diff is isolated into **Phase 10**, to be run *after* frontend
work has settled. Divergences get reconciled then. **Merge `main` at the start of every phase.**

**Running the server tests.** 22 of the 50 run anywhere; the 28 migration and bootstrap tests
need a real Postgres and **skip silently without one**. Point them at a database with
`TEST_DATABASE_URL` (default `postgres://cafe:cafe@localhost:5432/cafe_loyalty_test`). Until the
Compose bundle lands in Phase 8, a local server does the job:

```bash
export PGDATA=/var/lib/postgresql/testdata          # any directory postgres can own
mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l /tmp/pg.log -w start"
su postgres -c "psql -h localhost -c \"CREATE ROLE cafe LOGIN PASSWORD 'cafe' SUPERUSER;\""
su postgres -c "psql -h localhost -c 'CREATE DATABASE cafe_loyalty_test OWNER cafe;'"
npm test -w @cafe/server                             # expect: 50 passed, 0 skipped
```

**A run reporting skipped files is an unverified run.** Phase 2's conformance suite makes this
sharper still — its entire purpose is to exercise Postgres behaviour IndexedDB cannot give us,
so skipping it proves nothing at all.

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

> **NEXT TASK: Phase 2** — `PostgresStore` + the shared `DataStore` conformance suite. Phases 0
> and 1 landed together (2026-09-15): `packages/server` exists, the schema migrates clean, and
> **all 50 server tests pass** alongside the SPA's unchanged 448.
>
> **⚠ 28 of those 50 need a real Postgres and SKIP without one** (every `migrate` and
> `bootstrap` test). A skip is **not** a pass — `Test Files 3 passed | 2 skipped` means the
> schema was never exercised. Server CI does not exist until Phase 9, so nothing else catches
> this. **Start a database before you trust a green run** — see §0 *Running the server tests*.
>
> Read §5 Phase 2 and the decisions Phase 1 recorded at the foot of §5 before starting.

- [x] **Phase 0** — Workspace scaffolding + Fastify skeleton (no frontend files touched)
- [x] **Phase 1** — Postgres schema + migrations
- [ ] **Phase 2** — `PostgresStore` + the shared `DataStore` conformance suite  ⟵ the core
- [ ] **Phase 3** — Auth: password/PIN hashing, sessions, epoch revocation, rate limits
- [ ] **Phase 4** — HTTP API surface + the authorization boundary
- [ ] **Phase 5** — Server-side `Mailer` + recovery flow
- [ ] **Phase 6** — Client adapters: real `ApiStore`, `ServerIdentityStore`, composition root
- [ ] **Phase 7** — Realtime push (SSE) — replaces what device pairing provided
- [ ] **Phase 8** — Docker Compose bundle + ops (backups, health, logging)
- [ ] **Phase 9** — CI + integration tests against a real Postgres
- [ ] **Phase 10** — Monorepo flip (`packages/shared` + `packages/web`) — **after** frontend lands
- [ ] **Phase 11** — Docs (STATUS divergences, README, CLAUDE.md, SPEC §15 rows)

Phase 2 is the big one and everything from 4 onward depends on it (Phases 0+1 landed together).
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

- **A · `setStaffPassword(id, passwordHash)`** — the parameter name promises the client
  sends a hash. If the server stores what it's given, that "hash" *is* the password: anyone
  who reads the database can authenticate with it, and the client can set an account's
  credential to a known value. **Fix:** the route takes the plaintext over TLS and hashes
  with argon2id server-side. Keep the port signature; document that in a server-backed build
  the value is a plaintext credential in transit, hashed before it is stored. Same for
  `setStaffPin`.
- **B · `getStaffByPin(pin)`** — a *global* search for whichever account has that PIN. Over
  HTTP that is an unauthenticated credential oracle, brute-forceable across the whole staff
  table at 4 digits. **Fix:** the route becomes "verify this PIN for the account this
  device's session already identifies" (the Unlock screen re-auths a *known* account), never
  "find the account with this PIN". Rate-limit and lock out. **Record as a divergence** — the
  prototype's global-PIN semantics genuinely cannot be preserved.
- **C · `appendAudit(entry)`** — a client-supplied actor and action. **Fix:** route handlers
  write audit rows themselves, in the same transaction as the action; the client-facing
  method is rejected server-side.
- **D · `CounterTransaction.staffId`** — body-supplied. **Fix:** overridden from the session.
  A customer's device must not be able to commit points at all.
- **E · `listAllTransactions()` / `exportAll()`** — "fetch everything" is free against
  IndexedDB and an unbounded table scan plus a multi-megabyte response over HTTP. The admin
  stats screens feed `domain/insights.ts`, which is pure and consumes raw rows.
  **Fix for this pass:** keep the raw-row shape but require a date range and cap the page
  size; add real aggregate endpoints only if the stats screens get slow. Record as a known
  scaling divergence rather than pre-optimising. `listAudit()` is **no longer** in this
  category — Appendix E gave `AuditFilter` a real ranged, multi-value query
  (`actions[]`/`actorIds[]`/`from`/`to`), which maps straight onto an indexed SQL query;
  just enforce a server-side `limit` ceiling since the client picks the limit.
- **F · `AuditService.exportActivity(actor, filter, reason)`** — **resolved by deletion.**
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
connectivity — and Phase 12 must record it. This is the one place where "no UI rewrite" is
under real pressure; the intended answer is a shared error surface in the adapter plus the
existing toast, not per-screen changes.

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

### Phase 3 — Auth: hashing, sessions, revocation, rate limits
argon2id password + PIN, `sessions` table, cookie issue/verify, idle lock, epoch
revocation, per-route rate limits, CSRF. Resolves §4-A and §4-B.
Done when: sign-in, PIN unlock, idle lock and "sign out all devices" work end-to-end
against the API, with tests.

### Phase 4 — HTTP API surface + authorization boundary
Routes for every `ApiStore` path, three authz tiers, server-written audit, session-derived
actor, server-side config clamping, boundary validation, PII kept out of URLs and logs.
Server-side detection (BE-S-09) reads the internal ranged audit query. Resolves §4-C, D, E
(F is resolved by deletion).
Done when: an authz test matrix passes — each tier is proven to be refused everything above
it — and **no route returns another account's activity at all**.

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
