# UI reconciliation register

> **What this is.** On 2026-09-16 the maintainer revoked
> [`BACKEND-PLAN.md`](BACKEND-PLAN.md)'s founding promise (*no UI or service rewrite*). The
> backend is now built the way it needs to be built; **when it is complete the UI is adjusted to
> it, taking the backend as ground truth**, and every place the two disagree is written down here
> for the maintainer to confirm rather than being quietly resolved by whoever noticed it.
>
> **This file is the entire input to the UI pass.** A conflict nobody recorded is a conflict
> nobody confirms — it becomes a surprise in a screen diff months later. Every backend phase from
> 6 onward ends by adding its rows here (BACKEND-PLAN §0, resume step 6).
>
> **It is not a design document.** A row says what the backend does, what the UI does today, and
> the smallest honest description of the gap. It does not design the replacement screen; that is
> the UI pass's job, done with the maintainer's answer in hand.

---

## How to read a row

| Column | Meaning |
|---|---|
| **Backend truth** | What the server actually does, with the file or route that does it. Not a proposal — built and tested. |
| **UI today** | What the prototype does now, and where. |
| **Status** | **Settled** — the triage or a maintainer decision already answers it; the UI pass implements, no confirmation needed. **Confirm** — the backend forced a change nobody has ruled on; the maintainer decides. **Open** — the backend has not decided either, and the UI pass cannot start on it until it does. |

Rows are grouped by the part of the product they land in, because that is how the UI pass will
be sliced — not by which backend phase produced them.

---

## 1 · Customer — registration, card, recovery

| # | Backend truth | UI today | Status |
|---|---|---|---|
| C1 | **Name and email are required**, and one card per address: `POST /customers` rejects a blank name, validates the address, and answers **`409 email_in_use`** so the page can offer recovery instead of a second card (`routes/customers.ts`; SCOPE-DECISIONS §2.1, §3.4). | Registration treats all PII as optional and supports a fully token-only card. Nothing handles `email_in_use`. | **Settled** (triage §2.1) |
| C2 | **Recovery is a typed code, not a link.** `POST /recovery/request` (email) → the page waits → `POST /recovery/consume` (email **+** code) → identity cookie. Six Crockford characters, scoped to the address, five attempts (`routes/recovery.ts`, `recovery/codes.ts`; STATUS divergence **x**). | `/lost` sends a magic link; `/recover/:code` is a route and `recoverPath(code)` a builder. There is no waiting state and no code-entry field. | **Settled** (triage §2.3) |
| C3 | `RecoveryService` **cannot survive as written** — it mints its own code and sends its own mail, which a client may not do, and `redeem(code)` now needs the address alongside the code. | Screens call `services.recovery.request(email)` / `.redeem(code)`. The first keeps its shape; the second gains an argument. | **Confirm** — the service is rewritten against the routes. Worth a look because it is the first *service* the revoked promise lets us reshape. |
| C4 | **The privacy notice's recovery-tier warning cannot happen.** Every card has an address, so "a card with no email can't be recovered" is false. | `PrivacyNotice` still carries it; `CardMenu`'s remove copy is recovery-aware and gates behind a 3-second hold for token-only cards. | **Settled** (triage §2.2, FE-C-15) |
| C5 | **Deletion is a server tombstone**: the row survives with `id`/`createdAt`/`status`, and name, email, token and short code are erased — freeing the address for a fresh card at zero (`softDeleteCustomer`; SCOPE-DECISIONS §3.3, Q3). | `CustomerService.selfDelete(token)` wipes locally. Copy does not say the address becomes reusable. | **Settled** (triage §3.3) |
| C6 | **The device is bound by an HttpOnly cookie**, set by `PUT /me`, by `GET /customers/by-token/:token` and by a completed recovery. Recovery is the **only** un-bind (§3.2). | `CardMenu` has two entries — remember/remove-from-device and delete — and `LocalStorageIdentityStore` holds the token in localStorage. | **Settled** (triage §1 FE-C-13 → one entry, delete) |

## 2 · Staff — counter, scan, sign-in

| # | Backend truth | UI today | Status |
|---|---|---|---|
| S1 | **A PIN no longer identifies anyone.** `POST /auth/unlock` verifies the PIN against the account the session already names; a device with no session cannot PIN in at all (STATUS divergence **p**, §4-B). | `/login` offers PIN sign-in as a first-class path, and `Unlock` assumes the PIN alone resolves to an account. | **Confirm** — a real behaviour loss for staff, not a refactor. Flagged in BACKEND-PLAN §7 as needing the maintainer, and still unanswered. |
| S2 | **After a commit the terminal returns to the counter**, not to the scanner. | The Scan screen auto-advances to the camera after each commit. | **Settled** (triage Q6, FE-S-12) |
| S3 | **Every failure the terminal can detect needs a stated cause and a remediation** — no card for that code, rewards already spent, over cap, server unreachable (staged transaction preserved), camera denied, unreadable scan (SCOPE-DECISIONS §2.4). The routes now return distinguishable refusals for each. | No screen has a network-error path at all; `IndexedDbStore` never failed, so none was needed. | **Settled** in intent (triage §2.4), **Open** in shape — see X2. |
| S4 | **The 3-second pre-commit hold is untouched** and needs nothing from the server; `idempotencyKey` is allocated at stage time and a replayed commit writes no ledger rows, no audit rows and sends no mail. | Same behaviour. | **No conflict** — recorded so the UI pass does not "fix" it. |
| S5 | **Camera permission**: install the till as a home-screen web app (manifest + `apple-mobile-web-app-capable`, iOS 16.4+), then `pause()`/`resume()` between customers instead of `stop()`/`start()`. | `src/qr/scan.ts` calls a full `scanner.stop()`, which releases the device and provokes the re-prompt. No manifest exists. | **Settled** (triage §4.1, Q4) — scope the triage added, not backend-driven |

