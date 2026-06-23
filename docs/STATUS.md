# Implementation status

> **Purpose.** A fast, current picture of *what exists and where* for any agent
> picking up this repo. Authoritative requirements remain in
> [`SPEC.md`](SPEC.md); working rules in [`../CLAUDE.md`](../CLAUDE.md).
> **Keep this file current** — see the Scribe role in `CLAUDE.md`.

**Last updated:** 2026-06-23 (Appendix B: wallet rework, card-URL QR, recovery tiers, device persistence, review prompt, footer, family sharing) · **Phase:** v1 prototype — feature-complete against
SPEC §15 (Appendix A implemented) + Appendix B partially implemented (B1–B4, B6 partial, B7 documented; B5 dropped, B6 remainder deferred).

---

## At a glance

- React + TypeScript + Vite SPA, IndexedDB storage, deployed to GitHub Pages.
- Ports & adapters fully in place; composition root is
  [`src/services/Services.ts`](../src/services/Services.ts).
- **179 unit tests** passing (`npm test`); strict typecheck + production build green.
- CI: `.github/workflows/deploy.yml` tests → builds (injecting `VITE_EMAILJS_*`,
  `VITE_TURN_*`, and `VITE_GOOGLE_PLACE_ID` secrets) → deploys on push to `main`.
- Four swappable seams: `DataStore`, `Transport`, `Mailer`, `IdentityStore`.
- Prototype device-pairing layer in `src/adapters/sync/` (dropped in production).

## Acceptance criteria (SPEC §15)

| Criterion | State | Where |
|---|---|---|
| Staff/admin login + role gating | ✅ | `services/StaffService.ts`, `ui/auth/LoginScreen.tsx`, `ui/common/RequireAuth.tsx` — signed-in devices show staff/admin screens; everyone else defaults to customer |
| Self-service registration (primary path); no approval queue | ✅ | `ui/customer/SelfRegister.tsx`, `CustomerService.selfRegister`, `adapters/identity/LocalStorageIdentityStore.ts` |
| Staff-initiated registration over real PeerJS (secondary path); duplicate warning | ✅ | `ui/staff/IssueCard.tsx`, `adapters/transport/PeerTransport.ts` |
| No single-browser / dual-pane simulation | ✅ (LocalBridgeTransport removed) | `adapters/transport/` |
| Optional-PII and token-only registration | ✅ | `services/CustomerService.ts`, `domain/validation.ts` |
| Auto-provision on scan (unknown valid token → token-only card) | ✅ | `CustomerService.provisionFromToken`, `ui/staff/ScanHome` |
| Accrual respects cap; append-only ledger; derived balance | ✅ | `services/LoyaltyService.ts`, `domain/loyalty.ts` |
| Reward-available email on threshold crossing (best-effort) | ✅ | `LoyaltyService.accrue` → `Mailer` |
| Atomic redemption (no double-spend) | ✅ | `adapters/storage/IndexedDbStore.ts` (`redeemReward`) |
| Self-service recovery via single-use expiring link (EmailJS) | ✅ impl; needs live verification | `services/RecoveryService.ts`, `ui/customer/Recover.tsx`, `adapters/email/EmailJsMailer.ts` |
| Staff recovery / reissue; token-only unrecoverable | ✅ | `ui/staff/FindCustomer.tsx`, `CustomerService.reissue` |
| Correction/reversal, logged | ✅ | `LoyaltyService.reverse` |
| Deletion/opt-out (staff-confirmed), clears PII | ✅ | `ui/customer/DeleteData.tsx`, `IndexedDbStore.softDeleteCustomer` |
| Admin: staff CRUD, config, stats, audit viewer | ✅ | `ui/admin/*` |
| Staff/admin session never auto-displays customer card (base-URL routing) | ✅ | `ui/customer/CustomerHome.tsx` — unrecognized device lands directly on `SelfRegister`; recovery is a small link at the end of that form |
| Add-to-wallet visible; OS-detected (Apple / Google); links to walletwallet.dev pre-generated passes | ✅ replaced by B-row below | `wallet/passes.ts`, `ui/customer/WalletButton.tsx` |
| Storage behind `DataStore`; Transport behind `Transport`; Email behind `Mailer`; Identity behind `IdentityStore` — swap = no UI/service change | ✅ | `ports/`, `adapters/`, `services/Services.ts` |
| Two-device demo over PeerJS + TURN (real cross-device, not simulated) | ✅ impl; cellular verification = manual live-demo step | `adapters/transport/PeerTransport.ts`, `config/env.ts` |
| Device pairing — one till hosts many customers; live DataStore sync across all devices | ✅ prototype-only (see divergences e, f) | `adapters/sync/`, `ui/common/PairingContext.tsx`, `ui/common/PairDevices.tsx` — all devices host by default; scanning a till's QR (from Prototype menu) makes the scanning device a customer; first pair routes till → `/staff`, customer → `/`; unpair signals all peers and each resumes hosting |
| Domain unit-tested; file tree matches SPEC §12 | ✅ | `tests/`, layout matches |
| Adapters/transports/services unit-tested (regression cover) | ✅ | `tests/adapters/*`, `tests/services/*`, `tests/qr/*` |
| **B1** Device persistence — remember/forget exactly one card; no auto-save on view; registration toggle (default ON/OFF by saved state); own-card RememberControl; token-only confirm before forget | ✅ | `ui/customer/RememberControl.tsx`, `ui/customer/SelfRegister.tsx`, `ui/customer/Status.tsx`, `ui/customer/CardView.tsx`, `ui/customer/Recover.tsx`, `ui/customer/DeleteData.tsx` |
| **B2** Card QR encodes card-page URL; `tokenFromCardScan()` extracts token; bare tokens still accepted | ✅ | `qr/encode.ts` (`cardPayload`, `tokenFromCardScan`), `ui/staff/ScanHome` |
| **B3** Recovery-tier disclosure at signup (email → self-recovery; name-only → staff best-effort; neither → not recoverable); name optional | ✅ | `ui/customer/SelfRegister.tsx` |
| **B4** Post-first-redemption review prompt; dismissible; once per device (`cafe-loyalty.reviewPrompted`); deep-links Google write-review; no sentiment gating; Place ID via `VITE_GOOGLE_PLACE_ID` | ✅ | `ui/customer/ReviewPrompt.tsx`, `config/env.ts` (`googlePlaceId`) |
| **B5** Own-card photo | ❌ explicitly dropped (out of scope per requester) | — |
| **B6** Footer Maps + Contact link | ✅ partial — Maps link (place-pinned) + placeholder mailto in Layout footer; café details in `config/cafe.ts`. NOT YET built: light/dark mode toggle, hide-login hardening, progressive card animations, menu page (intentionally not built) | `config/cafe.ts`, Layout footer |
| **B7** Family/couples sharing | No feature code needed — expected behaviour. Sharing the card URL/QR shows the card on any device without overwriting the saved card. Balance pools (one ledger, one token). Future changes must not bind a card to exactly one device. | documented only |
| Wallet — OS-detected button, walletwallet.dev pre-generated passes; first three cards get preset tokens (`PROTOcard0000000000001..3`); later cards rotate stably; `CustomerService.nextCardToken()` via `countActiveCustomers()` | ✅ prototype | `wallet/passes.ts`, `ui/customer/WalletButton.tsx`, `services/CustomerService.ts` |

