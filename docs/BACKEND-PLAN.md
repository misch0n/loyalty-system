# Backend — build plan (prototype → production, Docker Compose bundle)

> **Active initiative.** Replaces the prototype's browser-local backing (IndexedDB +
> localStorage + PeerJS pairing) with a real **Node + TypeScript + Fastify + PostgreSQL**
> backend, shipped as a **Docker Compose bundle**. Executes SPEC §14 (Prototype →
> Production Migration) steps 1, 2, 4 and 5; step 3 (Wallet) is gated on Apple/Google
> credentials and is planned but deferred.
>
> **The promise this plan must keep:** *no UI or service rewrite.* Every screen and every
> `services/` call site stays byte-for-byte identical; only adapters and the composition
> root change. If a phase below requires touching `src/ui/`, that is a defect in the plan,
> not a licence to edit the UI — with the two explicit, listed exceptions in §7.

---

## 0 · HOW TO USE THIS ACROSS SESSIONS (read first)

Same protocol as [`REWARDS-PLAN.md`](REWARDS-PLAN.md) — written so work continues with
context cleared between tasks.

**Resume protocol for a new session:**
1. Read [`STATUS.md`](STATUS.md) (current state), then this file.
2. Find the first **unchecked** box in the *Progress checklist* (§1) — that's the next task.
3. Do **only that phase**. Stay within its file list. Honour the architecture rules in
   [`../CLAUDE.md`](../CLAUDE.md).
4. Before committing: `npx tsc --noEmit` + `npm test` + `npm run build` must pass **and**,
   from Phase 2 on, the server's own `npm test -w @cafe/server`.
5. Tick the box here, update the `STATUS.md` "Last updated" line, commit + push.
6. Stop. The next session picks up the next box.

**Parallel work warning.** A separate agent is finishing frontend work on `src/` at the
same time as this initiative. **Phases 0–10 deliberately do not move or rewrite a single
existing frontend file** — new code lands in `packages/server/`, and the only edits to
`src/` are the two additive adapter changes in Phase 6. The monorepo file move that would
conflict with every frontend diff is isolated into **Phase 11**, to be run *after* the
frontend work lands. Divergences get reconciled then.

---

## 1 · Progress checklist

- [ ] **Phase 0** — Workspace scaffolding + Fastify skeleton (no frontend files touched)
- [ ] **Phase 1** — Postgres schema + migrations
- [ ] **Phase 2** — `PostgresStore` + the shared `DataStore` conformance suite  ⟵ the core
- [ ] **Phase 3** — Auth: password/PIN hashing, sessions, epoch revocation, rate limits
- [ ] **Phase 4** — HTTP API surface + the authorization boundary
- [ ] **Phase 5** — Server-side `Mailer` + recovery flow
- [ ] **Phase 6** — Client adapters: real `ApiStore`, `ServerIdentityStore`, composition root
- [ ] **Phase 7** — Realtime push (SSE) — replaces what device pairing provided
- [ ] **Phase 8** — Docker Compose bundle + ops (backups, health, logging)
- [ ] **Phase 9** — CI + integration tests against a real Postgres
- [ ] **Phase 10** — `ServerWalletProvider` (PassKit + APNs, Google REST) — credential-gated
- [ ] **Phase 11** — Monorepo flip (`packages/shared` + `packages/web`) — **after** frontend lands
- [ ] **Phase 12** — Docs (STATUS divergences, README, CLAUDE.md, SPEC §15 rows)

Phase 2 is the big one and everything from 4 onward depends on it. Phases 0+1 can land
together. Phase 10 can be skipped indefinitely without blocking a working deployment.

---

## 2 · Locked decisions (settled with the maintainer)

