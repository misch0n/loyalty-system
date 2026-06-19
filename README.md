# Café Loyalty — v1 prototype

A digital loyalty system for a single café. Staff scan a customer's QR and commit
points; customers collect points and earn rewards. **The system never handles
money** — it only tracks loyalty state.

This repo is the **v1 functional prototype**: a React SPA with browser storage,
hosted on GitHub Pages. Its architecture is **true to the production design**, so
going live means swapping pluggable adapters — not a rewrite. Full detail in
[`docs/SPEC.md`](docs/SPEC.md); working rules in [`CLAUDE.md`](CLAUDE.md).

> ⚠️ Prototype only. Browser storage is **not** secure storage — do not enter real
> customer data.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # static output in dist/
```

Demo logins: `admin / admin` or `staff / staff`.

## How the demo works

One browser simulates several devices. Use the **Staff / Admin / Customer**
switcher in the header.

- **Staff → Issue card:** start a card; the customer pane (simulated) joins and
  submits optional details + consent; duplicates warn before a second card is
  created; the finished card (QR + stubbed wallet buttons) appears.
- **Staff → Scan:** paste a card code (or use the camera) to add points / redeem /
  reverse a recent entry.
- **Staff → Find customer:** recover by name/email/phone, reissue (rotating the
  token by default), or correct details. Token-only customers can't be recovered.
- **Admin:** manage staff (disable a departed employee), edit program rules, view
  basic stats, export/import a backup, and read the audit log.
- **Customer:** check status by card code, or request data deletion (staff
  confirms).

## Architecture (ports & adapters)

```
ui  →  services  →  domain
        ↑   ↑
     ports (DataStore, Transport)  ←  adapters (IndexedDB / API, LocalBridge / Peer)
```

- `domain/` — pure logic + types (balance, rewards, tokens, validation). No I/O,
  fully unit-tested.
- `ports/` — the seams: `DataStore` (persistence) and `Transport` (registration
  handoff). Both async.
- `adapters/` — `IndexedDbStore` (prototype) / `ApiStore` (production stub);
  `LocalBridgeTransport` (default) / `PeerTransport` (**dev-only**).
- `services/` — orchestrate the domain against the ports. `services/Services.ts`
  is the **composition root** — the only place that names a concrete adapter.
- `ui/` — React screens; talk to services only, never to adapters.

The append-only `LoyaltyTransaction` ledger is the source of truth; balance and
"reward available" are derived. Redemption is atomic (no double-spend);
corrections are reversal entries, never destructive edits. Every staff/admin
action writes an audit entry.

### Dev-only transport

`adapters/transport/dev/PeerTransport.ts` (PeerJS) exists only for live
two-device demos. It is selected **only** when `VITE_DEV_TRANSPORT=peer`, is
lazy-imported, and is never selected in a production build. The default is the
in-browser `LocalBridgeTransport`.

## Going to production

Bounded and mechanical (see SPEC §14): swap `IndexedDbStore → ApiStore` (one line
in the composition root) behind a Node + Express/Fastify + Postgres backend that
honors the same `DataStore` contract; replace the transport seam with the
server-mediated flow; implement the wallet passes; add real hashed-password auth.
No UI/service call sites change.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`: it tests, builds with the
GitHub Pages base path (`/loyalty-system/`), and publishes to Pages. Routing uses
`HashRouter`, so no server rewrites are needed.
