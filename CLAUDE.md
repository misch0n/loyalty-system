# CLAUDE.md — Café Loyalty

Operating rules for agents working in this repo. Keep this in context; keep it short. Full detail lives in `docs/SPEC.md` — read it before implementing.

---

## What this is
A single-café digital loyalty system. Staff scan a customer's QR and commit loyalty points; customers collect points and earn rewards. **The system never touches money.** v1 ships as a **functional static prototype** (React SPA, browser storage, GitHub Pages) whose architecture is **true to production**, so going live = swapping adapters, not rewriting.

## Goals
1. Fully working prototype, demoable on a phone.
2. Architecture portable to production with **no UI/service rewrites** (only adapters change).
3. Clean, conventional, well-organized code split by functionality.
4. Minimal, mostly-optional personal data.

## Non-negotiable architecture rules
- **Ports & adapters.** The app codes against interfaces in `ports/`. Storage and cross-device transport are **swappable adapters**. UI talks to `services/` only — **never** to adapters or storage directly.
- **`DataStore` is async (returns Promises) everywhere**, even though IndexedDB could be sync. This keeps prototype call sites identical to the future HTTP adapter. Never write synchronous storage access.
- **Append-only ledger, not a counter+flag.** Balance and "reward available" are **derived** by summing `LoyaltyTransaction`s. Corrections are `reversal` entries — never destructive edits.
- **Identity = random opaque token.** The QR/pass holds a 128-bit random token. **Never** derive it from name/phone. No PII in the QR.
- **PII is optional.** The token is identity; name/email/phone only enable recovery + notifications. Support a fully token-only account.
- **Staff initiates the credit.** Customers can only *display*; only staff commit points/redemptions. This is the anti-fraud anchor.
- **Redemption is atomic** (check balance + write in one step) — no double-spend.
- **Every staff/admin action writes an audit entry.**
- **`domain/` is pure** — no I/O, no React, no browser APIs. It must be unit-testable in isolation.

## Restraints / out of scope (do NOT build)
- No money handling of any kind (prepurchase, gift cards, stored value, payments).
- No gifting / suspended-coffee pool (phase 2, separate spec).
- No marketing automation, no advanced analytics (basic counts only), no native apps, no multi-tenant.
- Don't add dependencies or cleverness the spec didn't call for. Small and boring beats clever — it's what keeps this maintainable.

## Dev-only transport (strict)
`adapters/transport/dev/PeerTransport.ts` (PeerJS) exists **only** for live two-device demos.
- Selected only when `VITE_DEV_TRANSPORT === 'peer'`.
- Prominent header comment: "DEVELOPMENT-ONLY transport stub — not for production."
- **Excluded from / no-op in production builds.** It must be unmistakable in review that this is demo scaffolding. The default transport is the in-browser `LocalBridgeTransport`.

## Stack
- Prototype: React + TypeScript + Vite, react-router (`HashRouter` or 404.html SPA fallback), IndexedDB (`idb`/Dexie), `qrcode` + `html5-qrcode`/`@zxing/browser`, `peerjs`, Vitest.
- Production (target): same React frontend; **Node + TypeScript + Express/Fastify + PostgreSQL** backend; flat-rate VPS + Cloudflare. Apple Wallet updates need the backend (PassKit + APNs); Google Wallet via REST.
- TypeScript throughout. Match the file tree in `docs/SPEC.md §12`.

## UI
- **Functional for v1** — polish is a later pass. Hold a quality floor: responsive to mobile, visible keyboard focus, reduced-motion respected.
- Plain, active-voice, **consistent** labels: "Add points" not "Submit"; the "Redeem" button yields a "Redeemed" confirmation. Name things by what the user controls, not system internals. Errors say what happened and how to fix it. (See frontend-design conventions.)

## Coding standards
- Strict TypeScript; no `any` in domain/ports.
- Unit-test all of `domain/` and the core service logic (Vitest).
- Never log PII (name/email/phone) — not in console, not in errors.
- Keep modules focused and self-descriptive; one job per file.
- Composition root (where adapters are chosen) is the only place that names a concrete adapter.

---

## Subagent workflow (keep context clean and minimal)

Four roles. The point is that each agent holds only what it needs; deep work is delegated so no single context bloats.

### Orchestrator
- Owns the plan. Reads `SPEC.md`, decomposes work into small, well-scoped tasks, and sequences them (ports → domain → adapters → services → ui → CI).
- Delegates each task; holds only **summaries** of results, not full transcripts.
- Integrates outputs, keeps the plan/checklist current, decides what's next.
- Does not write feature code directly — it coordinates.

### Explorer (read-only recon)
- Answers "where is X / how does Y work / what's the current state / does this already exist."
- Gathers the minimal context a task needs so the implementer doesn't burn budget exploring.
- Produces tight findings (files, signatures, relevant snippets) — no edits.

### Implementer
- Takes one well-scoped task + the explorer's context and writes the code.
- Stays within the task boundary; follows the architecture rules above; writes tests for domain/service work.
- Returns a concise summary of what changed and why.

### Reviewer
- Checks implementer output against `SPEC.md` and these rules **before** integration.
- Verifies: ports respected (no UI→adapter calls), `DataStore` stays async, ledger append-only, no PII in QR/logs, dev-transport properly flagged, tests present and passing, file tree honored.
- Returns issues to fix or an approval.

### Loop
`Orchestrator plans → Explorer gathers context → Implementer builds → Reviewer checks → Orchestrator integrates → next task.`
Keep handoffs as small artifacts (task brief, findings, diff summary, review notes), not raw history.
