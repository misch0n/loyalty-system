# UI pass — build plan (the SPA, rebuilt against the API)

> **Active initiative.** The backend is complete (all of [`BACKEND-PLAN.md`](BACKEND-PLAN.md)'s
> phases). `@cafe/web` is **deliberately red** — 39 TypeScript errors across 13 files, 9 of 53
> test files failing to load — every one traceable to a Phase 6 deletion. This plan makes it green
> again *against the API*, not against the store that was deleted.
>
> **Input:** [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md) — 27 rows saying what the backend does,
> what the UI does today, and the gap. That register is the specification; this file is the
> sequence. A row is not "done" until its register entry says so.
>
> **Ground truth is the backend.** Where a screen and the server disagree, the server wins and the
> screen changes. That is the 2026-09-16 decision (SCOPE-DECISIONS §6) and it is why this pass
> exists at all.

---

## 0 · HOW TO USE THIS ACROSS SESSIONS (read first)

**Resume protocol for a new session:**
1. Work on branch **`claude/backend-implementation-2kqb08`** (or a `claude/ui-pass-*` branch cut
   from it). Merge `origin/main` first.
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
starts at **39**. Each phase below states what it should read afterwards. A number that does not
drop as predicted means the phase found something the register missed — add a row.

**CI reports the shape of the red on every commit** (`web` job, `continue-on-error`). A **tenth**
failing test file is something this pass broke, not something Phase 6 caused.

---

## 1 · Decisions this pass is blocked on

Four register rows are **Open** or **Confirm** and gate real work. Recommendations given; the
maintainer decides. **UI-1 cannot start until X2 is answered** — everything else can proceed.

| Row | Question | Recommendation |
|---|---|---|
| **X2** | Every call can now fail. Where does the error surface live — one adapter-level mechanism, or per-screen handling? | **Adapter-level.** `ApiStore.request` maps every failure to one typed union (`offline`, `locked`, `csrf_failed`, `rate_limited` + `retry-after`, `email_in_use`, `conflict`, `server`), and screens render from that. Per-screen handling means 20 screens each inventing a retry story. Staff-side copy is already fixed by SCOPE-DECISIONS §2.4. |
| **P7** | `AuditService` can't write. Does it become a no-op the services keep calling, or do the `audit.log` calls leave the services? | **Remove the calls.** The server writes audit from the session; a client-side `audit.log` that does nothing is a line of code that lies. More files touched, but it stops the next reader believing the client audits anything. |
| **P6** | Six service suites and three screen suites don't load. How do the services get tested again? | **A fake in-memory `DataStore`** in `packages/web/tests/helpers/`. It is the obvious answer and the shared conformance suite already defines what a `DataStore` must do, so the fake can be held to it. Do this *inside* UI-2, not before — the services change shape there, and a harness built for today's shape would be rebuilt. |
| **S1** | A PIN no longer identifies anyone — a device with no session can't PIN in. That is a real capability loss for staff. | **Accept it, and change `/login`.** PIN becomes strictly the re-auth on a remembered terminal, never a first-class sign-in path. The alternative (a username field beside the PIN pad) is two fields on a device that was meant to be one-handed. Worth your explicit confirmation because staff will feel it. |

Two more are **Confirm** but do not block — they can be answered when their phase arrives:
**X7** (should a config change push to open cards, or is the next-read staleness fine — I'd widen
it later only if a stale threshold actually bites) and **X5** (what the SPA's environment is, which
UI-6 decides with the nginx serving story in front of it).

---

## 2 · Progress checklist

- [ ] **UI-0** — Delete what is already decided dead → **39 errors becomes ~14**
- [ ] **UI-1** — `ApiStore.request` + the error surface (**blocked on X2**)
- [ ] **UI-2** — Services reshaped to the routes, and their tests rebuilt → **0 errors**
- [ ] **UI-3** — Screens whose behaviour the backend changed
- [ ] **UI-4** — Error and offline states on screen
- [ ] **UI-5** — Liveness: the SSE subscriber replaces `dataVersion`
- [ ] **UI-6** — Environment, serving, e2e
- [ ] **UI-7** — Camera permission + install as a home-screen app
- [ ] **UI-8** — Close the gates (CI + Compose stop excusing the SPA)
- [ ] **UI-9** — Docs (the deferred BACKEND-PLAN Phase 11, plus `CLAUDE.md`)

UI-0 is mechanical and large. UI-2 is the real work. UI-8 is the definition of "finished".

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

**Done when:** `~14` errors remain, all of them in `services/` or `tests/`; the 44 currently-passing
SPA test files still pass; no `grep` hit for `adapters/sync`, `WalletProvider`, `isPrototype`.