## 3 · Admin

| # | Backend truth | UI today | Status |
|---|---|---|---|
| A1 | **No cross-account activity endpoint exists.** `GET /audit` replaces the request's actor filter with the session's own at every tier; there is no export route and the database refuses an `audit.export` row (STATUS divergence **r**, §4-F). | The admin **Export activity** sheet, the past-exports list, and `AuditService.exportActivity` / `parseExportRecord` all still exist. | **Settled** (triage §1, BE-A-12) |
| A2 | **No stats surface.** The data is still collected; `GET /stats/active-customers` and the ranged `GET /transactions` exist, but the triage dropped the presentation. | Four stat tiles and the `StatDetail` breakdown popover. | **Settled** (triage §1, FE-A-02/03) |
| A3 | **Alerts come from the server as findings.** `GET /alerts` (admin) runs `domain/alerts.ts` unchanged over a 30-day window; `LoyaltyService.getAlerts`'s five store reads cannot work over HTTP (STATUS divergence **u**). | `getAlerts()` derives alerts in the browser from `listAllTransactions` + two cross-account `listAudit` reads + `listStaff`. | **Confirm** — same category as C3: a service rewritten against a route. Also note detection now reads **30 days**, where the prototype read everything. |
| A4 | **Config is clamped harder server-side**: every numeric field gains a ceiling, `selfDealCount`/`repeatCount` floor at **2**, and `sessionEpoch` is refused outright with `400 rejected_field` — revocation is `POST /auth/logout-all` (STATUS divergence **w**). | `ConfigService.sanitizeConfig` only floors, and Configure drives spinners. | **Settled** — server-side enforcement; the UI needs matching bounds and an error path |
| A5 | **"Number of drinks on card" is the reward threshold itself**; the grid follows as `threshold + 1`. No independent grid size, no new field. | Configure exposes `pointsPerReward` without saying plainly what it controls. | **Settled** (triage Q1) |
| A6 | **Two account guards differ from `StaffService`'s, in opposite directions**: the "last admin" check is unreachable server-side and asserted as an invariant instead, while **disabling your own account is refused** where the prototype allows it (STATUS divergence **v**). | `AccountSheet` guards deletion, not disabling. | **Settled** — the UI needs the disable refusal surfaced |

## 4 · Prototype removal (Phase 6 deletes the adapters; these are the screens left behind)

| # | Backend truth | UI today | Status |
|---|---|---|---|
| P1 | `src/adapters/sync/` is deleted — there is no device pairing, and a server coordinates state centrally. | `ProtoPanel`'s "Scan to pair", `PairDevices`, `PairingContext`, the `/pair` route, `DevTrigger`. | **Settled** — deleted in the UI pass |
| P2 | The `WalletProvider` and `Transport` ports are deleted (triage §1). | The wallet button (`FE-C-09`), `WalletButton`, the `'w'` scan source in the commit payload. | **Settled** (triage §1) — note the ledger and audit still record `source: 'w'`; harmless, but decide whether the enum shrinks |
| P3 | `EmailJsMailer` is gone and the **routes are the only sender** of the welcome and reward-available mails. | `CustomerService` and `LoyaltyService` each take an optional `Mailer`. | **Settled** — the client wires `NoopMailer` or the mailer leaves the services entirely. **Leaving a client mailer in means every customer gets each mail twice.** |
| P4 | There is no `IndexedDbStore` and no GitHub Pages demo. The SPA is served by nginx from the Compose bundle (Phase 8). | `demoSeed`, preset card tokens, `isPrototype`, the `VITE_*` adapter flags, the Pages workflow. | **Settled** (maintainer, 2026-09-16) — and the reason there is **no demoable build** until the UI pass lands |

## 5 · Cross-cutting

| # | Backend truth | UI today | Status |
|---|---|---|---|
| X1 | **Sessions are cookies, and the idle lock is the server's.** `last_seen_at` is touched on every authenticated request; 5 minutes locks a remembered terminal and ends a non-remembered one; a disabled or deleted account loses its sessions at once; the epoch is a counter, not a timestamp (STATUS divergence **q**). | `AuthContext` runs its own inactivity timer and holds the session client-side. | **Settled** — the client timer becomes a UI affordance only; `AuthContext` reconciles against `GET /auth/session` at boot |
| X2 | **Every call can now fail.** There is no store that cannot — offline, 401 `locked`, 403 `csrf_failed`, 429 `rate_limited` with `retry-after`, 409 `email_in_use`. | No screen has a network-error path. | **Open** — the one thing here the backend has *not* decided. SCOPE-DECISIONS §2.4 fixes what staff see; the customer side and the shared mechanism (adapter-level surface vs. per-screen) are undecided. |
| X3 | **CSRF is a double-submit token** in a deliberately script-readable cookie, required on every mutating request, plus a same-origin check. | Nothing reads or sends it. | **Settled** — adapter work, no screen impact |

---

## Changelog

- **2026-09-16** — created when the maintainer revoked the no-UI-rewrite promise and retired the
  prototype. Seeded from STATUS divergences **p–z** and SCOPE-DECISIONS §1–§4, which between them
  already described most of the gap; rows C3, S1, A3 and X2 are the ones genuinely awaiting an
  answer. Nothing here has been confirmed yet.
