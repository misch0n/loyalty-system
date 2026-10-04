# UI pass — build plan (the SPA, rebuilt against the API)

> **Active initiative.** The backend is complete (all of [`BACKEND-PLAN.md`](BACKEND-PLAN.md)'s
> phases). `@cafe/web` was **deliberately red** — 39 TypeScript errors across 13 files, and 9 of
> its **47** test files failing to load (this plan first said 53; 47 is the count STATUS has
> carried since Phase 10 moved the domain suites into `@cafe/shared`) — every one traceable to a
> Phase 6 deletion. This plan makes it green again *against the API*, not against the store that
> was deleted. **UI-0, UI-1, UI-1b, UI-2, UI-3 and UI-4 are done: 0 errors, all 51 test files load and pass
> (472 tests), and `npm run build -w @cafe/web` produces a bundle (the first since Phase 6 came with UI-2).**
> What is left is behaviour, not compilation: liveness (UI-5), environment and e2e (UI-6), install
> (UI-7), the gates (UI-8) and the docs (UI-9).
>
> **Input:** [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md) — 35 rows saying what the backend does,
> what the UI does today, and the gap. That register is the specification; this file is the
> sequence. A row is not "done" until its register entry says so. **Every decision this plan was
> blocked on was answered on 2026-10-03** (§1), which added one phase — **UI-1b**, retiring the PIN
> and the idle lock on the server — ahead of UI-2.
>
> **Ground truth is the backend.** Where a screen and the server disagree, the server wins and the
> screen changes. That is the 2026-09-16 decision (SCOPE-DECISIONS §6) and it is why this pass
> exists at all.

---

## 0 · HOW TO USE THIS ACROSS SESSIONS (read first)

**Resume protocol for a new session:**
1. Work on branch **`claude/backend-implementation-2kqb08`** (or a `claude/ui-pass-*` branch cut
   from it). **It is not merged into `main` yet** — `main` has none of this work — and will be
   **tagged `backend-v1`** on the commit that landed UI-1b (SCOPE-DECISIONS §6.6).
2. Read [`STATUS.md`](STATUS.md), [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md),
   [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md), then this file.
3. Find the first **unchecked** box in §2 — that's the next task.
4. Do **only that phase**. Honour `../CLAUDE.md` *as amended by* SCOPE-DECISIONS §5 and §6 — large
   parts of its UI section describe screens this pass deletes.
