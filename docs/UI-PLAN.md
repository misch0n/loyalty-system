# UI pass — build plan (the SPA, rebuilt against the API)

> **Active initiative.** The backend is complete (all of [`BACKEND-PLAN.md`](BACKEND-PLAN.md)'s
> phases). `@cafe/web` was **deliberately red** — 39 TypeScript errors across 13 files, and 9 of
> its **47** test files failing to load (this plan first said 53; 47 is the count STATUS has
> carried since Phase 10 moved the domain suites into `@cafe/shared`) — every one traceable to a
> Phase 6 deletion. This plan makes it green again *against the API*, not against the store that
> was deleted. **UI-0 is done: 14 errors and 6 non-loading files remain**, all of them UI-2's.
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
   **tagged** when UI-1b lands (SCOPE-DECISIONS §6.6).
2. Read [`STATUS.md`](STATUS.md), [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md),
   [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md), then this file.
3. Find the first **unchecked** box in §2 — that's the next task.
4. Do **only that phase**. Honour `../CLAUDE.md` *as amended by* SCOPE-DECISIONS §5 and §6 — large
   parts of its UI section describe screens this pass deletes.
5. Before committing: `npm run typecheck --workspaces`, `npm test --workspaces`, and
   `npm run build -w @cafe/web`. **The server suite must stay green** — this pass may reshape
   `packages/web/src/services/` and `packages/shared/src/ports/`, and breaking the server with a
   port edit is the main way this pass can do damage.
6. Tick the box, add any new conflict as a register row, refresh `STATUS.md`, commit + push.

**The error count is the progress bar.** `npm run typecheck -w @cafe/web 2>&1 | grep -c "error TS"`
started at **39**; it reads **14** after UI-0. Each phase below states what it should read
afterwards. A number that does not
drop as predicted means the phase found something the register missed — add a row.

**CI reports the shape of the red on every commit** (`web` job, `continue-on-error`). A failing
test file beyond the ones this plan accounts for — **9 before UI-0, 6 after** — is something this
pass broke, not something Phase 6 caused.

---

## 1 · Decisions (all answered 2026-10-03 — nothing blocks this plan)

Each is a register row with a dated resolution; the register has the detail, this table says only
where the answer lands.

| Row | Answer | Lands in |
|---|---|---|
| **S1** | Shared till; **the PIN and the idle lock are removed entirely**; attribution is the signed-in account; "remember me" persists a login (hardening deferred). | **UI-1b** (server + port), then UI-2 and UI-3 |
| **X2** | One classifier in `ApiStore.request`; session → global, connectivity → both, action → local. | UI-1 (classifier + global), UI-4 (local) |
| **A7** | Admin step-up becomes a plain "Are you sure?" — no credential. The server never enforced it. | UI-3, after UI-1b removes the PIN |
| **P6** | **No fake `DataStore`.** Service tests run against the real server + a test Postgres. | UI-2 |
| **P7** | The `audit.log` calls leave the services. | UI-2 |
| **X7** | Next-load staleness is fine; a `program` push scope stays the cheap upgrade. | UI-5 |
| **X5** | Base `/`, `VITE_API_BASE` stays. A Pages-hosted SPA cannot reach this backend. | UI-6 |

**C3** and **A3** are still marked Confirm in the register — services rewritten against routes —
and ride along in UI-2; neither blocks anything.

---

## 2 · Progress checklist

- [x] **UI-0** — Delete what is already decided dead → **39 errors became 14** ✅ 2026-09-16
- [ ] **UI-1** — `ApiStore.request` + the error surface
- [ ] **UI-1b** — Retire the PIN and the idle lock (server + port) → **tag the branch**
- [ ] **UI-2** — Services reshaped to the routes, and their tests rebuilt → **0 errors**
- [ ] **UI-3** — Screens whose behaviour the backend changed
- [ ] **UI-4** — Error and offline states on screen
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

### UI-2 — Services reshaped, tests rebuilt  ⟵ the real work
The 14 remaining errors are all here (UI-1b may have moved the count). Rows C3, A3, P6, P7, S1.

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

**Done when:** **0 TypeScript errors**, `tsc -b` passes, every SPA test file loads (6 of 44 fail to
load after UI-0) with the service suites passing against a real server, and
`npm run build -w @cafe/web` produces a bundle for the first time since Phase 6.

### UI-3 — Screens whose behaviour the backend changed
All **Settled**; no new decisions. C1 (name + email required, handle `409 email_in_use` by offering
recovery), C2 (recovery becomes request → wait → type code → bound), C4 (drop the recovery-tier
warning), C5 (deletion copy says the address frees up), C6 (card menu: one entry, delete), S2
(after a commit, return to the counter), A4 (config bounds match the server's, with an error path),
A5 (say plainly that the threshold is drinks-per-reward), A6 (surface the refusal to disable your
own account), X1 (`AuthContext` reconciles against `GET /auth/session` at boot; with the idle lock
gone its inactivity timer goes entirely).

**The S1 and A7 screen work (2026-10-03)** — all deletion plus one downgrade, once UI-1b has taken
the server half: the **Unlock screen** and its route, `PinPad`, `AuthContext.unlock`, the
`EntryResolver` branch that sends a locked terminal to `/staff/unlock`, "reset PIN" in the admin
account sheet, and the PIN field on Add profile. **Step-up (A7):** the `StepUp` and `ProgramEdit`
sheets stop calling `useAuth().unlock(pin)`; program-config save and "Sign out all devices" become
a plain "Are you sure?" confirmation, no credential. The server never enforced the old gate.

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
  shared. A change made to please a screen can break 442 server tests. Run both suites, every phase.
- **UI-0 deletes a lot at once.** That is the point — it is all **Settled**, and doing it first
  means UI-2 reshapes services without dead callers confusing the picture. But it is the phase most
  likely to take something still wanted: check the register before deleting anything not listed.
- **Don't rebuild on the old shape.** `tests/helpers/freshStore.ts` builds on `IndexedDbStore`.
  Porting it to a fake store is wrong — the services change shape in UI-2, and P6 settled that
  there is **no fake store**: service tests hit the real server.
- **The SPA's service tests now need a database.** Like the server suite, they must fail rather
  than skip without one, or a green run can mean nothing ran. CI's `web` job will need a Postgres
  and a running server to run them against.
- **"Green" is not "works".** 0 errors and every test file loading still leaves a SPA nobody has
  driven against a real server through a browser. UI-6's e2e against the Compose bundle is the
  first honest check.
