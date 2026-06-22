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

## Stack
- Prototype: React + TypeScript + Vite, react-router (`HashRouter` or 404.html SPA fallback), IndexedDB (`idb`/Dexie), `qrcode` + `html5-qrcode`/`@zxing/browser`, `peerjs` (real dep, not devDep), EmailJS (via `fetch`, no npm dep), Metered TURN relay, Vitest.
- Production (target): same React frontend; **Node + TypeScript + Express/Fastify + PostgreSQL** backend; flat-rate VPS + Cloudflare. Apple Wallet updates need the backend (PassKit + APNs); Google Wallet via REST. Email via a server-side provider.
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