5. Before committing: `npm run typecheck --workspaces`, `npm test --workspaces`, and
   `npm run build -w @cafe/web`. Run the SPA suite under **Node 22** (Node 25's built-in
   `localStorage` shadows jsdom's), and note that `npm test -w @cafe/web` now **needs Postgres** — its
   `live` project fails, never skips, without one; `npx vitest --project ui` runs the screen and
   component tests alone, with nothing running. **The server suite must stay green** — this pass may reshape
   `packages/web/src/services/` and `packages/shared/src/ports/`, and breaking the server with a
   port edit is the main way this pass can do damage.
6. Tick the box, add any new conflict as a register row, refresh `STATUS.md`, commit + push.

**The error count was the progress bar, and it reads 0.** `npm run typecheck -w @cafe/web 2>&1 |
grep -c "error TS"` started at **39**; it read **14** after UI-0, **16** after UI-1b (the two new
ones were `setStaffPin` callers), **15** after UI-1 (whose rewritten `ApiStore` test dropped one of
them) and **0** after UI-2, which deleted the rest. From here the bar is the test shape: **47 files,
360 tests** — 40 `ui` files (293 tests) and 7 `live` files (67 tests); `@cafe/shared` is 7 files / 85
tests and `@cafe/server` 439. (UI-2 ended at 44 files / 310 tests = 38 `ui` + 6 `live` / 64.) A later phase that moves the typecheck off
0 or drops a file has broken something, and a number that does not move as a phase predicts means the
phase found something the register missed — add a row.

**CI reports the shape of the SPA on every commit** (`web` job, `continue-on-error` until UI-8, now
with a Postgres service and real Typecheck / Tests / Build steps). A failing test file — **9 before
UI-0, 6 from UI-0 to UI-1, none after UI-2** — is something this pass broke, not something Phase 6
caused.

---

## 1 · Decisions (all answered 2026-10-03 — nothing blocks this plan)

Each is a register row with a dated resolution; the register has the detail, this table says only
where the answer lands.

| Row | Answer | Lands in |
|---|---|---|
| **S1** | Shared till; **the PIN and the idle lock are removed entirely**; attribution is the signed-in account; "remember me" persists a login (hardening deferred). | **UI-1b** (server + port), then UI-2 and UI-3 |
| **X2** | One classifier in `ApiStore.request`; session → global, connectivity → both, action → local. | UI-1 (classifier + global) ✅, UI-4 (local) ✅ |
| **A7** | Admin step-up becomes a plain "Are you sure?" — no credential. The server never enforced it. | ~~UI-3~~ **UI-2** (pulled forward, 2026-10-04) |
| **P6** | **No fake `DataStore`.** Service tests run against the real server + a test Postgres. | UI-2 ✅ |
| **P7** | The `audit.log` calls leave the services. | UI-2 ✅ |
| **X7** | Next-load staleness is fine; a `program` push scope stays the cheap upgrade. | UI-5 |
| **X5** | Base `/`, `VITE_API_BASE` stays. A Pages-hosted SPA cannot reach this backend. | UI-6 |

**C3** and **A3** were marked Confirm in the register — services rewritten against routes — and
rode along in UI-2 (done 2026-10-04); neither blocked anything.

---

## 2 · Progress checklist

- [x] **UI-0** — Delete what is already decided dead → **39 errors became 14** ✅ 2026-09-16
- [x] **UI-1** — `ApiStore.request` + the error surface → **16 errors became 15** ✅ 2026-10-04
- [x] **UI-1b** — Retire the PIN and the idle lock (server + port) → tagged `backend-v1` ✅ 2026-10-04
- [x] **UI-2** — Services reshaped to the routes, and their tests rebuilt → **15 errors became 0**, first bundle since Phase 6 ✅ 2026-10-04
- [x] **UI-3** — Screens whose behaviour the backend changed → Register, LostCard, card menu, Scan, config bounds, account sheet and the boot reconcile now match the server; 47 files / 360 tests ✅ 2026-10-04
- [x] **UI-4** — Error and offline states on screen → every screen reports a failure at the point of action (one shared mapper, no failure toasts); Scan keeps an unsent commit and its key for retry; 51 files / 472 tests ✅ 2026-10-04
- [ ] **UI-5** — Liveness: the SSE subscriber replaces `dataVersion`
- [ ] **UI-6** — Environment, serving, e2e
- [ ] **UI-7** — Camera permission + install as a home-screen app
- [ ] **UI-8** — Close the gates (CI + Compose stop excusing the SPA)
- [ ] **UI-9** — Docs (the deferred BACKEND-PLAN Phase 11, plus `CLAUDE.md`)

UI-0 is mechanical and large. UI-2 is the real work. UI-8 is the definition of "finished". UI-1 and
UI-1b touch different packages and can go in either order, but **both precede UI-2**.

---

## 3 · Phases

### UI-0 — Delete what is already decided dead
Pure deletion, no new code, no decisions. Every item is **Settled** in the register.

- **Pairing** (P1): `ui/common/PairingContext.tsx`, `ui/common/PairDevices.tsx`, the `/pair` route,
  `ProtoPanel`, `DevTrigger`. *18 + 1 errors.*
- **Wallet** (P2): the wallet button, `WalletButton`, `wallet/passes`, `services.wallet` reads in
  `EnlargedQr` and `Scan`. *5 errors.* Decide whether the `source: 'w'` enum shrinks — the ledger
  still records it harmlessly.
- **Admin export** (A1): the Export sheet, past-exports list, `exportActivity`, `parseExportRecord`.
- **Admin stats** (A2): the four stat tiles, `StatDetail`.
- **Env flags** (P4): `isPrototype` in `App.tsx`, `turnConfigured`. *1 error.*

**Done when:** `~14` errors remain, all of them in `services/` or `tests/`; the currently-passing
SPA test files still pass; no `grep` hit for `adapters/sync`, `WalletProvider`, `isPrototype`.

**As built (2026-09-16).** Exactly 14 errors remain, all in `services/` (5 files) and
`tests/helpers/freshStore.ts`. Test files went 47 → 44 and failures 9 → **6**: `Card`,
`EnlargedQr` and `Panel` load and pass again, and the three suites whose subjects were deleted
(`ProtoPanel`, `_parts/Export`, `storageSnapshot`) went with them — 38 files green, 180 tests.
`@cafe/shared` (73) and `@cafe/server` (442) stayed green with clean typechecks; this phase
touched neither package. Beyond the list above it also deleted **`ui/common/storageSnapshot.ts`**
(the pairing push/pop had no other caller, and `main.tsx`'s boot self-heal existed only to undo a
half-finished pairing) and **`e2e/prototype.e2e.ts`** + `tapDevTrigger` (the panel they drove is
gone; the rest of `e2e/` is UI-6's). Three judgement calls worth knowing:
- **The `source: 'a' | 'w'` enum stays** (P2's open question): the ledger and audit rows record it
  harmlessly, and shrinking it would edit `@cafe/shared` and the server's schema to no UI end.
- **`@cafe/shared/domain/insights.ts` stays** even though no screen reads it now — the server's
  activity route does.
- **`Card` and `Panel` lost their live refetch.** Both keyed an effect on the pairing
  `dataVersion`; with `PairingContext` gone they load once per visit until UI-5's SSE subscriber
  restores it. This is the one behaviour UI-0 took away rather than deleted outright, and it is
  called out in each screen's header comment.

### UI-1 — `ApiStore.request` + the error surface
Rows P8, X3, X2 (**Settled 2026-10-03**).

Write the one method the whole SPA talks through: `credentials: 'include'`, the CSRF token echoed
from the script-readable cookie, JSON in and out, and **every failure mapped to one typed union**
— `offline`, `locked`, `forbidden`, `rate_limited` (carrying `retry-after`), `email_in_use`,
`conflict`, `server`. No screen parses a status code or invents its own.

Then the **global handlers**, which are this phase's half of the routing rules (X2): a **session**
failure (expired, signed out everywhere, account disabled or deleted) routes to sign-in from one
place and no screen handles it; a **connectivity** failure raises the persistent global banner.
The local halves — connectivity reported at the point of action, and action errors on the field or
control — are UI-4's. Background failures (an SSE-triggered refetch) stay silent.

**Verify, don't assert:** with the PIN and idle lock gone (S1), `locked` may no longer be a
reachable failure. Check what the server can still return after UI-1b before keeping it in the
union. Likewise settle which 403s the `forbidden` member covers — an earlier draft of this plan
named `csrf_failed` instead.

**Done when:** a test double drives every branch of that union, and `ApiStore` satisfies the shared
conformance suite for the methods the port still has.

**As built (2026-10-04).** `@cafe/web` errors **16 → 15** (the rewritten `ApiStore` test no longer
calls `setStaffPin`); test files **44 → 46**, the same **6** not loading, **257** tests passing (was
180). `@cafe/server` 439 and `@cafe/shared` 73 untouched and green; both typechecks clean.
- **`adapters/http/ApiClient.ts`** is the one `request`: `credentials: 'include'`, `x-csrf-token`
  echoed from the `cafe_csrf` cookie on POST/PUT/PATCH/DELETE, JSON in and out (`Content-Type`
  only with a body — Fastify refuses an empty JSON body), 204 → `undefined`, a **15 s timeout**
  (under nginx's 30 s). It is separate from `ApiStore` so UI-2 can call the routes the port does
  not carry (`/auth/*`, `/recovery/*`, `/alerts`, `/me`) through the same choke point, and it takes
  an injectable `fetch` + `readCsrfToken`, which is what the P6 cookie-jar harness plugs into.
- **`adapters/http/ApiError.ts`** — the union, **verified against the server rather than taken
  from this plan**: `offline | signed_out | forbidden | not_found | rate_limited | email_in_use |
  conflict | rejected | server`. **`locked` is dropped** (UI-1b removed every `401 locked`).
  **`signed_out`** is the session member the draft lacked — `401 unauthorized`, which is what TTL
  expiry, sign-out-all and a disabled or deleted account all look like. **`not_found`** and
  **`rejected`** cover the 404/400 refusals the server really sends (`invalid_details`,
  `invalid_code`, `range_too_wide`, the `reversal_*` codes…); a wrong password is `rejected` /
  `invalid_credentials` — a 401 that must never trip the session handler. **`forbidden`** is every
  403: `forbidden`, `csrf_failed`, `forbidden_origin`, `staff_device` (the code says which). Each
  carries the server's `code` where one exists; `rate_limited` carries `retryAfterSec` from the body,
  then the header, else `null`. `failureScope()` maps a failure to X2's `session | connectivity |
  action`. A 2xx that is not JSON (a dev server's `index.html`) is `server`, not data.
- **`ApiStore`** rewritten on the client, **every path matched to a real route** — the skeleton's
  were guesses (`findCustomers` is `POST /customers/search`, not a query string). Lookups resolve
  `null` on 404; the commit's `over_cap` / `customer_not_found` refusals come back as the port's
  `CommitResult` value. It sends only what each route reads — no client token, no `staffId`, no
  `actorId` filter. `setStaffPin` is gone. Two port methods **have no route** and reject without a
  request: `getStaffByUsername` and `listAllTransactions` (new register row **P9**).
- **Global handlers** — `ui/app/ConnectionWatch.tsx`, mounted in `main.tsx` inside `AuthProvider`,
  listens on `services.connection` (the client's subscribe half; screens import the error types
  from `services/errors.ts`, never from `adapters/`). **Session** → `logout()` + `/login`, only when
  a staff actor is signed in. **Connectivity** → a persistent terra banner ("Can't reach the
  server…"), lowered by the next answer below 500 — a refusal proves the server is there.
  **Action** failures are ignored here (UI-4).
- **On "the shared conformance suite":** it cannot run against `ApiStore` as written — it takes a
  `TrustedStore` (`appendAudit`, the recovery-code methods), which a client must not be. What
  stands in for it: `tests/adapters/ApiStore.test.ts` pins every method's route and body against a
  `fetch` double, and a **live run against the devbox API** (scratch script, cookie jar, signed in
  as the dev admin) passed **36/36** — every port method except `importAll`, skipped because it
  replaces the database, plus `signed_out` before login and after logout, `invalid_credentials`,
  `username_taken`, `email_in_use`, `already_reversed`, commit replay, `over_cap` as a value, a
  deleted card reading back as a tombstone, and `offline` with nothing listening. Making that live
  run a committed suite is the P6 harness, UI-2.
- **Deferred:** background calls (an SSE-triggered refetch) are meant to stay silent (X2), but the
  port's methods take no options, so the client cannot yet tell one from a foreground call — UI-5,
  which introduces the only background caller, decides how.

### UI-1b — Retire the PIN and the idle lock (server + port)
Row S1 (**Settled 2026-10-03**). Unlike every other phase here, this touches **`packages/server`
and `packages/shared/src/ports/`**, not the SPA — and it lands **before UI-2** so UI-2 does not
rebuild PIN logic only to delete it.

The device is a shared till; there is no shift picker; attribution is the signed-in account
(SCOPE-DECISIONS §6.3). Remove, from the server and the port:

- `POST /auth/unlock` (`routes/auth.ts`), its tests, and its row in the authorization matrix.
- `IDLE_LOCK_MS` and the idle-lock check — in `auth/guards.ts` and the `locked` / idle-expiry
  outcome in `auth/sessions.ts`. `GET /events` stops refusing "idle-locked" callers because there
  are none.
- The `pin` column (a new forward-only migration; never edit one already applied), `setStaffPin`
  and PIN verification in `PostgresStore`, the PIN failure counter, the set-PIN route
  (`PATCH /staff/:id/pin`) and the `pin` field on create-account.
- `BOOTSTRAP_ADMIN_PIN` — `env.ts`, `bootstrap.ts`, `migrate.ts`, both `.env.example` files, the
  Compose files and `ops/` docs.
- The PIN methods and fields on the `DataStore` port and the staff types.

**Keep:** the session TTL split — `REMEMBERED_TTL_MS` (30 days) and `EPHEMERAL_TTL_MS` (12 hours) in
`auth/sessions.ts`. "Remember me" is how a login persists; a test should show a remembered session
surviving more than 5 minutes idle. **Deferred, not dropped:** a security-hardening round on
remember-me, later.

**State the consequence in the docs it touches:** audit rows, "your last hour" and both detectors
are per account, not per person at the till.

**Done when:** the **server suite is green** and **`@cafe/shared` is green**, both typechecks
clean, no `grep` hit for `IDLE_LOCK_MS`, `setStaffPin`, `BOOTSTRAP_ADMIN_PIN` or `/auth/unlock`
outside the migration history and the docs that record their removal. `@cafe/web` is not the gate
here, but removing port methods that `StaffService` and `ApiStore` still reference may move its
error count — record the new number in this file; UI-2 deletes the callers. **Then the branch is
tagged** (SCOPE-DECISIONS §6.6).

**As built (2026-10-04).** Tagged **`backend-v1`**. Server: **439 tests** (was 442), green against
real Postgres with none skipped; `@cafe/shared` 73; both typechecks clean. Removed: 7 unlock tests,
3 + 3 idle-lock tests, "signs a locked terminal out" and the `/staff/:id/pin` authz row. Added: 4 + 4
TTL tests (including a remembered session surviving more than 5 minutes idle), the 002 upgrade-path
test, a leftover-`BOOTSTRAP_ADMIN_PIN` test and a legacy-snapshot test.
- **Sessions** end only at their absolute TTL (`REMEMBERED_TTL_MS` / `EPHEMERAL_TTL_MS`, kept), on
  account disable or delete, or on epoch revocation. `IDLE_LOCK_MS`, `SessionState` and the
  `locked` state are gone; `GET /auth/session` now returns `'active' | 'anon'`. `last_seen_at` is
  still written each request but is bookkeeping only, kept for the deferred remember-me round.
- **API:** `POST /auth/unlock`, `PATCH /staff/:id/pin`, `pinLimiter` and the `401 locked` refusal
  are gone. `POST /staff` still *accepts* a `pin` field — Fastify strips it silently rather than
  returning 400, so the current SPA's Add-profile form keeps working (a test asserts this).
- **Storage:** forward-only migration `002_retire_pin.sql` drops `staff_accounts.pin_hash`.
  Snapshot import ignores a legacy `pin` on staff, so old backups still restore.
- **Env:** `BOOTSTRAP_ADMIN_PIN` is out of `env.ts`, `bootstrap.ts`, `migrate.ts`, both
  `.env.example` files, `compose.yml`, CI and `ops/`; the bootstrap admin is username + password
  (+ optional name). A leftover `BOOTSTRAP_ADMIN_PIN` in an old `.env` is ignored (tested). That
  test in `env.test.ts` is the one deliberate source hit on the removal grep.
- **Log redaction** still treats `pin` / `pinHash` / `pin_hash` as sensitive keys, because the
  current SPA and old snapshots can still send one.
- **`@cafe/web` errors 14 → 16.** Both new ones are `setStaffPin`: `src/services/StaffService.ts`
  and `tests/adapters/ApiStore.test.ts`. Test files unchanged: 6 of 44 not loading, 180 tests pass.
- **Live check:** the devbox bundle was rebuilt, `migrate` applied 002 to the existing database,
  `pin_hash` is gone, `ops/smoke.sh` passes and `POST /auth/unlock` returns 404.
- **Still in the SPA** (UI-2 / UI-3): `ApiStore.setStaffPin`, `StaffService` PIN logic,
  `AuthContext.unlock` and its `'locked'` status, `session.ts`, `EntryResolver`, `useStaffGuard`,
  `PinPad`, `Unlock`, `StepUp`, and the `ProgramEdit` PIN paths. *(All of it went in UI-2,
  2026-10-04 — see that phase's as-built.)*

### UI-2 — Services reshaped, tests rebuilt  ⟵ the real work
The 15 remaining errors are all here (the 14 UI-0 left, plus the `StaffService` `setStaffPin`
caller UI-1b left behind — UI-1 removed the test one). Rows C3, A3, P6, P7, P9, S1.

- **Routes off the port** (`/auth/*`, `/recovery/*`, `/alerts`, `/me`) go through UI-1's
  `ApiClient.request` — same cookies, CSRF and `ApiError` — not a second `fetch`.
- **The two unrouted port methods** (P9): `getStaffByUsername` and `listAllTransactions` reject in
  `ApiStore`. Stop calling them (sign-in → `POST /auth/login`; alerts → `GET /alerts`), then decide
  whether they leave `DataStore` for `TrustedStore` — a port edit, so run the server suite.

- **`RecoveryService`** (C3) → `POST /recovery/request` then `POST /recovery/consume(email, code)`.
  It no longer mints codes or sends mail.
- **`LoyaltyService.getAlerts`** (A3) → `GET /alerts`. Five store reads become one call. Note the
  server detects over **30 days**; the prototype read everything.
- **`AuditService`** (P7, Settled) → the `audit.log` calls leave the services and `AuditService`'s
  client write path goes. No no-op shim.
- **`StaffService`** (S1, Settled) → `getStaffByPin` is gone; `passwordHash` becomes `password` (the
  server hashes). **PIN logic goes entirely** — `loginWithPin`, `setPin` and PIN validation — not
  "unlock-only"; UI-1b has already removed the server side.
- **`CustomerService`** → drop the `Transport` import and `nextCardToken`.
- **`LoyaltyService`** → drop `RedeemResult` / `redeemReward`, the retired path.
- **Test harness** (P6, Settled — **no fake `DataStore`**): the service suites and `ApiStore` run
  **against the real server and a test Postgres**, replacing `freshStore.ts`, with the server
  suite's discipline — they **fail, not skip**, without a database. Node's `fetch` keeps no
  cookies, so the harness needs a **cookie jar**. Screen and component tests are untouched: they
  already stub at the services level with `vi.fn()` via `ServicesProvider` (e.g. `Card.test.tsx`).
- **A dev seed for the backend** (what the deleted `demoSeed` provided), kept until release. The
  decision did not assign it a phase; it sits here beside the harness.

**Done when:** **0 TypeScript errors**, `tsc -b` passes, every SPA test file loads (6 of 46 fail to
load after UI-1) with the service suites passing against a real server, and
`npm run build -w @cafe/web` produces a bundle for the first time since Phase 6.

**As built (2026-10-04).** `@cafe/web` errors **15 → 0**, `tsc -b` passes, and `npm run build -w
@cafe/web` produces a bundle for the first time since Phase 6. Test files **46 → 44, all loading**:
**310 tests** — 38 `ui` files plus 6 `live` files (64 tests: StaffService 20, CustomerService 14,
LoyaltyService 12, ConfigAndAudit 8, RecoveryService 5, ApiStore 5). It was 257 passing in 40 of 46
loading files. `@cafe/shared` 73 and `@cafe/server` 439 untouched in count and green, both typechecks
clean (this phase did edit the port — P9 below).
- **Services reshaped to the routes** (C3, A3, P7, S1). **No service writes an audit row or sends
  mail — the routes do both, from the session.** `AuditService` is read-only: `list` → `GET /audit`
  (always the session's own rows), `log` gone, no shim. `ConfigService.update(patch)` takes no actor
  and no longer passes `sessionEpoch` (the server refuses it). `StaffService`: `login(username,
  password, remember)` → `POST /auth/login` (wrong password, disabled, unknown and rate-limited
  resolve `{ ok: false, reason }`; anything else throws `ApiError`), new `logout()` → `POST
  /auth/logout`, new `session()` → `GET /auth/session`, `currentSessionEpoch()` reads it,
  `revokeAllSessions()` → `POST /auth/logout-all` (ends the caller's own session too);
  `create(username, password, role, name?)`, `setActive(id, active)`, `resetPassword(id, pw)`,
  `remove(actor, id)`; the server's `username_taken`, `cannot_delete_self` and `cannot_disable_self`
  become sentences. **All PIN logic is gone** — `loginWithPin`, `setPin`, validation. `RecoveryService(api)`:
  `request(email)` → `POST /recovery/request`; `consume(email, code)` → `POST /recovery/consume`,
  resolving `{ token }` or `null` for every `invalid_code`; it no longer mints codes or sends mail.
  `LoyaltyService(store, api)`: state reads go through `GET /customers/:id/state` (the old
  client-side `buildState` read staff-only `GET /config`, which a customer's phone cannot);
  `getAlerts()` → `GET /alerts` (server window **30 days**), `dismissAlert(key)`; `reverse` and
  `commit(actor, input)` keep `actor` only to fill the port's `staffId`, which the route discards.
  **Removed:** `accrue`, `redeem` / `RedeemResult`, `getStats`. `CustomerService(store)`:
  `selfRegister` (name + email required server-side; `400 invalid_details` and `409 email_in_use`
  surface as `ApiError`), `checkDuplicates`, `find`, `getByToken`, `getById`, `correct(id, patch)`,
  `reissue(id)`, `canRecover`, `deleteCustomer(id)`, `selfDelete(token)`. **Removed:** `issueCard`,
  `provisionFromToken`, `finalizeRegistration` (token-only shell cards went with SCOPE-DECISIONS
  §2.1), `nextCardToken`, the `Transport` import and the welcome mail. `RegistrationDetails` is now
  `RegistrationInput` from `domain/validation`.
- **The services name no adapter.** `services/types.ts` gained an `Api` interface (`request<T>(method,
  path, body?)`) that UI-1's `ApiClient` satisfies, so routes off the port go through the same
  cookies, CSRF and `ApiError` without a second `fetch`. `SYSTEM_ACTOR` is gone.
  `createServices(options?)` takes `ApiClientOptions`, which is how the Node harness injects a
  cookie-jar `fetch`.
- **P9 decided — a port edit.** `getStaffByUsername` and `listAllTransactions` moved from `DataStore`
  to **`TrustedStore`** (`packages/shared/src/ports/DataStore.ts`); `packages/server/src/detection.ts`
  now takes a `TrustedStore`; `ApiStore`'s two rejecting stubs are gone, and
  `tests/adapters/ApiStore.test.ts` asserts `ApiStore` has none of `TrustedStore`'s methods. The
  server suite stayed at 439, green.
- **P6 harness — no fake store.** `packages/web/vitest.projects.ts` (a Vitest workspace, referenced
  from `vite.config.ts` `test.workspace` so the e2e config is unaffected) defines two projects:
  **`ui`** (jsdom, everything except `tests/live/**`) and **`live`** (node, a single fork — the files
  share one server and global config). `tests/live/globalSetup.ts` checks the database and **fails,
  never skips**, without one (verified: exit 1 with an explanatory message); drops and recreates
  the `public` schema of `TEST_DATABASE_URL` (default
  `postgres://cafe:cafe@localhost:5432/cafe_loyalty_test` — the same database the server suite uses,
  which is safe because workspaces run sequentially), borrowing `pg` from the server package; runs
  the server's built `dist/migrate.js` with a bootstrap admin; starts an SMTP sink
  (`tests/live/smtpSink.ts`, a restatement of the server's testing sink, since the two packages share
  only `@cafe/shared`) behind a tiny JSON mailbox so tests can read recovery codes; spawns `node
  dist/index.js` on a free port and waits for `/readyz`. **The SPA reaches the server only through
  its `dist/` entry points and environment variables.** `@cafe/web`'s `pretest` runs `npm --prefix
  ../server run build`, so `dist/` is never stale. `tests/live/harness.ts`: a **device** is a real
  `createServices` plus a cookie jar (`packages/web/dev/jarFetch.ts`) plus a random
  `x-forwarded-for`, so per-IP rate limits do not cross tests. **Deleted:**
  `tests/helpers/freshStore.ts`, `tests/helpers/spyMailer.ts` and the six IndexedDB-era
  `tests/services/*.test.ts` (rebuilt as `tests/live/*`). Quick UI-only run: `npx vitest --project ui`
  — needs nothing running. Node 22 is still required for jsdom.
- **Dev seed.** `packages/web/dev/seed.ts`, `npm run seed:dev -w @cafe/web` (via `vite-node`): signs
  in as an existing admin (`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`; `SEED_API_URL` defaults to
  `http://127.0.0.1:3000`, `SEED_APP_URL` to `http://localhost:5173`), creates a `barista` staff
  account and three cards — one mid-progress, one with a reward, one empty — through the real
  routes, and prints their card links. Idempotent; verified against the devbox Compose image.
- **CI.** The `web` job gained a Postgres service plus `TEST_DATABASE_URL` and real Typecheck / Tests
  / Build steps. It stays `continue-on-error` until UI-8.
- **Screen work pulled forward from UI-3** (S1/A7), because removing the PIN service methods left
  these screens nothing to call. **Deleted:** the **Unlock** screen and the `/staff/unlock` route;
  **`PinPad`** and its test; `AuthContext.unlock`, the `'locked'` status and the 5-minute idle timer
  (`INACTIVITY_MS`, `isIdle`, `lastActivity`; `session.ts` `reconcile(session, serverEpoch)` is now
  revoked → anon, else active, and a legacy blob carrying `lastActivity` still parses);
  `recordActivity` (out of Login / Panel / Scan); the `EntryResolver` and `useStaffGuard` locked
  branches; **"Reset PIN"** in `AccountSheet`; the **PIN field on Add profile**. **A7:** `StepUp`
  became **`ConfirmSheet`** (`admin/_parts/ConfirmSheet/`) — a plain "Sign out all devices?" with
  Cancel / "Sign out all", no credential — and `ProgramEdit` lost its PIN pad, so its own Save is
  the confirmation. After "Sign out all devices" succeeds the admin's device signs out and goes to
  `/login`, because the server ended that session too. `AuthContext.logout()` now also calls `POST
  /auth/logout` (best effort). Login's copy reads "A remembered device stays signed in for 30 days,
  until you sign out."
- **C2, half.** `RecoverConsume` (the `/recover/:code` landing) is deleted with `ROUTES.recoverWithCode`
  and `recoverPath` — the server mails a six-character code, so no link exists to land from;
  `/recover` still redirects to `/lost`. *(The interim gap — `LostCard` requested a code with no
  screen to type it into — was closed by UI-3.)*
- **Review follow-ups.** `StaffService.login` returns the session `epoch` from `POST /auth/login`,
  so `AuthContext` no longer makes a second `GET /auth/session` after signing in — a request that
  could fail after the cookie was set and report a sign-in that worked as one that did not.
  `fake-indexeddb` left `@cafe/web`'s devDependencies with its last user, `freshStore.ts`.
- **What the `live` suite proved about the server**, end to end rather than by reading it: "Sign out
  all devices" ends the caller's own session; deleting an account ends its sessions; a till cannot
  consume a recovery code (`403 staff_device`); staff cannot delete a customer (`404`); the server
  clamps `repeatCount` 1 → 2.
- **Still open, owned by the next phases:** error states are not on screen (UI-4). *(The recovery
  code-entry screen, `Register`'s optional name and email and the boot reconcile against
  `GET /auth/session` were closed by UI-3.)*

### UI-3 — Screens whose behaviour the backend changed
**Done 2026-10-04 — see the as-built below.** All **Settled**; no new decisions. **UI-2 already did
the S1 and A7 deletions (below), so UI-3's remaining scope was the list that follows.** C1 (name + email required, handle `409 email_in_use` by
offering recovery — `Register` is still optional-everything), C2 (recovery becomes request → wait →
**type code** → bound; the `/recover/:code` landing is already gone, the code-entry step is not
built), C4 (drop the recovery-tier warning), C5 (deletion copy says the address frees up), C6 (card
menu: one entry, delete), S2 (after a commit, return to the counter), A4 (config bounds match the
server's, with an error path), A5 (say plainly that the threshold is drinks-per-reward), A6 (surface
the refusal to disable your own account — the service now turns `cannot_disable_self` into a
sentence, which `AccountSheet` shows only as a toast), X1 (`AuthContext` reconciles against `GET /auth/session` at
boot; the inactivity timer is **already gone**, so only the reconcile remains).

**The S1 and A7 screen work (2026-10-03) — pulled forward and done in UI-2 (2026-10-04)**, because
removing `StaffService`'s PIN methods left these screens nothing to call: the **Unlock screen** and
its route, `PinPad`, `AuthContext.unlock` (and the `'locked'` status and idle timer), the
`EntryResolver` / `useStaffGuard` locked branches, "reset PIN" in the admin account sheet, and the
PIN field on Add profile are deleted. **Step-up (A7):** `StepUp` is now `ConfirmSheet`, and
`ProgramEdit` saves on its own confirmation; no credential anywhere. Nothing of this is left for
UI-3.

**As built (2026-10-04).** `@cafe/web` stays at **0** TypeScript errors and the bundle builds. Test
shape **47 files / 360 tests** = **40 `ui` files (293 tests) + 7 `live` files (67 tests)**, from 44 /
310 (38 + 6 / 64). `@cafe/shared` **7 files / 85 tests** (was 73: new `config.test.ts`, rewritten
`validation.test.ts`); `@cafe/server` **439**, unchanged and green.

*Customer half*
- **C1 `Register`.** Name and email are required: no `optional` markers, no device-only caveat. It
  no longer calls `identity.set` — `POST /customers` binds the device. `409 email_in_use` is its own
  `ApiError` kind (`{ kind: 'email_in_use' }`): the email field says "This email already has a
  card." and offers "Get my card back", which navigates to `/lost` with the email in react-router
  location state (not the URL); editing the email clears the offer. `400 invalid_details` flags both
  fields (the server does not say which). Other failures keep the generic error (UI-4). Shared
  `validateRegistration` requires a non-blank name and a valid email; `isTokenOnly`, `isRecoverable`
  and `CustomerService.canRecover` are deleted. `routes/customers.ts` changed by a comment only.
- **C2 `LostCard`.** Two steps. Email step (prefilled from location state; "Send me a code"), then
  the code step: "If <email> is on a card, we've sent it a 6-character code… expires in 15
  minutes" (the 15 is a local constant mirroring the server's `RECOVERY_EXPIRY_MINUTES`). The code
  field is `one-time-code` and upper-cased as typed; "Restore my card" calls `RecoveryService.consume`
  and, on a token, navigates to the card (the server already bound the device); `null` shows "That
  code didn't work. Check it, or send a new one." — no attempt count or lockout hint. Also "Send a
  new code" and "Use a different email". All "link" copy and the "No email on your card?" banner are
  gone. The rate-limit countdown is UI-4's.
- **C4 `PrivacyNotice`.** We collect name and email, both needed, nothing else; the name greets you
  and lets staff find your card, the email carries recovery codes and reward notices. The
  "optional / stay anonymous" line and the Wallet bullet are gone; the rights text mentions
  self-delete from the card menu.
- **C5 + C6 `CardMenu`.** One entry, "Delete my card" → red confirmation, 3-second `HoldButton`.
  Copy: erases the card, its cups and rewards, and your name and email; the email is then free to
  start a new card from zero. The remember/remove row, recovery-aware remove copy, remove
  confirmation and "remember on this device?" banner are deleted; props are `{ open, onClose, token }`.
- **C6 identity swap.** New `packages/web/src/adapters/identity/ServerIdentityStore.ts` (`get` →
  `GET /me`, `set` → `PUT /me`, `clear` → `DELETE /me`, over the `ApiClient`), wired in
  `services/Services.ts`. `LocalStorageIdentityStore` and its test are deleted; the `IdentityStore`
  port's doc comment is updated, its signature unchanged. `Card` drops `savedToken` / `owned` and the
  "Viewing X's card…" banner — opening a card link binds the device (`GET
  /customers/by-token/:token`), and `/card` self-resolve falls back to welcome on failure. New tests:
  `tests/adapters/ServerIdentityStore.test.ts` (`ui`, 5) and `tests/live/ServerIdentityStore.test.ts`
  (`live`, 3). `Field`'s `optional` prop is unused by any screen and left on the component.

*Staff/admin half*
- **S2 `Scan`.** A saved commit shows the one-line toast and goes to `/staff` (the counter), not the
  camera. Hold, stage-time `idempotencyKey` and no-undo are unchanged; "Scan next" remains the
  deliberate path to another scan; a failed commit stays on the card with its error.
- **A4 config bounds.** New pure `packages/shared/src/domain/config.ts`: `CONFIG_BOUNDS` (the
  server's former private table, values unchanged), `CONFIG_NUMERIC_FIELDS`,
  `REJECTED_CONFIG_FIELDS` (`sessionEpoch`), `clampConfigValue`, `isWithinBounds`,
  `normalizeRewardDescription` and friends, tested in `packages/shared/tests/config.test.ts`. Server
  `config/clamp.ts` imports it (behaviour identical). `ConfigService.sanitizeConfig` applies the
  same table (detector counts floor at 2, was 1; every field has a ceiling), tested in
  `tests/services/sanitizeConfig.test.ts`. `ProgramEdit` takes `min` / `max` from the table, shows
  "From X to Y.", says "Enter a whole number from X to Y." for out-of-range input and keeps Save
  disabled. **Error path:** `Admin.saveProgram` rethrows; `ProgramEdit` keeps the sheet open with the
  typed value and shows the failure on the editor (offline, server, signed out, forbidden, rate
  limited, `rejected_field`, other `rejected`), no toast. The live `ConfigAndAudit.test.ts` now
  asserts the shared floor of 2 and a ceiling (`pointsPerReward: 1000` → 100).
- **A5.** `pointsPerReward` is labelled "Drinks for a free one"; field "How many drinks earn a free
  one?", hint "Each customer's card shows this many cups, plus the free one."; value "N drinks". No
  new field.
- **A6 `AccountSheet`.** On the signed-in account's own sheet the Active toggle **and** Delete are
  disabled with "You can't disable or delete the account you're signed in with." (delete is guarded
  too, for symmetry with the server's `cannot_delete_self`). Every failure in the sheet shows inside
  it (`role="alert"`), not as a toast; successes still toast. `Toggle` gained an optional `disabled`.
- **X1 `AuthContext`.** At boot, and only when a staff session is persisted, it calls
  `staff.session()` (`GET /auth/session`). Server says signed out → anon, stored copy cleared;
  signed in → active as the server's account, stored copy rewritten (and moved between
  localStorage / sessionStorage per `remembered`); unreachable → keep the persisted session
  (previously a failed boot signed the device out). `ready` flips only after the check. `session.ts`
  `reconcile(session, server: StaffSession | null)` replaces `reconcile(session, serverEpoch)` — **the
  client no longer compares epochs**; the server checks the epoch on every request and answers anon
  for a revoked one. `StaffService.currentSessionEpoch()` is now used only by live tests. New
  `AuthContext.test.tsx` (5).
- **Review follow-ups.** `CardMenu`'s `identity.clear()` after a self-delete is best-effort (it is
  a request now, and failing it after the erase used to report a deletion that worked as one that
  did not). `AuthContext` keeps a sign-in generation, so a boot check still in flight when the user
  signs in or out cannot overwrite what they just did. `Scan` navigates to the counter only while
  still mounted, with `replace` so Back does not reopen a finished scan. `LostCard` says a
  `rate_limited` refusal is a wait and a `staff_device` refusal means "use your own phone" instead
  of blaming the connection (the countdown stays UI-4's). `ProgramEdit`'s range message waits
  600 ms after typing, like Register's email check, so "15" against a floor of 2 does not flash
  an error after the "1". +4 `ui` tests.
- **Left for later phases.** Per-screen error mapping (`describeSaveError` in `ProgramEdit`,
  `describeFailure` in `AccountSheet`) — UI-4 may consolidate. "Reset password" still uses
  `window.prompt` and admin Delete `window.confirm`. A device with a live cookie but nothing
  persisted is not adopted at boot.

### UI-4 — Error and offline states on screen
Row S3 and the screen half of X2. The staff matrix is already written (SCOPE-DECISIONS §2.4): no
card for that code, rewards already spent, over cap, server unreachable **with the staged
transaction preserved**, camera denied, unreadable scan. The customer side needs the same
treatment and has no prior art — it is the one place this pass designs rather than translates.

This phase owns the **local halves** of X2's routing rules (UI-1 built the classifier and the
global ones). A **connectivity** failure is reported again *at the point of action* — the global
banner alone leaves staff unable to tell whether the points landed — and only the Scan screen can
keep the staged transaction for retry. An **action** failure (`email_in_use`, `over_cap`,
`already_spent`, a rate-limited form) shows on the field or control that needs fixing, **never** as
a toast or banner; a `rate_limited` response disables the button and counts `retry-after` down.

**As built (2026-10-04).** `@cafe/web` stays at **0** TypeScript errors and the bundle builds. Test
shape **51 files / 472 tests** = **44 `ui` files (405 tests) + 7 `live` files (67 tests)**, from 47 /
360 (40 / 293 + 7 / 67). `@cafe/shared` (85) and `@cafe/server` (439) untouched and green. Not yet
committed at the time of writing.

*Shared foundation*
- **`ui/common/failure.ts`.** `failureMessage(err, fallback, overrides?)` turns an `ApiError` into one
  sentence: offline and server failures are worded differently; `csrf_failed` / `forbidden_origin`
  say "This page is out of date. Reload it…"; `staff_device` gets till copy; `rate_limited` never
  freezes a figure; a non-`ApiError` gets the fallback. Also `retryAfterOf`, `DEFAULT_WAIT_SEC` (30),
  `isConnectivityFailure`, `isSessionFailure`. `ui/common/useRetryCountdown.ts` gives
  `{ secondsLeft, waiting, start }` and `formatWait` ("45 s" / "2:05") — the disabled-button
  countdown. Tests in `tests/ui/common/failure.test.tsx`.
- **`Refusal`.** `services/errors.ts` gains `Refusal extends Error` and `isRefusal()`. `StaffService`
  throws `Refusal` for its admin-facing sentences, and only a `Refusal`'s `.message` may be shown
  verbatim — an `ApiError`'s or a `TypeError`'s never is.
- **Rules.** Staff and admin surfaces report nothing locally for a **session** failure
  (`ConnectionWatch` routes it). There are **no failure toasts anywhere**; the toasts that remain are
  success confirmations.

*Staff*
- **S3 `Scan`** (the SCOPE-DECISIONS §2.4 matrix). An unreadable QR (token fails `isValidToken`) says
  "Couldn't read that code…", sends no request and keeps the camera on; an invalid typed code is a
  field error ("A card code is 8 letters and numbers, like K39X-Q4T7."). A lookup that throws no
  longer lands on "not registered": it stays scanning, restarts the camera, reports at the point of
  action (reads ignored for 3 s after a failure) and counts down on **Look up** when rate-limited.
  Not-found copy follows the matrix; **Scan again** keeps the typed code. Camera blocked
  (`NotAllowedError` / `SecurityError`) and no camera are distinct messages, both focusing the
  card-code field. Bug fixed: the camera started before the auth guard let its region exist and
  wrongly said "no camera" on reload.
- **Commit failures.** Offline or server failure enters a new **unsent** state that keeps the staged
  transaction **and its `idempotencyKey`**: "Couldn't reach the till system, so this may not have
  saved. Try again — it won't be added twice." **Try again** re-sends the same key with no second
  hold; **Discard** warns that if an earlier try saved, the card already shows it. `rate_limited`
  enters the same state with a counting **Try again**, and staging a new commit is blocked while it
  runs. A refusal (e.g. 403) after an unanswered send carries the same "check the card before adding
  again" notice. `over_cap` re-reads the card to name the real limit ("You tried to add 2 — the limit
  is 1 per scan."); `customer_not_found` has its own copy. A partially refused redemption lands in a
  new **done** state (no navigate, no toast) naming what saved and each reward not redeemed
  (description · short code — already used / not on this card / no longer valid). `firedRef` resets
  only on deliberate actions; Cancel is a no-op while a send is in flight.
- **`Login`.** `LoginResult` gains `retryAfterSec`; Sign in is disabled with a live countdown and the
  sentence "Too many sign-in attempts. Wait for the countdown, then try again." shows only while it
  runs. Thrown failures go through `failureMessage`.
- **`Panel`.** A "your last hour" load failure shows an error and **Try again** instead of the false
  empty state; a failed customer-name lookup shows "a customer" rather than dropping the list.

*Customer — the one place this phase designed rather than translated.* Principle: no dead ends and no
endless skeletons; "Your card is safe" appears only on read paths where it is true.
- **`EntryResolver`.** A failed `identity.get()` no longer sends a remembered phone to `/welcome`:
  "We couldn't check for your card" + **Try again** (+ "Go to the welcome page" for
  non-connectivity failures). New `useEntryResolution()` hook.
- **`Card`.** A first-load failure shows an error state + **Try again**; a thrown `not_found` reaches
  the existing missing state. A refresh failure keeps the last-seen card under a banner (+ Try
  again), connectivity only. **That refresh path has no trigger until UI-5 wires liveness into
  `Card`'s load effect.**
- **`Register`** uses `failureMessage`, counts down on submit when `rate_limited`, and has till copy.
  **`LostCard`** drops its local mapper and keeps **separate countdowns** for send and check (separately
  rate-limited routes). **`CardMenu`** shows a delete failure inside the sheet. **`EnlargedQr`** reports
  a QR-draw failure (it was an unhandled rejection).

*Admin*
- New `_parts/adminFailure.ts` (`adminFailureMessage` / `adminActionMessage`, `string | null` — `null`
  for session failures).
- **`ConfirmSheet` contract change.** It catches a rejected `onConfirm`, shows the failure inside the
  sheet (`role="alert"`) and stays open; new optional `describeError` prop. "Sign out all devices"
  and flag-dismissal failures stay inside their sheets.
- **`Admin`** load: error state + **Try again**, sections hidden until the first success, stale loads
  ignored (sequence counter), "The server is busy just now…" for a rate-limited read. `AlertDetail`
  reports a card-lookup failure or missing card in its row. Add profile no longer leaks "API
  offline". `AccountSheet.describeFailure` and `ProgramEdit.describeSaveError` (no longer exported)
  are rebuilt on the shared mapper.

*Left for later.* `AccountSheet` still uses `window.prompt` (reset password) and `window.confirm`
(delete). **Background (SSE-triggered) failures staying silent is UI-5.** `Card`, `EntryResolver` and
`CardMenu` have no countdown because their routes are not rate-limited.

### UI-5 — Liveness: the SSE subscriber
Rows X6, X7. An `EventSource` on `GET /events`, owned by whatever replaces `PairingContext`, still
exposing a `dataVersion` so `Card` and `Panel` refetch as they already do. Two things the prototype
never had to handle: `reason: 'deleted'` (the card vanished under the customer) and `reason: 'card'`
(the QR on screen is stale). Both need a designed response, not a refetch.

**X7 is Settled: next-load staleness is fine.** Every card load reads the config fresh, so until
this phase a card loads once per visit and after it also refetches on any change event for that
customer — no `program` push scope. Widening to one stays the cheap upgrade if a stale threshold
ever bites. A refetch that fails because an event fired stays **silent** (X2): nobody asked for it.

### UI-6 — Environment, serving, e2e
Row X5 (**Settled 2026-10-03**). Rewrite `packages/web/.env.example` around the variables that
survive — `VITE_API_BASE` (stays; default `/api`, because the domain will change),
`VITE_GOOGLE_PLACE_ID`, and `VITE_BASE` (the build base, defaulting to `/` once the Pages default
goes) — drop the GitHub Pages `base` default from `vite.config.ts`, and point the Puppeteer suite at
the nginx service from the Compose bundle instead of a Pages build. The SPA is served at the root;
a future staff/admin split would be a route-level split under `/staff`, not a Vite `base` subpath.

**⚠ A GitHub Pages–hosted SPA cannot talk to this backend.** The session design needs the SPA and
the API on the same site (`SameSite=Lax` cookies and the same-origin check on mutating requests); an
SPA on `*.github.io` calling an API elsewhere carries no session cookie, and Safari blocks
third-party cookies outright. The deploy target is the nginx bundle, which serves both.

### UI-7 — Camera permission + home-screen install
Row S5, and scope the triage added rather than the backend (SCOPE-DECISIONS §4.1). `manifest.json`,
icons, `apple-mobile-web-app-capable` so the till installs and grants the camera once (iOS 16.4+,
Safari Website Settings as the documented fallback below that); `qr/scan.ts` moves from
`stop()`/`start()` to `pause()`/`resume()` between customers.

### UI-8 — Close the gates
Row X8, and the mechanical definition of finished: `continue-on-error` comes off CI's `web` job,
`profiles: ['web']` comes off the Compose service, and the `web` image joins the `bundle` job.
**`docker compose up` brings up a working system including the SPA.**

### UI-9 — Docs
BACKEND-PLAN's deferred Phase 11 plus this pass's own. `CLAUDE.md` is the big one: its UI section
still describes the Prototype panel, the pairing flow, the wallet button and the two-entry card
menu as live, behind a warning box saying they are going. Once UI-0 lands, that box is load-bearing
for nothing — rewrite the section, including the PIN / Unlock / idle-lock / step-up bullets that S1
and A7 superseded on 2026-10-03. Then README architecture, SPEC §15 rows, and STATUS divergences
(**j**, **p** and **q** are annotated as superseded and retire here).

### Deferred — not dropped
- **Remember-me security hardening.** S1 ships a rudimentary "remember me" that persists a login
  (30 days remembered, 12 hours otherwise). The maintainer wants a hardening round on it later; it
  has no phase yet. Until then, a remembered till is signed in for 30 days with no idle rule.

---

## 4 · Risk notes

- **The port is now editable, and the server depends on it.** `packages/shared/src/ports/` is
  shared. A change made to please a screen can break 439 server tests. Run both suites, every phase.
- **UI-0 deletes a lot at once.** That is the point — it is all **Settled**, and doing it first
  means UI-2 reshapes services without dead callers confusing the picture. But it is the phase most
  likely to take something still wanted: check the register before deleting anything not listed.
- ~~**Don't rebuild on the old shape.**~~ **Resolved in UI-2.** `tests/helpers/freshStore.ts` (and
  `spyMailer.ts`) are deleted, not ported; P6 settled that there is **no fake store**, and the
  service suites now live in `tests/live/` against the real server.
- ~~**The SPA's service tests now need a database.**~~ **Done in UI-2.** The `live` project's
  `globalSetup` fails — never skips — without Postgres (checked: exit 1 with a message), and CI's
  `web` job has a Postgres service and `TEST_DATABASE_URL`. The consequence to remember: `npm test -w
  @cafe/web` is no longer runnable on a laptop with no database; `npx vitest --project ui` is.
- **The `live` suite and the server suite share a database.** Both default to
  `cafe_loyalty_test`, and `globalSetup` drops and recreates its `public` schema. That is safe
  because workspaces run sequentially (`npm test --workspaces`); running the two suites in
  parallel against one database would corrupt both.
- **"Green" is not "works".** 0 errors, every test file loading and a bundle that builds still
  leave a SPA nobody has driven against a real server through a browser — and some screens are
  known not to match the backend yet (the UI-2 as-built's "Still open" list). UI-6's e2e against the
  Compose bundle is the first honest check.