## What is real vs. stubbed (prototype intentionally)

- **Auth** is mocked: passwords compared as plain strings; seed accounts
  `admin/admin`, `staff/staff`. Production → hashed, server-side. Login is
  login-based role gating: a signed-in device shows staff/admin screens;
  everyone else defaults to customer. One shared sign-in page
  (`ui/auth/LoginScreen.tsx`), prefilled `staff`/`staff` with one-tap fills for
  both roles.
- **Prototype tools menu** (`ui/common/PrototypeMenu.tsx`) is a header dropdown
  that contains all demo scaffolding: Pair/Unpair, Reset this device, and a
  staff/admin sign-in shortcut. Replaces the old always-visible device-switcher
  tabs and header pair pill. Prototype-only; has no production analogue.
- **Reset device** (`Services.reset()` → `IndexedDbStore.close()`) closes and
  deletes the `cafe-loyalty` IndexedDB database, clears `cafe-loyalty.customer`
  and `cafe-loyalty.actor` from local/sessionStorage, and reloads. Lets a
  tester rerun a flow from a clean device. Prototype-only.
- **`ApiStore`** is a production skeleton — each method maps to an HTTP call but
  throws in the prototype (no backend). Shows the contract; one-line swap.
- **`ServerTransport`** is a production placeholder — every method throws. The
  prototype uses `PeerTransport` (PeerJS + TURN).