| # | Decision | Rationale |
|---|---|---|
| Code layout | **npm workspaces monorepo** — `packages/shared` (domain + ports), `packages/web` (the SPA), `packages/server`. One source of truth for the contract; no drift. | Chosen over a path-alias `server/` and over a duplicated copy. A drifting copy of `ports/DataStore.ts` is exactly the failure the ports architecture exists to prevent. |
| Move timing | The **physical file move is Phase 11**, last. Phases 0–10 build the server at `packages/server` importing `domain`/`ports` **through the workspace alias `@cafe/shared`, resolved for now to the existing `src/domain` + `src/ports`**. Phase 11 moves those two folders into `packages/shared` and `src/` into `packages/web/src` — a pure move, no logic change. | A restructure that renames every frontend file would conflict with every diff the parallel frontend agent produces. Destination is unchanged; only the ordering is chosen to avoid a merge disaster. |
| HTTP + DB | **Fastify + `pg` + hand-written numbered SQL migrations.** No ORM. | Matches the repo's "small and boring" rule. The commit transaction is the one piece of logic that must be *obvious* — explicit `BEGIN` / `SELECT … FOR UPDATE` / `COMMIT` beats an ORM's transaction abstraction. Fastify's JSON-schema route validation covers the boundary without a validation dependency. |
| Sessions | **HttpOnly, `Secure`, `SameSite=Lax` cookie sessions for both staff and customers**, server-side session rows. CSRF via double-submit token on all mutating routes. | Server-set HttpOnly cookies are the **only** customer recognition that survives iOS ITP — the durability gap [`COLLAB-NOTES.md`](COLLAB-NOTES.md) records as unsolvable client-side, and a large part of why the backend is worth building. Cookie sessions also make `sessionEpoch` revocation real (delete the rows) rather than "wait for the JWT to expire". |
| Passwords/PINs | **argon2id**, hashed **server-side from the plaintext**. The client never hashes. | See §4-A: `setStaffPassword(id, passwordHash)` as written would make the hash itself the password. |
| Actor | `staffId` / actor identity is **always derived from the session server-side** and overrides anything in the request body. | The client is untrusted. This is the anti-fraud anchor from `CLAUDE.md` ("staff initiates the credit") made real. |
| Audit | Audit rows are written **by the route handler**, server-side, in the same transaction as the action. The client's `appendAudit` becomes a rejected/no-op call. | A client-writable audit log is not an audit log. |
| Migrations | Numbered, forward-only `.sql` files applied by a one-shot `migrate` container before `api` starts. No down-migrations. | Restores are from backups, not from down-migrations. |
| Prototype path | The IndexedDB prototype **stays fully working and is not deleted**. Both stores must pass the same conformance suite. | The prototype is the demo and the reference implementation. It is also how we prove the swap is behaviour-preserving. |

---

## 3 · What the backend has to cover (the scope list)

This is the answer to "what do we have to cover" — 17 areas, each mapped to its phase.

### A · Data & storage

1. **Postgres schema** — `program_config` (singleton row), `staff_accounts`, `customers`,
   `loyalty_transactions`, `rewards`, `reward_events`, `idempotency_keys`,
   `recovery_codes`, `audit_log`, `sessions`. Mirrors IndexedDB schema v5
   (`src/adapters/storage/schema.ts`) plus a `sessions` table the prototype never needed.
   *(Phase 1)*
2. **Indexes + constraints** carrying every IDB index across: customers by token /
   short code / email; rewards by owner / token / status / short code; reward events by
   reward / owner; transactions by customer + timestamp; audit by action / actor /
   timestamp. Plus what IndexedDB *couldn't* enforce: unique short codes among active
   cards, unique PIN among active accounts, FK integrity, and **append-only enforcement**
   on `loyalty_transactions` / `reward_events` / `audit_log` (revoke UPDATE/DELETE from the
   app role, or a rule/trigger). *(Phase 1)*
3. **`PostgresStore implements DataStore`** — all **34** port methods, unchanged
   signatures. *(Phase 2)*
4. **The atomic commit** — `commitCounterTransaction` as one SQL transaction with
   `SELECT … FOR UPDATE` on the customer row: idempotency-key lookup → `over_cap` /
   `customer_not_found` short-circuit → accrual → `mintFold` → per-reward re-validation and
   subset redeem → cache the `CommitResult` under the key. Plus `undoCommit` on the same
   basis. **This closes STATUS divergence `l`** — IndexedDB gives transaction scope but no
   row lock, so two concurrent tills can interleave; Postgres row locking makes the
   atomicity claim actually true. *(Phase 2)*
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
   (scan resolve, commit, undo, read config), **admin** (staff CRUD, config write, stats,
   audit, export/import). Enforced per-route from the session. See §4 for the port methods
   that are *unsafe as literally specified*. *(Phase 4)*