### UI-1 — `ApiStore.request` + the error surface
**Blocked on X2.** Rows P8, X3, X2.

Write the one method the whole SPA talks through: `credentials: 'include'`, the CSRF token echoed
from the script-readable cookie, JSON in and out, and **every failure mapped to one typed union** —
network-down, `401 locked`, `403 csrf_failed`, `429 rate_limited` (carrying `retry-after`),
`409 email_in_use`, and an unclassified server error. No screen invents its own.

**Done when:** a test double drives every branch of that union, and `ApiStore` satisfies the shared
conformance suite for the methods the port still has.

### UI-2 — Services reshaped, tests rebuilt  ⟵ the real work
The 14 remaining errors are all here. Rows C3, A3, P6, P7, S1.

- **`RecoveryService`** (C3) → `POST /recovery/request` then `POST /recovery/consume(email, code)`.
  It no longer mints codes or sends mail.
- **`LoyaltyService.getAlerts`** (A3) → `GET /alerts`. Five store reads become one call. Note the
  server detects over **30 days**; the prototype read everything.
- **`AuditService`** (P7) → per the decision above, the `audit.log` calls leave the services.
- **`StaffService`** (S1) → `getStaffByPin` is gone; `passwordHash` becomes `password` (the server
  hashes). `loginWithPin` becomes unlock-only.
- **`CustomerService`** → drop the `Transport` import and `nextCardToken`.
- **`LoyaltyService`** → drop `RedeemResult` / `redeemReward`, the retired path.
- **Test harness** (P6): a fake in-memory `DataStore` in `packages/web/tests/helpers/`, held to the
  shared conformance suite, replacing `freshStore.ts`.

**Done when:** **0 TypeScript errors**, `tsc -b` passes, all 53 SPA test files load, and
`npm run build -w @cafe/web` produces a bundle for the first time since Phase 6.

### UI-3 — Screens whose behaviour the backend changed
All **Settled**; no new decisions. C1 (name + email required, handle `409 email_in_use` by offering
recovery), C2 (recovery becomes request → wait → type code → bound), C4 (drop the recovery-tier
warning), C5 (deletion copy says the address frees up), C6 (card menu: one entry, delete), S2
(after a commit, return to the counter), A4 (config bounds match the server's, with an error path),
A5 (say plainly that the threshold is drinks-per-reward), A6 (surface the refusal to disable your
own account), X1 (`AuthContext` reconciles against `GET /auth/session` at boot; its timer becomes a
UI affordance only).

### UI-4 — Error and offline states on screen
Row S3 and the screen half of X2. The staff matrix is already written (SCOPE-DECISIONS §2.4): no
card for that code, rewards already spent, over cap, server unreachable **with the staged
transaction preserved**, camera denied, unreadable scan. The customer side needs the same
treatment and has no prior art — it is the one place this pass designs rather than translates.

### UI-5 — Liveness: the SSE subscriber
Rows X6, X7. An `EventSource` on `GET /events`, owned by whatever replaces `PairingContext`, still
exposing a `dataVersion` so `Card` and `Panel` refetch as they already do. Two things the prototype
never had to handle: `reason: 'deleted'` (the card vanished under the customer) and `reason: 'card'`
(the QR on screen is stale). Both need a designed response, not a refetch.

### UI-6 — Environment, serving, e2e
Row X5. Rewrite `packages/web/.env.example` around what actually exists (`VITE_API_BASE`, and
whatever else survives scrutiny), drop the GitHub Pages `base` from `vite.config.ts`, and point the
Puppeteer suite at the nginx service from the Compose bundle instead of a Pages build.

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
for nothing — rewrite the section. Then README architecture, SPEC §15 rows, and STATUS divergences.

---

## 4 · Risk notes

- **The port is now editable, and the server depends on it.** `packages/shared/src/ports/` is
  shared. A change made to please a screen can break 442 server tests. Run both suites, every phase.
- **UI-0 deletes a lot at once.** That is the point — it is all **Settled**, and doing it first
  means UI-2 reshapes services without dead callers confusing the picture. But it is the phase most
  likely to take something still wanted: check the register before deleting anything not listed.
- **Don't rebuild on the old shape.** `tests/helpers/freshStore.ts` builds on `IndexedDbStore`.
  Restoring it against a fake is tempting in UI-0 and wrong — the services change shape in UI-2.
- **"Green" is not "works".** 0 errors and 53 loading test files still leaves a SPA nobody has
  driven against a real server. UI-6's e2e against the Compose bundle is the first honest check.
