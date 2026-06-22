# Implementation status

> **Purpose.** A fast, current picture of *what exists and where* for any agent
> picking up this repo. Authoritative requirements remain in
> [`SPEC.md`](SPEC.md); working rules in [`../CLAUDE.md`](../CLAUDE.md).
> **Keep this file current** — see the Scribe role in `CLAUDE.md`.

**Last updated:** 2026-06-22 (device pairing) · **Phase:** v1 prototype — feature-complete against
SPEC §15 (Appendix A implemented) + prototype device-pairing sync layer.

---

## At a glance

- React + TypeScript + Vite SPA, IndexedDB storage, deployed to GitHub Pages.
- Ports & adapters fully in place; composition root is
  [`src/services/Services.ts`](../src/services/Services.ts).
- **176 unit tests** passing (`npm test`); strict typecheck + production build green.
- CI: `.github/workflows/deploy.yml` tests → builds (injecting `VITE_EMAILJS_*`
  and `VITE_TURN_*` secrets) → deploys on push to `main`.
- Four swappable seams: `DataStore`, `Transport`, `Mailer`, `IdentityStore`.
- Prototype device-pairing layer in `src/adapters/sync/` (dropped in production).

## Acceptance criteria (SPEC §15)

| Criterion | State | Where |
|---|---|---|
| Staff/admin login + role gating | ✅ | `services/StaffService.ts`, `ui/auth`, `ui/common/RequireAuth.tsx` |
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
| Staff/admin session never auto-displays customer card (base-URL routing) | ✅ | `ui/customer/CustomerHome.tsx` |
| Add-to-wallet stubbed but visible; Apple = static stub, Google = REST stub | ✅ | `wallet/passStub.ts` |
| Storage behind `DataStore`; Transport behind `Transport`; Email behind `Mailer`; Identity behind `IdentityStore` — swap = no UI/service change | ✅ | `ports/`, `adapters/`, `services/Services.ts` |
| Two-device demo over PeerJS + TURN (real cross-device, not simulated) | ✅ impl; cellular verification = manual live-demo step | `adapters/transport/PeerTransport.ts`, `config/env.ts` |
| Device pairing — staff hosts, customer joins; live DataStore sync across devices | ✅ prototype-only (see divergence e) | `adapters/sync/`, `ui/common/PairingContext.tsx`, `ui/common/PairDevices.tsx` |
| Domain unit-tested; file tree matches SPEC §12 | ✅ | `tests/`, layout matches |
| Adapters/transports/services unit-tested (regression cover) | ✅ | `tests/adapters/*`, `tests/services/*`, `tests/qr/*` |

## What is real vs. stubbed (prototype intentionally)

- **Auth** is mocked: passwords compared as plain strings; seed accounts
  `admin/admin`, `staff/staff`. Production → hashed, server-side.
- **`ApiStore`** is a production skeleton — each method maps to an HTTP call but
  throws in the prototype (no backend). Shows the contract; one-line swap.
- **`ServerTransport`** is a production placeholder — every method throws. The
  prototype uses `PeerTransport` (PeerJS + TURN).
- **Wallet** (`passStub.ts`): Apple Wallet = static `.pkpass` QR-holder, no
  developer account, no live updates; the web page is the iOS status surface.
  Google Wallet = dynamic loyalty pass via REST, stubbed. Real passes need the
  backend. Notes in `wallet/README.md`.
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

`npm test` runs **176 Vitest unit tests** covering every non-UI module:

- **domain/** — `loyalty`, `tokens`, `validation` (pure logic).
- **services/** — `Customer` (incl. `selfRegister`, `provisionFromToken`),
  `Loyalty` (incl. reward-notification path), `Recovery`, `Staff`, `Config`,
  `Audit`, plus the `Services` composition-root wiring.
- **adapters/** — `IndexedDbStore` (schema v2, seed idempotency, lookups, atomic
  redeem, `createRecoveryCode`/`consumeRecoveryCode`, export/import round-trip,
  error paths), `ApiStore` (every method rejects as a stub), `PeerTransport`
  (peerjs mocked), `EmailJsMailer`, `NoopMailer`, `LocalStorageIdentityStore`.
- **adapters/sync/** — sync round-trip via in-memory `FakeLink`
  (`tests/adapters/sync/sync.test.ts`); `PeerJsLink` host/join
  (`tests/adapters/sync/peerJsLink.test.ts`, PeerJS mocked).
- **qr/** (`encode`, `scan` with html5-qrcode mocked), **wallet/** (`passStub`),
  **config/** (`env` flag mapping, `links.ts` URL building).

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
  `VITE_TURN_*`, `baseUrl`, `isEmailConfigured`). Read from there, not `import.meta.env` directly.

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
  (PassKit + APNs). The current `.pkpass` is a static QR-holder only.

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
   to let the staff device act as a temporary server for the customer device's
   `DataStore`. This is the no-backend stand-in for server-mediated state
   coordination. In production the server handles this and the entire sync layer
   (`adapters/sync/`, `PairingProvider`, `/pair` screen) is removed — it is not a
   path toward the production sync architecture.

## Pointers

- Architecture, diagrams, feature table → [`../README.md`](../README.md)
- Full spec → [`SPEC.md`](SPEC.md)
- Agent rules + subagent workflow → [`../CLAUDE.md`](../CLAUDE.md) and
  [`../.claude/agents/`](../.claude/agents/)