10. **Hardening** — per-route rate limiting (login, PIN, recovery request, commit), CSRF
    double-submit, security headers, strict boundary validation via Fastify JSON schemas,
    no account-enumeration oracle on recovery, `trust proxy` for Cloudflare, server-side
    token generation. *(Phases 3, 4, 8)*
11. **PII discipline server-side** — the `CLAUDE.md` "never log PII" rule now applies to
    request logs too: a redacting serializer (no name/email/phone in access logs, error
    payloads, or query logs), and no PII in URLs (note: `GET /customers?term=…` currently
    puts an email in a query string — move to `POST` or a hashed lookup). *(Phases 4, 8)*

### C · Services the browser can no longer do

12. **Server-side `Mailer`** — Resend/SES/Brevo behind the existing `Mailer` port; EmailJS
    (which exposes its public key in the bundle and can be driven by anyone) is dropped in
    the server build. Recovery, reward-available and card-created templates. *(Phase 5)*
13. **Recovery** — codes hashed at rest, single-use consume in one transaction, short
    expiry, constant-time/constant-shape response. *(Phase 5)*
14. **Realtime push** — the prototype's PeerJS pairing layer (`src/adapters/sync/`) is
    **dropped entirely** in the server build, and with it the live cross-device refresh it
    provided. Replacement: an **SSE** channel (`GET /events`) pushing a `changed` signal
    per customer and per till, feeding the same `dataVersion` refresh the screens already
    use. Without this, a customer's phone won't update when staff commits. *(Phase 7)*
15. **`ServerTransport`** — the registration-handoff seam. Note it is close to vacuous now:
    staff-initiated registration was removed (STATUS), so registration is customer
    self-service against a real URL and the seam needs little more than that. Confirm and
    either implement thinly or record it as retired. *(Phase 4)*
16. **`ServerWalletProvider`** — PassKit web service (device register/unregister, serial
    list, pass fetch, log endpoint), `.pkpass` signing, APNs push; Google Wallet REST
    (signed JWT + object patch). Requires an Apple Developer certificate and a Google
    service account before any of it can be verified end-to-end. *(Phase 10)*

### D · Delivery

17. **Docker Compose bundle** — `db` (postgres:16, named volume, healthcheck), `migrate`
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
becomes an **untrusted, cross-network call** over HTTP. Five methods are unsafe as literally
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
- **E · `listAllTransactions()` / `listAudit()` / `exportAll()`** — "fetch everything" is
  free against IndexedDB and an unbounded table scan plus a multi-megabyte response over
  HTTP. The admin stats screens feed `domain/insights.ts`, which is pure and consumes raw
  rows. **Fix for this pass:** keep the raw-row shape but require a date range and cap the
  page size; add real aggregate endpoints only if the stats screens get slow. Record as a
  known scaling divergence rather than pre-optimising.

**One more, not a security issue but a behaviour change:** `IndexedDbStore` never fails
offline; `ApiStore` will. No screen currently has a network-error path. Phase 6 must decide
the posture — surface a retry/offline state, or accept that a server-backed build requires
connectivity — and Phase 12 must record it. This is the one place where "no UI rewrite" is
under real pressure; the intended answer is a shared error surface in the adapter plus the
existing toast, not per-screen changes.

---

## 5 · Phases (each = one task)

### Phase 0 — Workspace scaffolding + Fastify skeleton
Root `package.json` gains `workspaces`. New `packages/server` (`@cafe/server`): Fastify,
`pg`, argon2, tsconfig with `@cafe/shared` mapped to the existing `src/domain` + `src/ports`,
Vitest, `/healthz`, graceful shutdown, env schema validation. **No existing file is moved.**
Done when: `npm run dev -w @cafe/server` serves `/healthz`, root `npm test`/`build` still green.

