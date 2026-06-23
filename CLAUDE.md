# CLAUDE.md — Café Loyalty

Operating rules for agents working in this repo. Keep this in context; keep it short. Full detail lives in `docs/SPEC.md` — read it before implementing.

**Orientation for a new agent:** read `docs/STATUS.md` first for the *current
state* of the implementation (what exists, where, what's stubbed), `README.md`
for architecture + diagrams, then `docs/SPEC.md` for the authoritative spec. The
concrete subagent definitions live in `.claude/agents/`.

---

## What this is
A single-café digital loyalty system. Staff scan a customer's QR and commit loyalty points; customers collect points and earn rewards. **The system never touches money.** v1 ships as a **functional static prototype** (React SPA, browser storage, GitHub Pages) whose architecture is **true to production**, so going live = swapping adapters, not rewriting.

## Goals
1. Fully working prototype, demoable on a phone.
2. Architecture portable to production with **no UI/service rewrites** (only adapters change).
3. Clean, conventional, well-organized code split by functionality.
4. Minimal, mostly-optional personal data.

## Non-negotiable architecture rules
- **Ports & adapters.** The app codes against interfaces in `ports/`. Storage, transport, email, and identity are **swappable adapters**. UI talks to `services/` only — **never** to adapters or storage directly.
- **`DataStore` is async (returns Promises) everywhere**, even though IndexedDB could be sync. This keeps prototype call sites identical to the future HTTP adapter. Never write synchronous storage access.
- **`Mailer` port** (`ports/Mailer.ts`): prototype uses `EmailJsMailer` (client-side EmailJS); production swaps a server-side provider. `NoopMailer` is the unconfigured fallback.
- **`IdentityStore` port** (`ports/IdentityStore.ts`): prototype uses `LocalStorageIdentityStore` (stores customer token only, no PII); production swaps a server-cookie adapter. Async throughout.
- **`Transport` port** (`ports/Transport.ts`): prototype uses `PeerTransport` (PeerJS + TURN); production swaps `ServerTransport` (server-mediated). See "Prototype transport" below.
- **`WalletProvider` port** (`ports/WalletProvider.ts`): prototype uses `StaticWalletProvider` (pre-generated walletwallet.dev URLs; `pushUpdate` is a no-op); production swaps `ServerWalletProvider` (PassKit + APNs / Google REST). Selected via `VITE_WALLET` env flag (default `static`).
- **Append-only ledger, not a counter+flag.** Balance and "reward available" are **derived** by summing `LoyaltyTransaction`s. Corrections are `reversal` entries — never destructive edits.
- **Identity = random opaque token.** The QR/pass holds a 128-bit random token. **Never** derive it from name/phone. No PII in the QR.
- **PII is optional.** The token is identity; name/email/phone only enable recovery + notifications. Support a fully token-only account.
- **Staff initiates the credit.** Customers can only *display*; only staff commit points/redemptions. This is the anti-fraud anchor.
- **Redemption is atomic** (check balance + write in one step) — no double-spend.
- **Every staff/admin action writes an audit entry.**
- **`domain/` is pure** — no I/O, no React, no browser APIs. It must be unit-testable in isolation.
- **No mocked customer workflows.** Prototype flows mirror production exactly; only the backing adapters differ. No simulated dual-pane, no in-browser bridge standing in for real device interaction.

## Restraints / out of scope (do NOT build)
- No money handling of any kind (prepurchase, gift cards, stored value, payments).
- No gifting / suspended-coffee pool (phase 2, separate spec).
- No marketing automation, no advanced analytics (basic counts only), no native apps, no multi-tenant.
- Don't add dependencies or cleverness the spec didn't call for. Small and boring beats clever — it's what keeps this maintainable.

## Prototype transport
**PeerJS + TURN is the prototype's real cross-device transport** (`adapters/transport/PeerTransport.ts`). There is no single-browser mock; the simulated dual-pane is gone. Selected via `VITE_TRANSPORT=peer` (the default). TURN credentials are build-time-injected demo secrets — throwaway, rotated after demos.

`adapters/transport/ServerTransport.ts` is the **production placeholder** (throws on every call). Swapping it in is the production migration step for the registration seam.

**Prototype-only constraint:** PeerJS + TURN are not production infrastructure. They are kept here because the prototype must run on real devices without a backend. Production is server-mediated.

PeerJS also backs a second, separate channel: **session-scoped device pairing** (`src/adapters/sync/`). Every device defaults to hosting (`PeerJsHost` — one peer, many clients). Scanning another device's pairing QR (shown in the Prototype panel, opened by tapping the logo) makes the scanning device a customer of that till; the till accepts many customers simultaneously. While paired, each customer device's `DataStore` is transparently served by the till over RPC — acting as the prototype stand-in for a production server. Unpairing sends `{ t: 'unpair' }` to all connected peers and each device resumes hosting. In production this layer is dropped entirely; the server coordinates state centrally. The pairing channel is unrelated to the `Transport` port (registration handoff) — they are independent PeerJS connections.

## Stack
- Prototype: React + TypeScript + Vite, react-router (`HashRouter` or 404.html SPA fallback), IndexedDB (`idb`/Dexie), `qrcode` + `html5-qrcode`/`@zxing/browser`, `peerjs` (real dep, not devDep), EmailJS (via `fetch`, no npm dep), Metered TURN relay, Vitest + jsdom (unit/component), `puppeteer` devDep (e2e smoke suite in `e2e/`).
- Production (target): same React frontend; **Node + TypeScript + Express/Fastify + PostgreSQL** backend; flat-rate VPS + Cloudflare. Apple Wallet updates need the backend (PassKit + APNs); Google Wallet via REST. Email via a server-side provider.
- TypeScript throughout. The `src/domain/`, `src/ports/`, `src/adapters/`, and `src/services/` layers match `docs/SPEC.md §12`. The `src/ui/` layout diverges (see STATUS.md divergences g, k) — record any further UI deviations there.

## UI
- **Design system:** `src/ui/theme/` — no monolith. Slices: `tokens.css` (design tokens: forest/sage/blush/cream/terra palette, Fraunces/DM Sans/DM Mono fonts, touch targets), `base.css` (reset, `.screen` shell, utilities, `bg-*` gradients, focus-visible ring, reduced-motion, `.card-hint`), `keyframes.css`. All imported once via `src/ui/theme/index.css` in `main.tsx`. Do not restore the old `theme.css` / `styles.css` monoliths.
- **Shared components:** `src/ui/components/<Name>/` — one folder per component (`Name.tsx` + `Name.css` + `Name.test.tsx`). Components: Logo, Heading, Button (+WalletButton), Field, CupStamps, LoyaltyCard, Qr, Overlay, Toast, PinPad, Slider, Sheet (+MenuRow +RecoveryLine), ContextBanner. No business logic in components.
- **Structure:** `src/ui/app/` — `LogoGestures` (logo tap/long-press handlers; replaces the old Shell), `AuthContext`, `EntryResolver`, `routes.ts`, `session.ts`. `src/ui/screens/<area>/<Screen>/` — folder-per-screen (`Screen.tsx` + `Screen.css` + `Screen.test.tsx`); screen-scoped parts live in `_parts/` beside the screen. `src/ui/common/` — ServicesContext, PairingContext, QrDisplay, QrScanner, PrivacyNotice, PairDevices.
- **`AuthContext`** (`src/ui/app/AuthContext.tsx`) manages the staff/admin session: `loginWithPassword` (first sign-in), `unlock` (PIN re-auth on a remembered idle device), inactivity lock, epoch revocation, and the remembered `lastUsername` for form prefill. Replaces the old `SessionContext`. Guards use `useAuth` inside each screen — no `RequireAuth` wrapper.
- **Navigation:** no home dashboard. Recognized customer → `/card/:token` (hub). Unrecognized → `/welcome`. Signed-in staff → `/staff`; signed-in admin → `/admin` (home is **role-aware** in `EntryResolver`). Entry resolved by `EntryResolver` at `/`. Logo gestures (`LogoGestures`): **tap → home**; long-press (≥600ms) → staff/admin sign-in. The Prototype/developer panel is opened by a **separate hidden top-left trigger** (`DevTrigger`, gated on `isPrototype` — adapter selection, NOT `import.meta.env.PROD`), NOT a logo tap — so the logo is a clean "go home" affordance. Visually-hidden keyboard path to sign-in. **No global "Staff sign-in" subtitle** in the layout.
- **Staff/admin auth:** accounts carry **name + username + password + PIN**. First sign-in on a device is **username/password** (`Login`); "Remember this device" makes it a trusted terminal, after which an idle (>5 min) visit re-auths with the quick **PIN** (`Unlock`) instead of the full form. A non-remembered device prefills the last username. `name` is the display/attribution label (staff panel "on shift", admin activity log); it falls back to `username` when absent.
- **Admin = superset of staff.** An admin can do everything staff can (the counter/scan view at `/staff`, with a "Back to admin panel" link) **and** the admin view at `/admin` (stats, activity, alerts, account management). Both views have a **Sign out** button. The Admin panel lists **accounts** (name · username · type); tapping one opens a shared `Sheet` popover — enable/disable, reset password, reset PIN, **delete**, plus that profile's filtered activity history. These per-profile actions are **not** step-up gated (a signed-in admin may perform them directly); program-config save and "Sign out all devices" still are. **Add profile** creates a staff *or* admin account (name/username/password/PIN/role). Account deletion (`StaffService.remove` → `DataStore.deleteStaff`) refuses to remove the last admin or the signed-in account.
- **Developer (Prototype) panel** (`ProtoPanel`): stripped to exactly three centred controls, in order — **QR**, **Scan to pair**, **Reset**. **Scan to pair** opens an **in-window camera modal** (`QrScanner autoStart`) showing the live feed — it does not navigate away. No demo-card jumping or view-jumping: every prototype card starts at zero; registration just rotates which preset token is handed out.
- **Reward threshold: 8** (`pointsPerReward: 8` in seed) — eight coffees earn the reward. The card **displays a fixed 10-stamp grid** (`CupStamps showcase`): the **first (welcome) and last (FREE) cups are pre-stamped** on the house; the customer fills the **8** cups between them. (Devices seeded on the old default of 10 are migrated to 8 by IndexedDB upgrade v3, so the grid is 10 not 12.) No "Gold" tier badge.
- **Card "⋯" menu** (`CardMenu`): two entries — remember/remove-from-device and delete. Tapping redraws into a red-tinted confirmation. Remove copy is **recovery-aware**: a token-only card warns it'll be lost and gates REMOVE behind a **3-second hold** (`HoldButton`, expanding red fill, selection disabled); a recoverable card explains how to get it back and removes on a single tap. Deletion is always a 3-second hold.
- **Popovers** (`Sheet`, `Overlay`): lock background scroll while open; the `Sheet` is **drag-to-dismiss** (pull the grab handle down) and scrolls its own content when taller than the screen. Tapping outside closes. `MenuRow`s show a label line + an explanation line, both in the app sans font.
- Plain, active-voice, **consistent** labels: "Add points" not "Submit"; the "Redeem" button yields a "Redeemed" confirmation. Name things by what the user controls, not system internals. Errors say what happened and how to fix it.

## Coding standards
- Strict TypeScript; no `any` in domain/ports.
- Unit-test all of `domain/` and the core service logic (Vitest).
- Never log PII (name/email/phone) — not in console, not in errors.
- Keep modules focused and self-descriptive; one job per file.
- Composition root (where adapters are chosen) is the only place that names a concrete adapter.

---

## Subagent workflow (keep context clean and minimal)

Five roles. The point is that each agent holds only what it needs; deep work is delegated so no single context bloats. Concrete, runnable definitions live in `.claude/agents/` — keep them and this summary in sync.

### Orchestrator
- Owns the plan. Reads `SPEC.md`, decomposes work into small, well-scoped tasks, and sequences them (ports → domain → adapters → services → ui → CI).
- Delegates each task; holds only **summaries** of results, not full transcripts.
- Integrates outputs, keeps the plan/checklist current, decides what's next.
- Does not write feature code directly — it coordinates.
- **Closes the loop on docs:** after integrating a change that affects features, architecture, status, or conventions, hands a one-paragraph change summary to the **Scribe**.

### Explorer (read-only recon)
- Answers "where is X / how does Y work / what's the current state / does this already exist."
- Gathers the minimal context a task needs so the implementer doesn't burn budget exploring.
- Produces tight findings (files, signatures, relevant snippets) — no edits.

### Implementer
- Takes one well-scoped task + the explorer's context and writes the code.
- Stays within the task boundary; follows the architecture rules above; writes tests for domain/service work.
- Returns a concise summary of what changed and why — phrased so it can be handed straight to the Scribe (what changed, where, user-visible or architectural impact).

### Reviewer
- Checks implementer output against `SPEC.md` and these rules **before** integration.
- Verifies: ports respected (no UI→adapter calls), `DataStore` stays async, ledger append-only, no PII in QR/logs, dev-transport properly flagged, tests present and passing, file tree honored.
- Also checks that **docs were updated** when the change warranted it (README/STATUS/CLAUDE).
- Returns issues to fix or an approval.

### Scribe (documentation)
- Keeps `README.md`, `docs/STATUS.md`, `CLAUDE.md`, and the `.claude/agents/` definitions accurate as the code changes.
- **Receives a summary of what changed** and figures out *where* and *what* to update — the requester does not need to know the docs layout.
- Updates the SPEC §15 status table, feature list, diagrams, and "what's stubbed" notes; refreshes the `Last updated` line in `STATUS.md`.
- Does not change `docs/SPEC.md` (the authoritative spec); if reality diverges from the spec, it records the divergence in `STATUS.md` and flags it.
- Touches docs only — no feature code.

### Documentation rule (applies to every task)
A change isn't done until the docs reflect it. Any task that adds/removes a feature, alters architecture or a seam, changes conventions, or shifts acceptance-criteria status **must** end with a Scribe pass (or an equivalent doc update). Pure internal refactors with no external effect are exempt.

### Loop
`Orchestrator plans → Explorer gathers context → Implementer builds → Reviewer checks → Scribe updates docs → Orchestrator integrates → next task.`
Keep handoffs as small artifacts (task brief, findings, diff summary, review notes, doc-change summary), not raw history.
