# Implementation status

> **Purpose.** A fast, current picture of *what exists and where* for any agent
> picking up this repo. Authoritative requirements remain in
> [`SPEC.md`](SPEC.md); working rules in [`../CLAUDE.md`](../CLAUDE.md).
> **Keep this file current** — see the Scribe role in `CLAUDE.md`.

**Last updated:** 2026-06-19 · **Phase:** v1 prototype — feature-complete against
SPEC §15.

---

## At a glance

- React + TypeScript + Vite SPA, IndexedDB storage, deployed to GitHub Pages.
- Ports & adapters fully in place; composition root is
  [`src/services/Services.ts`](../src/services/Services.ts).
- **139 unit tests** passing (`npm test`); strict typecheck + production build green.
- CI: `.github/workflows/deploy.yml` tests → builds → deploys on push to `main`.

## Acceptance criteria (SPEC §15)

| Criterion | State | Where |
|---|---|---|
| Staff/admin login + role gating | ✅ | `services/StaffService.ts`, `ui/auth`, `ui/common/RequireAuth.tsx` |
| Issue card → registration handoff (bridge + PeerJS) | ✅ | `ui/staff/IssueCard.tsx`, `adapters/transport/*` |
| Optional-PII **and** token-only registration; duplicate warning | ✅ | `services/CustomerService.ts`, `domain/validation.ts` |
| Accrual respects cap; append-only ledger; derived balance | ✅ | `services/LoyaltyService.ts`, `domain/loyalty.ts` |
| Atomic redemption (no double-spend) | ✅ | `adapters/storage/IndexedDbStore.ts` (`redeemReward`) |
| Recovery/search + reissue; token-only unrecoverable | ✅ | `ui/staff/FindCustomer.tsx`, `CustomerService.reissue` |
| Correction/reversal, logged | ✅ | `LoyaltyService.reverse` |
| Deletion/opt-out (staff-confirmed), clears PII | ✅ | `ui/customer/DeleteData.tsx`, `IndexedDbStore.softDeleteCustomer` |
| Admin: staff CRUD, config, stats, audit viewer | ✅ | `ui/admin/*` |
| Add-to-wallet + notifications stubbed but visible | ✅ (wallet stub; notifications noted in-flow) | `wallet/passStub.ts` |
| Storage entirely behind `DataStore`; swap = no UI/service change | ✅ | `ports/DataStore.ts`, `ApiStore.ts` |
| `PeerTransport` clearly dev-only, excluded from prod build | ✅ (verified: 0 refs in bundle) | `adapters/transport/dev/PeerTransport.ts`, `config/env.ts` |
| Domain unit-tested; file tree matches SPEC §12 | ✅ | `tests/`, layout matches |
| Adapters/transports/services unit-tested (regression cover) | ✅ | `tests/adapters/*`, `tests/services/*`, `tests/qr/*` |

## What is real vs. stubbed (prototype intentionally)

- **Auth** is mocked: passwords compared as plain strings; seed accounts
  `admin/admin`, `staff/staff`. Production → hashed, server-side.
- **`ApiStore`** is a production skeleton — each method maps to an HTTP call but
  throws in the prototype (no backend). Shows the contract; one-line swap.
- **Wallet** (`passStub.ts`) simulates "add to wallet"; real passes need the
  backend (PassKit/APNs, Google REST). Notes in `wallet/README.md`.
- **Notifications** (threshold-crossed wallet push / email) are referenced in the
  flow but not sent — they require the backend.
- **Storage** is IndexedDB in the browser — demo only, not secure storage.

## Test coverage

`npm test` runs **139 Vitest unit tests** covering every non-UI module:

- **domain/** — `loyalty`, `tokens`, `validation` (pure logic).
- **services/** — `Customer`, `Loyalty`, `Staff`, `Config`, `Audit`, plus the
  `Services` composition-root wiring.
- **adapters/** — `IndexedDbStore` (seed idempotency, lookups, atomic redeem,
  export/import round-trip, error paths), `ApiStore` (every method rejects as a
  stub), `LocalBridgeTransport`, and the dev-only `PeerTransport` (peerjs mocked).
- **qr/** (`encode`, `scan` with html5-qrcode mocked), **wallet/** (`passStub`),
  **config/** (`env` flag mapping, incl. peer-never-in-prod).

The **React `ui/` components are intentionally not unit-tested**: the SPEC's
testing bar is the pure domain + core service logic, and adding a component test
framework would mean new dependencies (CLAUDE.md: don't add deps the spec didn't
call for). UI is verified manually against the acceptance criteria.

## Conventions worth knowing before editing

- `domain/` stays pure (no I/O/React/browser). Unit-test new domain logic.
- `DataStore` methods return Promises — never add a sync storage path.
- Ledger is append-only; model corrections as `reversal` entries.
- Never put PII in the QR, logs, or audit `details`.
- Only `services/Services.ts` names concrete adapters.
- New adapter? Implement the full port and wire it solely in the composition root.

## Known gaps / not built (by design or deferred)

- No backend, money handling, gifting/suspended-coffee, marketing, advanced
  analytics, native apps, multi-tenant (out of scope — SPEC §2).
- `cardInactivityDays` is configurable but no expiry job runs (prototype).
- Camera scanning needs HTTPS/localhost; a manual code-entry fallback is provided.

## Pointers

- Architecture, diagrams, feature table → [`../README.md`](../README.md)
- Full spec → [`SPEC.md`](SPEC.md)
- Agent rules + subagent workflow → [`../CLAUDE.md`](../CLAUDE.md) and
  [`../.claude/agents/`](../.claude/agents/)