### Phase 1 — Postgres schema + migrations
Numbered SQL migrations for the 10 tables + indexes + append-only enforcement + the
production bootstrap seed. A `migrate` entrypoint that is idempotent and safe to re-run.
Done when: a fresh `db` container migrates clean, and re-running is a no-op.

### Phase 2 — `PostgresStore` + conformance suite  ⟵ the core
All 34 `DataStore` methods; `commitCounterTransaction` and `undoCommit` with row locking
(§3-A-4). Generalize the IDB adapter tests into a shared suite run against both stores.
Done when: the same suite passes against `IndexedDbStore` and `PostgresStore`, including a
**concurrency test** two tills committing at once — the case IndexedDB cannot win.

### Phase 3 — Auth: hashing, sessions, revocation, rate limits
argon2id password + PIN, `sessions` table, cookie issue/verify, idle lock, epoch
revocation, per-route rate limits, CSRF. Resolves §4-A and §4-B.
Done when: sign-in, PIN unlock, idle lock and "sign out all devices" work end-to-end
against the API, with tests.

### Phase 4 — HTTP API surface + authorization boundary
Routes for every `ApiStore` path, three authz tiers, server-written audit, session-derived
actor, boundary validation, PII kept out of URLs and logs. Resolves §4-C, D, E.
Done when: an authz test matrix passes — each tier is proven to be refused everything above it.

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

### Phase 10 — `ServerWalletProvider` (credential-gated)
PassKit web service + APNs, Google Wallet REST. **Blocked** until an Apple certificate and a
Google service account exist; until then it stays the throwing placeholder it is today.

### Phase 11 — Monorepo flip (after the frontend work lands)
Move `src/domain` + `src/ports` → `packages/shared/src`, `src/` → `packages/web/src`; point
the alias at the real package. Pure move, no logic change. Reconcile frontend divergences here.
Done when: root `npm test` + `npm run build` + the server suite are all green post-move.

### Phase 12 — Docs
STATUS divergences (§4 A–E, the PIN-semantics change, offline posture, the scaling note),
close divergence `l`, README architecture + diagrams, `CLAUDE.md` stack/adapters,
SPEC §15 rows. Per the `CLAUDE.md` documentation rule.

---

## 6 · Acceptance

| Criterion | Proven by |
|---|---|
| The swap changes only the composition root | `git diff` over `src/ui/` + `src/services/` is empty across Phases 0–10 |
| `PostgresStore` is behaviourally identical to `IndexedDbStore` | One conformance suite, two stores, both green |
| The commit is genuinely atomic under concurrency | Two-till concurrent-commit test (Phase 2) |
| Idempotent commit + undo survive retries | Same-key retry returns the cached result, no second write |
| No client can act above its tier | Authz test matrix (Phase 4) |
| Credentials are never stored or logged recoverably | argon2id at rest; redacting log serializer; PIN/password never in logs |
| No PII in logs, URLs, or error payloads | Log-redaction test + a route audit |
| Customer recognition survives iOS ITP | HttpOnly cookie identity (manual device check) |
| The bundle comes up clean from nothing | `docker compose up` on a fresh machine |
| Backups restore | A restore drill actually performed, not just scripted |

---

## 7 · Risk notes

- **The parallel frontend agent** is the biggest practical risk. Mitigated by deferring the
  file move to Phase 11 and keeping Phases 0–10 additive. Do not "helpfully" restructure early.
- **Offline behaviour** (§4, last item) is the one place "no UI rewrite" is genuinely under
  pressure. Decide it in Phase 6 deliberately; don't let it leak into per-screen changes.
- **The PIN semantics change** (§4-B) is a real, unavoidable divergence from prototype
  behaviour, not a refactor. Flag it to the maintainer rather than silently changing it.
- **Wallet** (Phase 10) cannot be finished without third-party credentials. Everything else
  ships without it.
- **Scope discipline.** `CLAUDE.md`: no money handling, no gifting, no marketing automation,
  no multi-tenant, no dependencies the spec didn't call for. A backend makes all of those
  *newly easy to build*, which is exactly why the restraint matters more here, not less.
