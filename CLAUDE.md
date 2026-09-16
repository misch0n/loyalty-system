# CLAUDE.md — Café Loyalty

Operating rules for agents working in this repo. Keep this in context; keep it short. Full detail lives in `docs/SPEC.md` — read it before implementing.

**Orientation for a new agent:** read `docs/STATUS.md` first for the *current
state* of the implementation (what exists, where, what's stubbed), `README.md`
for architecture + diagrams, then `docs/SPEC.md` for the authoritative spec. The
concrete subagent definitions live in `.claude/agents/`.

> ### ⚠ ACTIVE INITIATIVE — the UI pass
> **The backend is COMPLETE.** Every [`docs/BACKEND-PLAN.md`](docs/BACKEND-PLAN.md) phase is done —
> Fastify + PostgreSQL + Docker Compose, CI green, 442 server tests, 0 type errors in
> `@cafe/shared` and `@cafe/server`. The architecture sections below now describe what is
> **actually built**; they were rewritten in Phase 11 and no longer need a warning.
>
> **The live initiative is [`docs/UI-PLAN.md`](docs/UI-PLAN.md)** — ten phases making `@cafe/web`
> compile against the API, specified by [`docs/UI-RECONCILIATION.md`](docs/UI-RECONCILIATION.md)
> (27 rows of backend-vs-UI conflict, four of them still needing the maintainer). A fresh session
> picks up the first unchecked box in UI-PLAN §2.
>
> **`@cafe/web` is red on purpose** — **14 TypeScript errors, 6 of 44 test files not loading**
> after UI-0 (it was 39 errors and 9 of 47), every one traceable to a Phase 6 deletion and all of
> them now in `services/` or `tests/helpers/`. Do not chase it outside the UI plan. The gate is the
> server suite until UI-2 lands.
>
> **⚠ The `## UI` section below still describes deleted things.** UI-0 (done, 2026-09-16) deleted
> the **Prototype panel and its `DevTrigger`**, the **pairing flow** (`PairingContext`,
> `PairDevices`, `/pair`), the **wallet button**, the admin **Export activity** workflow and the
> admin **stat tiles** — the bullets below about them are history, not instructions, and the files
> they name are gone. Two of the section's wrong bullets are still live code awaiting **UI-3**: the
> **two-entry card menu** (C6 — becomes one entry, delete) and **auto-advancing to the scanner**
> after a commit (S2 — becomes a return to the counter). UI-9 rewrites the section.
>
> **Scope is [`docs/SCOPE-DECISIONS.md`](docs/SCOPE-DECISIONS.md)** — the 123-feature triage
> (2026-09-02, questions closed 2026-09-15) plus the two 2026-09-16 decisions: the backend leads
> and the UI follows with the backend as ground truth, and the IndexedDB prototype is retired.
> Where it and this file disagree, it wins; §5 lists every rule it overrode.

**Completed initiatives + handoff (read if continuing across cleared-context sessions):**
`docs/REWARDS-PLAN.md` (rewards-as-objects — Appendices C+D + multi-reward) and
`docs/INTEGRITY-PLAN.md` (Appendix E — staff integrity & observability) are the phase-by-phase
build plans for the two reworks; **both are complete**, and each carries its decisions and a
progress checklist. Appendix E **supersedes** the rewards rework's 5-second post-commit undo with
a 3-second pre-commit hold. `docs/COLLAB-NOTES.md` captures the maintainer's preferences, the
assistant's operating conventions, and the iOS/deploy/IndexedDB gotchas.

---

## What this is
A single-café digital loyalty system. Staff scan a customer's QR and commit loyalty points; customers collect points and earn rewards. **The system never touches money.**

**It is now server-backed.** A React SPA talks to a Node + Fastify + PostgreSQL API, shipped as a Docker Compose bundle. The static-prototype era is over: browser storage, device pairing and the GitHub Pages demo were all deleted in Phase 6. The SPA does not currently compile — see the UI pass.

## Goals
1. A working system on real devices: customer phones and a staff till, against a real server.
2. Clean, conventional, well-organized code split by functionality.
3. Minimal personal data — **name and email only**, both required (SCOPE-DECISIONS §2.1), nothing else collected.

> Two original goals are **retired**, not merely amended. *"Fully working prototype, demoable on a phone"* — the prototype is deleted and there is no demoable build until the UI pass lands. *"Architecture portable to production with no UI/service rewrites"* — the maintainer revoked that promise on 2026-09-16; it succeeded at the port boundary and the UI is now being rewritten against the API deliberately.

## Non-negotiable architecture rules
- **Ports & adapters.** The app codes against interfaces in `packages/shared/src/ports/`. UI talks to `services/` only — **never** to adapters or storage directly. **There are three ports, not five:** `DataStore`, `IdentityStore`, `Mailer`. `Transport` and `WalletProvider` were **deleted** (triage §1) along with every adapter behind them.
- **`DataStore` is async (returns Promises) everywhere.** The async-from-day-one rule did its job — the IndexedDB→HTTP swap needed no call-site change at the port boundary. Never write synchronous storage access.
- **`DataStore` is split by trust.** The client-facing port carries only what a browser may call; `TrustedStore` carries what only the server may do (audit writes, recovery codes). A client-writable audit log is not an audit log.
- **`Mailer` port**: `NoopMailer` is the only client adapter — **the routes are the only sender**. Real mail is `packages/server/src/mail/` (SMTP via `nodemailer`; mailpit in dev). `EmailJsMailer` is deleted; it shipped its key in the bundle.
- **`IdentityStore` port**: `LocalStorageIdentityStore` still exists but is **superseded** — the device is bound by a server-set HttpOnly cookie, the only thing that survives iOS tracking prevention. Swapping in the cookie adapter is UI-pass work (register X1, C6).
- **Append-only ledger, not a counter+flag.** Balance and "reward available" are **derived** by summing `LoyaltyTransaction`s. Corrections are `reversal` entries — never destructive edits.
- **Identity = random opaque token.** The QR/pass holds a 128-bit random token. **Never** derive it from name/phone. No PII in the QR.
- **Name and email are REQUIRED** (SCOPE-DECISIONS §2.1), and email is unique per active card. Token-only accounts are gone. The token is still the *identity* — never derived from PII, never carrying it — but a card cannot exist without a contact address, because an unrecoverable card was worse than a private one.
- **Staff initiates the credit.** Customers can only *display*; only staff commit points/redemptions. This is the anti-fraud anchor.
- **Redemption is atomic** (check balance + write in one step) — no double-spend.
- **Every staff/admin action writes an audit entry.**
- **`domain/` is pure** — no I/O, no React, no browser APIs. It must be unit-testable in isolation.
- **No mocked customer workflows.** Every flow runs against the real server. No simulated dual-pane, no in-browser bridge, no fake store standing in for real device interaction — the one deliberate exception is a fake `DataStore` in the SPA's *tests*, held to the shared conformance suite.

## Restraints / out of scope (do NOT build)
- No money handling of any kind (prepurchase, gift cards, stored value, payments).
- No gifting / suspended-coffee pool (phase 2, separate spec).
- No marketing automation, no advanced analytics (basic counts only), no native apps, no multi-tenant.
- Don't add dependencies or cleverness the spec didn't call for. Small and boring beats clever — it's what keeps this maintainable.

## Architecture (server-backed)

The SPA talks to the API over HTTP and nothing else. **`ApiStore` is the only `DataStore`**; there is no local database, no peer-to-peer channel and no device pairing — the server coordinates state centrally, which is what the pairing layer was standing in for.

- **Sessions are cookies.** HttpOnly, `SameSite=Lax`, server-side rows, with the 5-minute idle lock enforced **server-side** (`last_seen_at`), not by a client timer. CSRF is a double-submit token on every mutating request.
- **The actor comes from the session, never the request body.** "Staff initiates the credit" is enforced, not trusted.
- **Liveness is `GET /events`** — a one-way SSE stream carrying a `changed` signal scoped per customer and per till, with subjects derived from the session. It replaces the pairing layer's `dataVersion`.
- **Deleted in Phase 6, do not restore:** `IndexedDbStore`, `adapters/sync/` (PeerJS pairing), `adapters/transport/`, `adapters/wallet/`, `EmailJsMailer`, `demoSeed`, the preset card tokens, the `VITE_TRANSPORT`/`VITE_DATASTORE`/`VITE_WALLET` flags, `isPrototype`, and the GitHub Pages workflow.

Run it with `docker compose up` (`compose.dev.yml` for development, with mailpit). The `web` service sits behind a Compose profile until the SPA compiles again.

## Stack
- **Three-package npm-workspaces monorepo** (root `package.json` `workspaces: ["packages/*"]`; the
  root has no SPA dependencies or `vite`/`vitest` scripts of its own — it delegates via
  `npm run build|test|typecheck --workspaces` and `npm run dev -w @cafe/web`).
  **`@cafe/shared`** (`packages/shared/`) is the pure contract — `domain/` + `ports/` — resolved
  through its own `package.json` `exports` map (not a path alias), checked by a single strict
  compiler. **`@cafe/server`** (`packages/server/`) is the production backend. **`@cafe/web`**
  (`packages/web/`) is the prototype SPA. See `docs/STATUS.md` for phase-by-phase detail.
- SPA (`@cafe/web`): React + TypeScript + Vite, react-router (`HashRouter`), `qrcode` + `html5-qrcode` for the card QR and the till scanner, Vitest + jsdom, `puppeteer` devDep (e2e in `packages/web/e2e/`, still pointed at the deleted Pages build — register X5). **No** IndexedDB, `peerjs`, EmailJS or TURN: all four went in Phase 6.
- Production (target): same React frontend; **Node + TypeScript + Express/Fastify + PostgreSQL** backend; flat-rate VPS + Cloudflare. Apple Wallet updates need the backend (PassKit + APNs); Google Wallet via REST. Email via a server-side provider — **built** (`packages/server/src/mail/`, SMTP via `nodemailer`; mailpit in dev, SES/Brevo/Resend in production, all over one `MAIL_SMTP_URL`), which retires `EmailJsMailer` in the server build. The server runs on plain `node` against emitted `dist/` (`packages/server/tsconfig.build.json`), not `tsx`, outside `dev`.
- TypeScript throughout. The `packages/shared/src/domain/`, `packages/shared/src/ports/`, `packages/web/src/adapters/`, and `packages/web/src/services/` layers match `docs/SPEC.md §12`. The `packages/web/src/ui/` layout diverges (see STATUS.md divergences g, k) — record any further UI deviations there.

## UI
- **Design system:** `packages/web/src/ui/theme/` — no monolith. Slices: `tokens.css` (design tokens: forest/sage/blush/cream/terra palette, Fraunces/DM Sans/DM Mono fonts, touch targets), `base.css` (reset, `.screen` shell, utilities, `bg-*` gradients, focus-visible ring, reduced-motion, `.card-hint`), `keyframes.css`. All imported once via `packages/web/src/ui/theme/index.css` in `main.tsx`. Do not restore the old `theme.css` / `styles.css` monoliths.
- **Shared components:** `packages/web/src/ui/components/<Name>/` — one folder per component (`Name.tsx` + `Name.css` + `Name.test.tsx`). Components: Logo, Heading, Button, Field, CupStamps, LoyaltyCard, Qr, Overlay, Toast, PinPad, Slider, Sheet (+MenuRow +RecoveryLine), ContextBanner. (`WalletButton` went with the wallet seam in UI-0.) No business logic in components.
- **Structure:** `packages/web/src/ui/app/` — `LogoGestures` (logo tap/long-press handlers; replaces the old Shell), `AuthContext`, `EntryResolver`, `routes.ts`, `session.ts`. `packages/web/src/ui/screens/<area>/<Screen>/` — folder-per-screen (`Screen.tsx` + `Screen.css` + `Screen.test.tsx`); screen-scoped parts live in `_parts/` beside the screen. `packages/web/src/ui/common/` — ServicesContext, QrDisplay, QrScanner, PrivacyNotice, usePager. (`PairingContext`, `PairDevices` and `storageSnapshot` went with the pairing layer in UI-0; UI-5 adds whatever owns the SSE connection.)
- **`AuthContext`** (`packages/web/src/ui/app/AuthContext.tsx`) manages the staff/admin session: `loginWithPassword` (first sign-in), `unlock` (PIN re-auth on a remembered idle device), inactivity lock, epoch revocation, and the remembered `lastUsername` for form prefill. Replaces the old `SessionContext`. Guards use `useAuth` inside each screen — no `RequireAuth` wrapper.
- **Navigation:** no home dashboard. Recognized customer → `/card/:token` (hub). Unrecognized → `/welcome`. Signed-in staff → `/staff`; signed-in admin → `/admin` (home is **role-aware** in `EntryResolver`). Entry resolved by `EntryResolver` at `/`. Logo gestures (`LogoGestures`): **tap → home**; long-press (≥600ms) → staff/admin sign-in — the only two gestures, now that UI-0 deleted the hidden `DevTrigger` and the panel behind it. Visually-hidden keyboard path to sign-in. **No global "Staff sign-in" subtitle** in the layout.
- **Staff/admin auth:** accounts carry **name + username + password + PIN**. First sign-in on a device is **username/password** (`Login`); "Remember this device" makes it a trusted terminal, after which an idle (>5 min) visit re-auths with the quick **PIN** (`Unlock`) instead of the full form. A non-remembered device prefills the last username. `name` is the display/attribution label (staff panel "on shift", admin activity log); it falls back to `username` when absent.
- **Admin = superset of staff.** An admin can do everything staff can (the counter/scan view at `/staff`, with a "Back to admin panel" link) **and** the admin view at `/admin` (stats, activity, alerts, account management). Both views have a **Sign out** button. The Admin panel lists **accounts** (name · username · type); tapping one opens a shared `Sheet` popover — enable/disable, reset password, reset PIN, **delete**. (Appendix E removed that profile's activity history from this popover; per-account activity is reachable only via the admin **Export activity** workflow.) These per-profile actions are **not** step-up gated (a signed-in admin may perform them directly); program-config save and "Sign out all devices" still are. **Add profile** creates a staff *or* admin account (name/username/password/PIN/role). Account deletion (`StaffService.remove` → `DataStore.deleteStaff`) refuses to remove the last admin or the signed-in account.
- **Staff counter commits behind a 3-second pre-commit hold** (Appendix E). The Scan screen **stages** a transaction and shows a blocking countdown of exactly what is about to be written (points · redemptions · rewards it will mint, previewed client-side via `mintFold`) with **Cancel** and **Commit now**. Nothing is written until the window elapses; the `idempotencyKey` is allocated at **stage** time so an early commit and the timeout can never double-write; on success the terminal **auto-advances to the scanner**. There is deliberately **no post-commit undo** — `LoyaltyService.reverse` remains the only correction path. Do not reintroduce `undo`/`undoCommit`/`planUndo`.
- **Activity is remembered, not broadcast** (Appendix E). Collection is unchanged — every staff/admin action is still audited — but there are **no ambient activity feeds**. The staff counter shows only the **signed-in actor's own last hour**, capped at 10 rows with no pager or "Load all"; the admin home has no cross-account feed; `StatDetail` is total + chart only; `AccountSheet` carries no per-profile history. Cross-account activity is reachable **only** through the admin **Export activity** sheet: a blank-by-default filter (range · actions · accounts incl. admins), a **required reason**, a downloaded JSON file, and an `audit.export` row recording the export itself. Don't add a browsable activity view back.
- **Exactly two suspicious-activity detectors** (`domain/alerts.ts`): **self-dealing** (same staff credits then redeems the same card within `selfDealWindowSec`, repeated `selfDealCount`+ times) and **repeat-target**. Both are fed attributed data — self-dealing pairs `loyalty.accrue`/`loyalty.redeem` **audit** rows, never the ledger (which no longer carries a `redemption` type). Thresholds live on `ProgramConfig` and are admin-editable in Configure → "Activity alerts". No role exemption; detectors **surface, never block**.
- ~~**Developer (Prototype) panel** (`ProtoPanel`)~~ — **deleted in UI-0**, with `DevTrigger` and the `isPrototype` gate: there is one store, one mail sender and one identity mechanism, so there is nothing left to switch. Historical description: stripped to exactly three centred controls, in order — **QR**, **Scan to pair**, **Reset**. **Scan to pair** opens the camera **inline in the panel** (`QrScanner autoStart`, mirroring the staff scan's in-view camera) — no modal, and pairing uses `joinAs(id, { redirect: false })` so it never navigates away. No demo-card jumping or view-jumping: every prototype card starts at zero; registration just rotates which preset token is handed out.
- **Reward threshold: 9** (`pointsPerReward: 9` in seed) — nine purchases earn the reward. The card **displays a fixed 10-stamp grid** (`CupStamps showcase`): **9 earnable cups plus the FREE reward cup, which is pre-stamped** as the prize. There is **no welcome cup** — the first stamp is earned, not on the house — so a brand-new card shows 1 of 10 lit and "9 more for a free coffee". The counter reflects the displayed cups (`filled + 1` / `total + 1`), not the raw threshold. No "Gold" tier badge.
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
- Verifies: ports respected (no UI→adapter calls), `DataStore` stays async, ledger append-only, no PII in QR/logs/URLs, the actor taken from the session rather than the body, audit written server-side, tests present and passing (**and not skipped** — the server suite fails without a database by design), file tree honored.
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
