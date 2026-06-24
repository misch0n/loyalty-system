# Implementation status

> **Purpose.** A fast, current picture of *what exists and where* for any agent
> picking up this repo. Authoritative requirements remain in
> [`SPEC.md`](SPEC.md); working rules in [`../CLAUDE.md`](../CLAUDE.md).
> **Keep this file current** — see the Scribe role in `CLAUDE.md`.

**Last updated:** 2026-06-24 (Reset fix + Find-us/QR polish: **Reset now clears the device-visible state (storage + re-resolve) BEFORE the IndexedDB wipe** in `PairingContext.reset()` — Safari can hang `deleteDatabase`, which previously left the recognition token behind on a host/unpaired reset; the data wipe is now best-effort + time-bounded. Added a **prototype storage diagnostic** to `ProtoPanel` (display mode, recognition·localStorage, card-data·IndexedDB count, pairing snapshot) so a tester can reload — esp. iOS home-screen — and see exactly what survived. Find-us map now **loads eagerly** (`loading="eager"`) so a scroll shows it ready; the **Contact us** block is **left-aligned with style-matched line icons** (envelope + Instagram) instead of text labels. The enlarged card QR is now wrapped in a **cream, round-cornered box** (matching the card's QR tile) on the white overlay. Note: iOS home-screen `localStorage` durability is still under investigation (see Known gaps). Prior — Find-us map aesthetic: the embedded map now uses a **roadmap base** (dropped the `t=k` satellite layer in `config/cafe.ts`) **warmed toward the cream/sage palette** with a gentle CSS `filter` on `.findus-map` and a **card-style frame** (sage border + soft forest shadow) — no Google Maps API key (true tile recolouring would need one; the iframe is cross-origin). Prior — Pairing/reset rework: **role-aware, reload-free Reset** + a **reversible pairing overlay**. `IndexedDbStore.reset()` now deletes **and re-opens + re-seeds the DB in place** so the live store stays usable (fixes "create a card fails until a hard refresh"); `PairingContext.reset()` branches — host/unpaired fully wipes (DB + all storage), a paired client clears only its own storage (keeping data on the till) — and both **re-resolve via `navigate('/')`, no page reload**. Pairing is now a push/pop overlay (`ui/common/storageSnapshot.ts`): join **snapshots** the device's storage into one reserved key + starts fresh; unpair (voluntary or host-forced) **restores** it; a leftover snapshot at boot self-heals in `main.tsx`. **No device is auto-routed to staff** on pairing (every joiner → `/welcome`); a client exposes the till's id (`joinedHostId`) so the dev panel shows the **host's QR** (grow the network from any device); a host reset forces unpair + a **"till disconnected" toast** on clients. +8 tests (`storageSnapshot`, `IndexedDbStore.reset`). Prior — Docs-only: recorded the **storage / device-recognition** model and the **prototype→production switch checklist** as known debt — IndexedDB (the DB) vs localStorage (token/session flags) vs cookies (none); no JS-cookie durability win on iOS (only a server-set HttpOnly cookie survives ITP, needs a backend) so localStorage is kept deliberately; the device-pairing layer is host/client (scanner becomes client; one host, many RPC clients) and is wired through `services.sync` + `PairingProvider` + `dataVersion` screen refs + `/pair`, so switching out is not a single adapter swap — decision: leave as-is until server testing. Details in divergence d + Known gaps. Prior — Email + QR polish: the Register email field gets **inline format validation** (`isValidEmail`; submit disabled until valid); registering with an email now sends a best-effort **"card created" welcome email** (new `card-created` `MailKind`; `CustomerService` gained an optional `Mailer`). Café contact is `ckykacafe@gmail.com`; the **Instagram** button links to `ckykacoffeeshop` (universal link opens the app on mobile). The card **QR tile** dropped the in-tile "tap to enlarge" label and is now a compact cream box sized to the QR (centred, small offset); the enlarge/wallet hint stays below the card. Placeholders: name "Your name", email "Your email address" (register + restore). Prior: Find us + dev-scan polish: the **Find us** section (now a shared `FindUs` component on both Welcome and the card page) sits **below the fold** — each page is one full screen with a "scroll for hours & location" hint, then Find us; Find us gained an **embedded map** centred on the café (keyless `output=embed`) with **Get directions** beneath it and an **Instagram** button beside Contact us (`config/cafe.ts` `cafeMapEmbedUrl`/`cafeInstagramUrl`); the dev-panel **Scan to pair** now pairs **in place** without redirecting (`PairingContext.joinAs(id, { redirect: false })`) so the camera modal isn't yanked away on a successful scan. Prior: Card-menu confirmations + fixed 10-stamp card: the card "⋯" menu now redraws into red-tinted **remove/delete confirmations** with recovery-aware copy and a `HoldButton` (3-second hold, expanding red fill, selection disabled) for unrecoverable actions; single-tap remove for recoverable cards. The loyalty card is a **fixed 10-stamp grid** — welcome + 8 purchases + FREE, with the first and last **pre-stamped**; IndexedDB **upgrade v3** migrates devices still on the legacy 10-coffee threshold down to 8. Prior: Admin/loyalty/popover batch: reward threshold default **8** (card still shows a **10-cup showcase** — welcome sticker + 8 earnable + FREE reward cup; "Gold" badge removed); admin is now a **superset of staff** (counter/scan access + admin view, both with **Sign out**); admin **account management** popover per profile — enable/disable, reset password, reset PIN, **delete** (`StaffService.remove`/`DataStore.deleteStaff`), + that profile's activity history, un-gated; **Add profile** makes staff or admin; popovers lock background scroll, are **drag-to-dismiss** + self-scrolling; dev-panel **Scan to pair** opens an in-window camera modal; card-menu rows are two-line; the recognized-customer card page now has the shared **Find us** below-the-fold section; `Toggle` restyled to a themed pill; login username placeholder "staff". Prior: Auth + dev-panel UX revision: staff/admin sign-in is now **username/password first** with the PIN reserved for quick re-auth on a remembered idle device; staff accounts gained a **display name** (name/username/password/PIN) and admins create accounts from the panel; logo **tap → home** is role-aware (admin→/admin) and long-press → sign-in; the Prototype/developer panel moved to a **hidden top-left `DevTrigger`** and was stripped to **QR / Scan to pair / Reset**; register privacy notice is a tappable accented link opening a sheet; centred Welcome logo; "Add to wallet" pop-up-blocker fix. **Follow-ups:** signed-in logo gestures (tap **and** long-press) go to the role home, not the sign-in page — an *active* (even non-remembered) session routes to its panel via `EntryResolver`; bottom **`Sheet`s are drag-to-dismiss** (pull the grab handle down) and scroll tall content; the dev-panel QR sizing fixed (the shared `.qr` class was clamping it to 84px); viewport set to `maximum-scale=1, user-scalable=no` + 16px form inputs so pages never zoom on focus/navigation) · **Phase:** v1 prototype — feature-complete against SPEC §15 (Appendix A implemented) + Appendix B partially implemented (B1–B3, B6 partial via Welcome, B7 documented; B4 and B5 dropped, B6 remainder deferred).

---

## At a glance

- React + TypeScript + Vite SPA, IndexedDB storage, deployed to GitHub Pages.
- Ports & adapters fully in place; composition root is
  [`src/services/Services.ts`](../src/services/Services.ts).
- **352 Vitest unit/component tests** passing (`npm test`); strict typecheck + production build green.
- **Puppeteer e2e suite** (`e2e/`, run with `npm run e2e`) drives the built app in headless Chrome: welcome, register→card, staff PIN, prototype panel, and the reference bug-list regressions (13 checks).
- CI: `.github/workflows/deploy.yml` tests → builds (injecting `VITE_EMAILJS_*`,
  `VITE_TURN_*`, and `VITE_GOOGLE_PLACE_ID` secrets) → deploys on push to `main`.
- Five swappable seams: `DataStore`, `Transport`, `Mailer`, `IdentityStore`, `WalletProvider`.
- Prototype device-pairing layer in `src/adapters/sync/` (dropped in production).
- UI rebuilt to Ckyka reference design: `src/ui/theme/` (token slices), `src/ui/components/<Name>/` (folder-per-component), `src/ui/screens/<area>/<Screen>/` (folder-per-screen), `src/ui/app/` (AuthContext, EntryResolver, routes, LogoGestures), `src/ui/common/` (logic contexts).

## Acceptance criteria (SPEC §15)

| Criterion | State | Where |
|---|---|---|
| Staff/admin login + role gating | ✅ | `services/StaffService.ts`, `ui/app/AuthContext.tsx`, `ui/screens/staff/Login/Login.tsx` — **username/password first** (seed: admin `admin`/`admin`, staff `staff`/`staff`); **PIN** (seed admin `4321`, staff `1234`) is the quick re-auth on a remembered idle device (`ui/screens/staff/Unlock/Unlock.tsx`); role-aware home (admin→`/admin`); staff guard via `useStaffGuard` inside screens |
| Self-service registration (primary path); no approval queue | ✅ | `ui/screens/customer/Register/Register.tsx`, `CustomerService.selfRegister`, `adapters/identity/LocalStorageIdentityStore.ts` |
| Staff-initiated registration over real PeerJS (secondary path); duplicate warning | ✅ | `ui/screens/staff/Scan/Scan.tsx`, `adapters/transport/PeerTransport.ts` |
| No single-browser / dual-pane simulation | ✅ (LocalBridgeTransport removed) | `adapters/transport/` |
| Optional-PII and token-only registration | ✅ | `services/CustomerService.ts`, `domain/validation.ts` |
| Auto-provision on scan (unknown valid token → token-only card) | ✅ | `CustomerService.provisionFromToken`, `ui/screens/staff/ScanWorkflow.tsx` |
| Accrual respects cap; append-only ledger; derived balance | ✅ | `services/LoyaltyService.ts`, `domain/loyalty.ts` |
| Reward-available email on threshold crossing (best-effort) | ✅ | `LoyaltyService.accrue` → `Mailer` |
| Atomic redemption (no double-spend) | ✅ | `adapters/storage/IndexedDbStore.ts` (`redeemReward`) |
| Self-service recovery via single-use expiring link (EmailJS) | ✅ impl; needs live verification | `services/RecoveryService.ts`, `ui/screens/customer/LostCard/LostCard.tsx`, `ui/screens/customer/RecoverConsume/RecoverConsume.tsx`, `adapters/email/EmailJsMailer.ts` |
| Staff recovery / reissue; token-only unrecoverable | ✅ | `ui/screens/staff/Panel/Panel.tsx`, `CustomerService.reissue` |
| Correction/reversal, logged | ✅ | `LoyaltyService.reverse` |
| Deletion/opt-out — customer self-delete from card menu; staff-confirmed also available | ✅ | `CustomerService.selfDelete(token)` ← `ui/screens/customer/CardMenu/CardMenu.tsx`; `IndexedDbStore.softDeleteCustomer` |
| Admin: account CRUD (**Add profile** staff/admin with name/username/password/PIN; per-profile popover = enable/disable, reset password, reset PIN, **delete**, + filtered activity — un-gated) + "Sign out all devices"; config (step-up PIN re-auth on save), stats, audit viewer, alerts; admin is a **superset of staff** (counter/scan access, both views have Sign out) | ✅ | `ui/screens/admin/Admin/Admin.tsx`, `ui/screens/admin/_parts/AccountSheet/`; `StaffService.remove` → `DataStore.deleteStaff`; staff `name` shown in panel + activity |
| Staff/admin session never auto-displays customer card (entry routing) | ✅ | `ui/app/EntryResolver.tsx` — any active staff/admin (trusted or ephemeral)→role panel (admin→`/admin`, staff→`/staff`); trusted+locked→`/staff/unlock`; remembered card→`/card/:token`; else→`/welcome` |
| Inactivity lock (5 min) → PIN re-auth at `/staff/unlock` | ✅ | `ui/app/AuthContext.tsx`, `ui/screens/staff/Unlock/Unlock.tsx`, `StaffService.loginWithPin` |
| Epoch-based "Sign out all devices" revocation | ✅ | `StaffService.revokeAllSessions`, `ProgramConfig.sessionEpoch` |
| Suspicious-activity alerts (velocity, repeat-target, off-hours, etc.) — monitoring only | ✅ | `domain/alerts.ts`, `LoyaltyService.getAlerts()`, `ui/screens/admin/_parts/Alert/Alert.tsx` |
| WalletProvider seam; OS-detected wallet button inside enlarged-QR overlay; links to walletwallet.dev pre-generated passes | ✅ | `ports/WalletProvider.ts`, `adapters/wallet/StaticWalletProvider.ts`, `ui/screens/customer/EnlargedQr/EnlargedQr.tsx`, `wallet/passes.ts` |
| Storage behind `DataStore`; Transport behind `Transport`; Email behind `Mailer`; Identity behind `IdentityStore`; Wallet behind `WalletProvider` — swap = no UI/service change | ✅ | `ports/`, `adapters/`, `services/Services.ts` |
| Two-device demo over PeerJS + TURN (real cross-device, not simulated) | ✅ impl; cellular verification = manual live-demo step | `adapters/transport/PeerTransport.ts`, `config/env.ts` |
| Device pairing — one till hosts many customers; live DataStore sync across all devices | ✅ prototype-only (see divergences e, f) | `adapters/sync/`, `ui/common/PairingContext.tsx`, `ui/common/PairDevices.tsx` — all devices host by default; scanning a till's QR makes the scanning device a customer (**no device is auto-routed to staff** — every joiner lands on `/welcome`); a paired client also exposes the till's id (`joinedHostId`) so it can show the **host's QR** and the network can grow from any device; pairing is a reversible overlay — join **snapshots** the device's storage and starts fresh, unpair (voluntary **or** host-forced, with a "till disconnected" toast) **restores** it; unpair signals all peers and each resumes hosting |
| Domain unit-tested; file tree matches SPEC §12 | ✅ (new UI layout diverges from SPEC §12 — see divergences g, k) | `tests/`, domain + services match |
| Adapters/transports/services unit-tested (regression cover) | ✅ | `tests/adapters/*`, `tests/services/*`, `tests/qr/*`, `tests/domain/alerts.test.ts`, `tests/adapters/wallet/*` |
| Co-located component/screen tests (Vitest, jsdom) | ✅ | `src/ui/components/**/*.test.tsx`, `src/ui/screens/**/*.test.tsx` — included via `vite.config.ts` `test.include` |
| Browser-level end-to-end smoke | ✅ impl (manual) | `e2e/*.e2e.ts` (Puppeteer, headless Chrome) via `npm run e2e` — 13 checks across welcome/card/staff/prototype/regression |
| **B1** Device persistence — remember/forget exactly one card; no auto-save on view; registration toggle | ✅ | `ui/screens/customer/Card/Card.tsx`, `ui/screens/customer/Register/Register.tsx` |
| **B2** Card QR encodes card-page URL; `tokenFromCardScan()` extracts token; bare tokens still accepted | ✅ | `qr/encode.ts` (`cardPayload`, `tokenFromCardScan`), `ui/screens/staff/Scan/Scan.tsx` |
| **B3** Recovery-tier disclosure at signup | ✅ | `ui/screens/customer/Register/Register.tsx` |
| **B4** Post-first-redemption review prompt; dismissible; once per device; deep-links Google write-review; no sentiment gating | ❌ dropped in the Ckyka rebuild (not in the new UI spec); the old `ReviewPrompt` was removed with the old screens — re-add if wanted | was: `ui/customer/ReviewPrompt.tsx` |
| **B5** Own-card photo | ❌ explicitly dropped (out of scope per requester) | — |
| **B6** Footer / Find us | ✅ partial — "Find us" (location/hours) on Welcome screen below the fold; café details in `config/cafe.ts`. Light/dark mode, progressive card animations, menu page intentionally not built. | `ui/screens/customer/Welcome.tsx`, `config/cafe.ts` |
| **B7** Family/couples sharing | No feature code needed — expected behaviour. Sharing the card URL/QR shows the card on any device without overwriting the saved card. Future changes must not bind a card to exactly one device. | documented only |

## What is real vs. stubbed (prototype intentionally)

- **Auth** is mocked: names, PINs and passwords are stored and compared as plain
  strings; seed accounts `admin/admin` (name "Manager") and `staff/staff` (name
  "Sam") with PINs `4321` / `1234`. Production → hashed server-side. Sign-in is
  **username/password first** (`Login`); a remembered ("Remember this device")
  terminal re-auths with the PIN (`Unlock`) after a 5-minute idle lock; a
  non-remembered device prefills the last username. `AuthContext`
  (`ui/app/AuthContext.tsx`) manages the active session: "remember this device"
  flag, idle lock, epoch-based revocation, and the remembered `lastUsername`.
  PIN/password are never logged.
- **Prototype / developer panel** (`ui/screens/proto/ProtoPanel/ProtoPanel.tsx`)
  is opened by a **hidden top-left `DevTrigger`** (`ui/app/DevTrigger.tsx`),
  present on every view — NOT a logo gesture (the logo now only goes home /
  long-press signs in). Gated on `isPrototype` (env.ts) — i.e. the local adapter
  selection, NOT `import.meta.env.PROD`: the deployed GitHub Pages demo is itself a
  production `vite build`, so gating on `PROD` previously hid the panel on the very
  deployment that needs it. **Stripped to three centred controls, in order: QR,
  Scan to pair, Reset.** The old demo-card selector, card-state jumps, view-jump
  buttons and sign-in shortcut were removed — every prototype card starts at zero
  and registration rotates which preset token is handed out. Prototype-only;
  dropped from a real server-backed build.
- **Reset device** is **role-aware and reload-free** (`PairingContext.reset()`).
  A **host / unpaired** device fully wipes: `Services.reset()` →
  `IndexedDbStore.reset()` deletes **and re-opens + re-seeds the DB in place** (the
  live store stays usable — this fixes the old "create a card fails until a hard
  refresh", which was the in-memory store pointing at a just-deleted DB), then all
  `localStorage`/`sessionStorage` is cleared and the app re-resolves via
  `navigate('/')` — no `window.location.reload()`. A **paired client** does a
  **light** reset: it clears only its own storage (preserving the pairing snapshot
  and the live RPC link) so it behaves like a brand-new customer while the till
  keeps all data. A host reset additionally sends an unpair signal to its clients
  (the "server" is gone). Prototype-only.
- **`ApiStore`** is a production skeleton — each method maps to an HTTP call but
  throws in the prototype (no backend). Shows the contract; one-line swap.
- **`ServerTransport`** is a production placeholder — every method throws. The
  prototype uses `PeerTransport` (PeerJS + TURN).
- **`ServerWalletProvider`** is a production placeholder — every method throws.
  The prototype uses `StaticWalletProvider` (`adapters/wallet/StaticWalletProvider.ts`):
  `ensurePass` returns a pre-generated walletwallet.dev URL from `wallet/passes.ts`;
  `pushUpdate` is a no-op (WalletWallet Free tier = static snapshot; web card is
  source of truth). First three cards get preset tokens (`PROTOcard0000000000001..3`)
  aligned to real pass serials; later cards rotate stably for display only. Wallet
  button lives inside `EnlargedQrOverlay`, mobile-only, OS-detected. Selected via
  `VITE_WALLET=static` (default). Real pass provisioning (PassKit + APNs / Google
  REST) requires the backend.
- **Suspicious-activity alerts** (`domain/alerts.ts`): pure monitoring only. No
  automatic blocking or notification is triggered. Alerts surface in Admin → Alerts.
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
  storage. Cross-device state is reconciled by auto-provision-on-scan. When devices
  are **paired** (`adapters/sync/`), the customer device reads from the staff
  device's store live.
- **`adapters/sync/` (device pairing)** is PROTOTYPE-ONLY. It uses PeerJS + TURN
  as a stand-in for the production server's coordination role. In production the
  sync layer is removed; the server mediates all state.
- **Build-time secrets** (`VITE_EMAILJS_*`, `VITE_TURN_*`) are baked into the
  static bundle — publicly readable, throwaway, rotate after demos.

## Test coverage

`npm test` runs **352 Vitest unit/component tests** (includes co-located
`src/ui/**/*.test.tsx` via the extended `test.include` in `vite.config.ts`):

- **domain/** — `loyalty`, `tokens`, `validation` (pure logic), `alerts`
  (velocity, repeat-target, off-hours, outlier-share, earn-then-redeem, oversized
  multi-add against `DEFAULT_THRESHOLDS`).
- **services/** — `Customer` (incl. `selfRegister`, `provisionFromToken`,
  `nextCardToken`, `selfDelete`), `Loyalty` (incl. reward-notification path,
  `getAlerts()`), `Recovery`, `Staff` (incl. `loginWithPin`, `setPin`,
  `revokeAllSessions`), `Config`, `Audit`, plus the `Services` composition-root
  wiring.
- **adapters/** — `IndexedDbStore` (schema v2, seed idempotency, lookups, atomic
  redeem, `createRecoveryCode`/`consumeRecoveryCode`, `getStaffByPin`/`setStaffPin`,
  export/import round-trip, error paths), `ApiStore` (every method rejects as a
  stub), `PeerTransport` (peerjs mocked), `EmailJsMailer`, `NoopMailer`,
  `LocalStorageIdentityStore`.
- **adapters/sync/** — sync round-trip via in-memory `FakeLink`; `ConnLink` /
  `joinHost` / `PeerJsHost` (PeerJS mocked). `IndexedDbStore.reset()` (wipe +
  re-seed in place, store still usable) in `tests/adapters/IndexedDbStore.test.ts`.
- **ui/common/** — `storageSnapshot` (`tests/ui/common/storageSnapshot.test.ts`):
  the pairing push/pop — snapshot-and-clear on join, clear-except-snapshot (light
  reset), restore-on-unpair, full clear, and the unclean-exit boot self-heal.
- **adapters/wallet/** — `StaticWalletProvider` (ensurePass returns URL, pushUpdate
  no-op, OS detection).
- **ui/app/** — `session` (`tests/ui/app/session.test.ts`): the pure session
  decision logic from `AuthContext` — `parseSession` validation, `reconcile`
  (epoch revocation, idle→locked for trusted vs anon for ephemeral), `isIdle`
  boundary. `LogoGestures` (`src/ui/app/LogoGestures.test.tsx`).
- **ui/components/** — co-located tests for each shared component: Logo, Heading,
  Button, Field, CupStamps, Sheet, Qr, Overlay, Toast, PinPad, LoyaltyCard,
  Slider, ContextBanner.
- **ui/screens/** — co-located tests for each screen: Welcome, Register, LostCard,
  RecoverConsume, Card, CardMenu (customer); Login, Unlock, Panel, Scan + TopBar,
  ScanView, CustChip, StateLabel _parts (staff); Admin (admin); ProtoPanel (proto).
- **qr/** (`encode` — incl. `cardPayload` URL format and `tokenFromCardScan`,
  `scan` with html5-qrcode mocked), **wallet/** (`passes.test.ts` — preset
  tokens, serial lookup, URL construction, OS detection),
  **config/** (`env` flag mapping incl. `googlePlaceId`, `walletKind`, `links.ts` URL building).

**End-to-end layer:** `e2e/` (Puppeteer, headless Chrome, `npm run e2e`) drives the
built app — runs against `npm run preview`. Not part of `npm test`; run manually
or in CI as a separate step. Catches regressions at the rendered-DOM level that
unit tests cannot.

## Conventions worth knowing before editing

- `domain/` stays pure (no I/O/React/browser). Unit-test new domain logic.
- All port methods (`DataStore`, `Transport`, `Mailer`, `IdentityStore`,
  `WalletProvider`) return Promises — never add a sync storage or I/O path.
- Ledger is append-only; model corrections as `reversal` entries.
- Never put PII in the QR, logs, or audit `details`. Never log a PIN.
- Only `services/Services.ts` names concrete adapters.
- New adapter? Implement the full port and wire it solely in the composition root.
- `src/config/links.ts` (`appUrl`) is the single place that builds absolute URLs
  for QR payloads and emailed links. Do not hard-code `window.location` elsewhere.
- `src/config/env.ts` owns all env-var reads (`VITE_TRANSPORT`, `VITE_EMAILJS_*`,
  `VITE_TURN_*`, `VITE_GOOGLE_PLACE_ID`, `VITE_WALLET`, `baseUrl`,
  `isEmailConfigured`, `googlePlaceId`, `walletKind`). Read from there, not
  `import.meta.env` directly.
- `src/config/cafe.ts` holds static café public details (name, address, Maps URL,
  contact email). Use it in UI rather than hard-coding strings.
- **UI design system:** `src/ui/theme/` replaces the old monolith `src/ui/theme.css`.
  Slices: `tokens.css` (design tokens — forest/sage/blush/cream/terra palette,
  Fraunces/DM Sans/DM Mono fonts), `base.css` (reset, `.screen` shell, utilities,
  `bg-*` gradients, focus-visible ring, reduced-motion, `card-hint`),
  `keyframes.css`. All imported once via `src/ui/theme/index.css` in `main.tsx`.
  No monolith; no `styles.css`. Tokens always win — import order is handled in
  `index.css`.
- **UI components:** `src/ui/components/<Name>/` — each shared presentational
  component is its own folder (`Name.tsx` + `Name.css` + `Name.test.tsx`). No kit
  barrel export; import directly from the component folder. No business logic in
  components.
- **UI structure:** app-level infra in `src/ui/app/` (AuthContext, EntryResolver,
  routes, `LogoGestures` — the global shell chrome is gone; screens own their
  headers). Screens in `src/ui/screens/<area>/<Screen>/` (folder-per-screen:
  `Screen.tsx` + `Screen.css` + `Screen.test.tsx`); screen-scoped parts live in
  their screen's `_parts/` sub-folder; only truly shared pieces live in
  `src/ui/components/`. Shared prototype/pairing scaffolding in `src/ui/common/`.
- **`AuthContext`** (`src/ui/app/AuthContext.tsx`) manages the staff/admin session:
  trusted vs. ephemeral device, inactivity lock, epoch revocation. Replaces the old
  `SessionContext`. Staff/admin guards use `useAuth` inside each screen — no
  `RequireAuth` wrapper component.
- **Navigation:** no home dashboard for customers. Recognized customer → `/card/:token`
  directly. Unrecognized → `/welcome`. Signed-in staff → `/staff`, admin → `/admin`
  (role-aware home). Entry routing is `EntryResolver` at `/`. Logo gestures handled
  by `LogoGestures` (`src/ui/app/LogoGestures.tsx`): **tap → home**, long-press
  ≥600ms → staff sign-in. The Prototype/developer panel is opened by a separate
  hidden top-left `DevTrigger` (gated on `isPrototype`, not `import.meta.env.PROD`),
  not a logo tap. There is no global "Staff sign-in" subtitle in the shell.
- **Reward threshold is 8** (`pointsPerReward: 8` in `adapters/storage/schema.ts`
  seed) — eight coffees earn the reward. The card still renders a **10-cup
  showcase** (`CupStamps showcase`): a welcome sticker cup, the 8 earnable cups,
  and a FREE reward cup. No "Gold" tier badge.

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
  (PassKit + APNs). The walletwallet.dev passes are prototype-only (`pushUpdate`
  is a no-op); production wallet passes need the backend.
- **Wallet passes beyond the first three cards** (preset tokens exhausted): the
  wallet button renders and links, but the pass won't resolve to the card. Noted
  in `wallet/passes.ts`.
- **"Coffees today" admin stat** is approximated by counting today's accrual audit
  events, not points. A windowed `LoyaltyService` stat is a follow-up.
- **Step-up PIN re-auth** gates program-config save and "Sign out all devices".
  Per-row staff mutations (create/reset-password/set-PIN/toggle-active) are not
  step-up gated — deliberate tuning decision, flagged here for future review.
- **B4 (review prompt)** was dropped in the Ckyka rebuild — the old `ReviewPrompt`
  is gone and the new UI spec doesn't include it. Re-add to the customer card flow
  if the café still wants the post-redemption Google-review nudge.
- **B6 remainder** (light/dark mode toggle, hide-login hardening, progressive card
  animations, menu page) — intentionally deferred or dropped; no menu page by
  design (dropped per requester).
- **B5** (own-card photo) — explicitly out of scope per requester.
- **`cafeContactEmail`** in `config/cafe.ts` is a placeholder; replace with the
  real address before go-live.
- **Prototype→production switch is not a single adapter swap (sync-layer
  coupling).** The `Transport` port (`PeerTransport`↔`ServerTransport`) and the
  raw PeerJS/WebRTC handling (`adapters/sync/PeerJsLink.ts`) are cleanly
  swappable, but the *device-pairing feature* is wired through several layers and
  must be carefully unpicked when going server-backed. **Switch checklist:**
  (1) remove the `adapters/sync/` module; (2) drop `services.sync = { observable,
  switchable }` from the composition root (`services/Services.ts`) — services can
  bind directly to the local/HTTP store; (3) stop mounting `PairingProvider`
  unconditionally in `main.tsx`; (4) remove the `usePairing().dataVersion` refetch
  refs from the Card, staff Panel, and Scan screens (the host's `changed`→
  `dataVersion` signal leaks into screen effect-deps; production wants a generic
  no-op/server-push behind that); (5) remove the `/pair` route. The pairing model
  itself: **host/client, not a mesh** — every device boots hosting, the device
  that *scans* becomes a client of the scanned host (`PairingContext.joinAs`); one
  host serves **many** clients; clients have no local store — every read/write is
  an RPC (`PeerClientStore`) to the host's `StoreServer`, which runs it on the
  host's IndexedDB and pushes `changed` pings. Decision (2026-06-24): the pairing
  *behaviour* was refined (reversible snapshot overlay, role-aware reload-free
  reset, no staff auto-redirect, clients show the host's QR — see divergence e),
  but the **production de-coupling itself is still deferred**; the 5-step checklist
  above stands and is revisited when we begin server testing.
  See divergences e, f for the prototype-only rationale.
- **iOS home-screen `localStorage` durability (under investigation).** On a
  device that "Add to Home Screen"s the app, recognition (the customer token in
  `localStorage`) appears to not survive a reload, while a normal Safari tab keeps
  it. iOS treats the home-screen web app as a separate, more aggressively-purged
  storage context, and `localStorage` writes there are historically unreliable.
  Card *data* lives in IndexedDB, which is generally more durable. A prototype
  **storage diagnostic** in `ProtoPanel` surfaces what survives (recognition vs
  IndexedDB count) to confirm. If IndexedDB is durable there, the fix is to back
  `IdentityStore` with a device-local IndexedDB (woven into the pairing
  snapshot/reset lifecycle); the durable production answer remains the server
  cookie (divergence d).
- **Recovery after Reset requires pairing.** Self-service recovery resolves
  the customer's card from the store currently active on the device. After a
  Reset, the customer device has a blank local store; recovery will only find
  the card if the device is paired to the till (whose store acts as the server).
  A reset customer device must pair before attempting `/lost`.

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
   in the prototype (`adapters/identity/LocalStorageIdentityStore.ts`, key
   `cafe-loyalty.customer`, opaque token only — no PII). Clearing browser storage
   removes the identity link; self-service recovery re-establishes it. Production
   uses a server-side session or cookie.

   *No cookies are used anywhere in the prototype.* Switching prototype
   recognition from `localStorage` to a JS-set cookie (`document.cookie`) would
   **not** improve durability: iOS Safari ITP evicts script-writable storage —
   `localStorage`, IndexedDB, **and** client-set cookies alike — after ~7 idle
   days. Only a **server-set HttpOnly cookie** survives longer, and that needs the
   backend the prototype doesn't have. So `localStorage` is retained deliberately;
   durable iOS recognition is strictly a production (server-cookie) concern, to be
   revisited once we test on a server.

   Recognition recap (all three storage mechanisms): **IndexedDB** (`cafe-loyalty`
   DB) is the actual database — `config`/`staff`/`customers`/`transactions`/
   `audit`/`recoveryCodes`. **localStorage** holds three small flags —
   `cafe-loyalty.customer` (customer token = `IdentityStore`),
   `cafe-loyalty.staffDevice` (trusted staff/admin session), `cafe-loyalty.lastUser`
   (sign-in prefill). **sessionStorage** holds `cafe-loyalty.staffSession`
   (ephemeral, non-remembered staff session). A device is "recognized" by a
   token/session in localStorage that points into IndexedDB records; staff-vs-admin
   role comes from the `StaffAccount` record, not the device.

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

   *Pairing UX (2026-06-24):* pairing is a **reversible, non-destructive overlay**.
   On join, `snapshotAndClear()` (`ui/common/storageSnapshot.ts`) captures the
   device's `localStorage` + `sessionStorage` into one reserved key
   (`cafe-loyalty.__pairSnapshot`) and clears the rest, so a paired device starts
   fresh as a new customer; unpair (voluntary **or** host-forced) calls
   `restoreSnapshot()` to pop it back. A leftover snapshot at boot can only mean an
   unclean exit (a PeerJS link never survives a reload), so `main.tsx` runs
   `restoreSnapshot()` before any provider reads storage to self-heal. **No device
   is auto-routed to staff** on pairing (every joiner → `/welcome`), and a client
   surfaces the till's id (`joinedHostId`) so the dev panel shows the **host's QR**
   — a third device can join by scanning a client's screen and connects straight to
   the host. A host reset forces unpair on its clients (they restore their snapshot
   and see a "till disconnected" toast).

f. **Prototype UX scaffolding (DevTrigger, ProtoPanel, Reset, pairing, QR-in-panel).**
   The spec does not define demo-management UI. The prototype surfaces it in
   `src/ui/screens/proto/ProtoPanel/ProtoPanel.tsx`, opened by a hidden top-left
   `DevTrigger` (`src/ui/app/DevTrigger.tsx`) present on every view (build-flag
   gated, non-production). The panel is stripped to three centred controls — pairing
   QR, Scan to pair, Reset. Long-pressing the logo (≥600ms) goes directly to
   staff/admin sign-in; a plain logo tap goes home. `/pair` is scan-only: arriving
   with a `?host=` parameter auto-joins without user interaction; `QrScanner`
   receives `allowManual={false}`. Pairing role (till vs. customer) is determined by
   which device scans — no explicit role selector or login required. All of this is
   prototype scaffolding with no production equivalent.

g. **UI file layout diverges from SPEC §12.** SPEC §12 specifies
   `src/ui/{customer,staff,admin,auth}/` + `src/ui/common/`. The rebuilt frontend
   (Ckyka reference-UI) uses `src/ui/{theme/,components/<Name>/,screens/<area>/<Screen>/,app/,common/}`.
   The domain, ports, adapters, and services layers are unchanged. The divergence is
   UI-structure-only and does not affect the production swap path. Recorded here;
   `docs/SPEC.md` is not edited.

k. **UI fully reskinned to the Ckyka reference bundle.** The entire `src/ui/`
   presentation was replaced to match an approved pixel reference (12 styled view
   files + donor `theme.css`). Behavior, wiring, and the backend layers are
   unchanged. Removed: old `src/ui/kit/`, old flat `src/ui/screens/` files, old
   `app/Shell`, monolith `src/ui/theme.css`, `src/styles.css`. The "Gold" tier pill
   on the card is intentionally static — v1 has no tiers; it is decorative only.
   Admin program-config edits and PIN changes use browser `prompt()` dialogs (the
   reference design does not include full-sheet edit forms for these fields).
   Demo state-jump in ProtoPanel is limited to preset reseeds; arbitrary point
   manipulation is not surfaced.
   Gesture anchor: the small cup+sunburst mark is present on the card, register,
   and lost-card screens; `LogoGestures` attaches the tap/long-press handlers there.

h. **WalletProvider pushUpdate is a no-op (prototype).** WalletWallet Free tier
   produces a static pass snapshot. `StaticWalletProvider.pushUpdate` does nothing.
   The web card is the source of truth. Production `ServerWalletProvider` replaces
   this with live PassKit + APNs / Google REST updates.

i. **"Coffees today" admin stat is approximate.** Counted by today's accrual audit
   events (1 event = 1 visit), not summed points. A proper windowed `LoyaltyService`
   stat is a follow-up task.

j. **Step-up PIN re-auth scope (tuning).** Step-up gates program-config save and
   "Sign out all devices" revocation. Per-row staff mutations (create/reset-password/
   set-PIN/toggle-active) do not require step-up. Deliberate scope decision — flagged
   here for future tightening if the threat model requires it.

## Pointers

- Architecture, diagrams, feature table → [`../README.md`](../README.md)
- Full spec → [`SPEC.md`](SPEC.md)
- Agent rules + subagent workflow → [`../CLAUDE.md`](../CLAUDE.md) and
  [`../.claude/agents/`](../.claude/agents/)