- **Wallet** (`wallet/passes.ts`): `WalletButton` detects the device OS (iOS →
  Apple, else Google) and links to a pre-generated walletwallet.dev pass via
  `walletPassUrl()`. The first three cards on a store get fixed preset tokens
  (`PROTOcard0000000000001..3`) aligned to three real pass serials; later cards
  rotate stably for display only (the pass won't resolve to that card). The button
  appears on the post-register `CardView` and the own-card Status view. Old
  `passStub.ts` removed. Real pass provisioning (PassKit + APNs / Google REST)
  requires the backend — `wallet/passes.ts` is the prototype stand-in.
- **Reward-notification email** is sent via `EmailJsMailer` when a customer has
  an email address. Real delivery depends on the EmailJS template
  (`template_5ic2z7d`) defining the params the app sends: `to_email`, `mail_kind`,
  `recovery_link`, `expiry_minutes`, `subject`, `message`, `reward`, `card_link`.
  No opt-out UI yet (see Known gaps).
- **Recovery email** (single-use link) similarly depends on the same EmailJS
  template. When EmailJS is unconfigured (`NoopMailer`), the code path executes
  but no email is sent — the uniform-response behaviour (no enumeration) is
  preserved either way.
- **Storage** is IndexedDB in the browser — per-device, demo only, not secure
  storage. Cross-device state is reconciled by auto-provision-on-scan (customer
  PII stays on the customer's device; staff see a token-only card until corrected).
  When devices are **paired** (`adapters/sync/`), the customer device reads from
  the staff device's store live; a self-registered card not yet on the staff device
  is auto-provisioned when staff scan it and then becomes visible on the customer
  side immediately.
- **`adapters/sync/` (device pairing)** is PROTOTYPE-ONLY. It uses PeerJS + TURN
  as a stand-in for the production server's coordination role. In production the
  sync layer is removed; the server mediates all state.
- **Build-time secrets** (`VITE_EMAILJS_*`, `VITE_TURN_*`) are baked into the
  static bundle — publicly readable, throwaway, rotate after demos.

## Test coverage

`npm test` runs **179 Vitest unit tests** covering every non-UI module:

- **domain/** — `loyalty`, `tokens`, `validation` (pure logic).
- **services/** — `Customer` (incl. `selfRegister`, `provisionFromToken`,
  `nextCardToken`), `Loyalty` (incl. reward-notification path), `Recovery`,
  `Staff`, `Config`, `Audit`, plus the `Services` composition-root wiring.
- **adapters/** — `IndexedDbStore` (schema v2, seed idempotency, lookups, atomic
  redeem, `createRecoveryCode`/`consumeRecoveryCode`, export/import round-trip,
  error paths), `ApiStore` (every method rejects as a stub), `PeerTransport`
  (peerjs mocked), `EmailJsMailer`, `NoopMailer`, `LocalStorageIdentityStore`.
- **adapters/sync/** — sync round-trip via in-memory `FakeLink`
  (`tests/adapters/sync/sync.test.ts`); `ConnLink` / `joinHost` / `PeerJsHost`
  (`tests/adapters/sync/peerJsLink.test.ts`, PeerJS mocked).
- **qr/** (`encode` — incl. `cardPayload` URL format and `tokenFromCardScan`,
  `scan` with html5-qrcode mocked), **wallet/** (`passes.test.ts` — preset
  tokens, serial lookup, URL construction, OS detection; replaces `passStub` test),
  **config/** (`env` flag mapping incl. `googlePlaceId`, `links.ts` URL building).

The **React `ui/` components are intentionally not unit-tested**: the SPEC's
testing bar is the pure domain + core service logic, and adding a component test
framework would mean new dependencies (CLAUDE.md: don't add deps the spec didn't
call for). UI is verified manually against the acceptance criteria.

## Conventions worth knowing before editing

- `domain/` stays pure (no I/O/React/browser). Unit-test new domain logic.
- All port methods (`DataStore`, `Transport`, `Mailer`, `IdentityStore`) return
  Promises — never add a sync storage or I/O path.
- Ledger is append-only; model corrections as `reversal` entries.
- Never put PII in the QR, logs, or audit `details`.
- Only `services/Services.ts` names concrete adapters.
- New adapter? Implement the full port and wire it solely in the composition root.
- `src/config/links.ts` (`appUrl`) is the single place that builds absolute URLs
  for QR payloads and emailed links. Do not hard-code `window.location` elsewhere.
- `src/config/env.ts` owns all env-var reads (`VITE_TRANSPORT`, `VITE_EMAILJS_*`,
  `VITE_TURN_*`, `VITE_GOOGLE_PLACE_ID`, `baseUrl`, `isEmailConfigured`, `googlePlaceId`). Read from there, not `import.meta.env` directly.
- `src/config/cafe.ts` holds static café public details (name, address, Maps URL, contact email). Use it in UI rather than hard-coding strings.

## Known gaps / not built (by design or deferred)

- No backend, money handling, gifting/suspended-coffee, marketing, advanced
  analytics, native apps, multi-tenant (out of scope — SPEC §2).
- `cardInactivityDays` is configurable but no expiry job runs (prototype).
- Camera scanning needs HTTPS/localhost; a manual code-entry fallback is provided.
- **Reward-notification opt-out** is not yet surfaced in the UI. Email is sent
  whenever the customer has an address on file.
- **Two-device TURN-relayed verification on cellular** is implemented but can only
  be confirmed via a manual live demo — it is not automatable in CI.
- **Apple Wallet live updates** require an Apple developer account and backend
  (PassKit + APNs). The walletwallet.dev passes are prototype-only; production
  wallet passes need the backend.
- **Wallet passes beyond the first three cards** (preset tokens exhausted): the
  `WalletButton` renders and links, but the pass won't resolve to the card. Noted
  in `wallet/passes.ts`.
- **B6 remainder** (light/dark mode toggle, hide-login hardening, progressive card
  animations, menu page) — intentionally deferred or dropped; no menu page by
  design (dropped per requester).
- **B5** (own-card photo) — explicitly out of scope per requester.
- **`cafeContactEmail`** in `config/cafe.ts` is a placeholder; replace with the
  real address before go-live.
- **Recovery after Reset requires pairing.** Self-service recovery resolves
  the customer's card from the store currently active on the device. After a
  Reset, the customer device has a blank local store; recovery will only find
  the card if the device is paired to the till (whose store acts as the server).
  A reset customer device must pair before attempting `/recover`.

## Spec divergences (prototype vs. production)

These are known differences between prototype reality and the production spec.
They are intentional prototype simplifications, not bugs.

a. **Per-device IndexedDB.** Customer PII entered during self-registration lives
   only on the customer's device. When staff scan that token, auto-provision
   creates a token-only card on the staff device. The customer's full record is
   never automatically synced — that is the production backend's job.

b. **EmailJS template variables.** The prototype sends the following variables to
   the EmailJS template: `to_email`, `mail_kind`, `recovery_link`,
   `expiry_minutes`, `subject`, `message`, `reward`, `card_link`. The template
   (e.g. `template_5ic2z7d`) must define these; if it does not, emails send
   successfully but render incorrectly. This is an ops concern, not a code bug.

c. **Build-time secrets in static bundle.** TURN credentials and EmailJS keys are
   baked into the deployed JavaScript. They are throwaway demo credentials, rotated
   after demos. The production architecture moves these to the server.

d. **No server-side session for identity.** `IdentityStore` uses `localStorage`
   in the prototype. Clearing browser storage removes the identity link;
   self-service recovery re-establishes it. Production uses a server-side session
   or cookie.

e. **Device pairing is a prototype-only construct.** `adapters/sync/` uses PeerJS
   to let the till act as a temporary server for many customer devices'
   `DataStore`s simultaneously. `PeerJsLink.ts` now exports `ConnLink` (single
   connection), `joinHost()` (client side), and `PeerJsHost` (one peer, many
   clients; `onClient` / `onCountChange` / `count` / `unpairAll` / `close`). One
   `StoreServer` is created per connected client so change notifications fan out to
   every paired device. `SyncMessage` gained a `{ t: 'unpair' }` variant sent on
   both sides when unpairing; after unpairing each device resumes hosting. This is
   the no-backend stand-in for server-mediated state coordination. In production the
   server handles this and the entire sync layer (`adapters/sync/`, `PairingProvider`,
   `/pair` screen) is removed — it is not a path toward the production sync architecture.

f. **Prototype UX scaffolding (PrototypeMenu, Reset, pairing role, QR-in-menu).**
   The spec does not define demo-management UI. The prototype surfaces it behind a
   "prototype" header dropdown (`src/ui/common/PrototypeMenu.tsx`): opening the menu
   shows this device's pairing QR with a "Scan a code" button beneath. A till also
   shows the live paired-device count and "Unpair all"; a paired customer shows a
   "Paired to the till" label with Unpair + Reset (no QR while joined). `/pair` is
   now scan-only: arriving with a `?host=` parameter auto-joins without user
   interaction; `QrScanner` receives `allowManual={false}`. Pairing role (till vs.
   customer) is determined by which device scans — no explicit role selector or login
   required. The `PairingProvider` now lives inside the Router (`main.tsx`) so it
   can drive navigation. All of this is prototype scaffolding with no production
   equivalent.

## Pointers

- Architecture, diagrams, feature table → [`../README.md`](../README.md)
- Full spec → [`SPEC.md`](SPEC.md)
- Agent rules + subagent workflow → [`../CLAUDE.md`](../CLAUDE.md) and
  [`../.claude/agents/`](../.claude/agents/)
