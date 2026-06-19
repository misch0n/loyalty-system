# Café Loyalty — v1 Specification

**Status:** Draft for implementation handover
**Target:** Functional prototype (single-tenant, one café), portable to production
**Audience:** Implementation team / coding agents

---

## 1. Purpose

A digital loyalty system for a single café. Customers collect points/stamps and earn rewards (e.g. a free coffee). The trust anchor is **staff-side**: staff scan a customer's code and commit the loyalty entry, because staff presence confirms a real transaction occurred. The system **never handles money** — it only tracks loyalty state.

This document specifies **v1**. It is built first as a **fully functional static prototype** (hosted on GitHub Pages, browser storage) whose architecture is **true to the production design**, so the move to a real backend is a matter of swapping pluggable adapters, not rewriting.

---

## 2. Goals & Non-Goals

### v1 Goals
- Staff can issue, recover, and reissue customer cards.
- Staff can record loyalty points and redeem rewards, with safeguards.
- An **admin** role can manage staff accounts and configure the program.
- Customers hold a card (QR), can check their status on a web page, and (in production) a wallet pass with push updates.
- A complete, **append-only audit trail** of all staff/admin actions.
- Minimal, mostly-optional personal data.
- Fully working prototype demoable on a phone, with a clean path to production.

### Explicitly Deferred (NOT in v1 — do not build)
- **Gifting / suspended-coffee pool / pass-it-forward** (designed separately; phase 2).
- Any **money handling**: prepurchase, gift cards, stored value, payments. Out of scope by design (regulatory weight).
- Marketing automation (campaigns, SMS/email blasts, birthday flows).
- Advanced analytics/segmentation (basic counts only in v1).
- Native mobile apps.
- Multi-tenant / SaaS.

---

## 3. Roles

| Role | Capabilities |
|---|---|
| **Admin** (owner) | Everything staff can do, plus: create/disable staff accounts, reset staff passwords, set program rules (threshold, reward, caps), view basic stats, view the audit log. |
| **Staff** | Log in; issue a card; recover/search a customer and reissue; record a loyalty point; redeem a reward; correct a recent mistake (logged). |
| **Customer** | Reached via a scanned QR. Complete a one-time registration (optional details + consent); view loyalty status on the web; add a wallet pass (production); request data deletion. No password / no account login — identity is a random token. |

---

## 4. Architecture Overview

### Shape
- **Single Page Application (SPA)**, TypeScript + React.
- **Layered / ports-and-adapters (hexagonal)** so the volatile pieces (storage, cross-device transport, wallet) sit behind interfaces and are swappable.
- **Two pluggable seams** are the whole point of the design:
  1. **`DataStore`** — the persistence interface. Prototype = IndexedDB adapter. Production = HTTP API adapter talking to the Node backend.
  2. **`Transport`** — the cross-device channel used during registration (customer device ↔ staff device). Prototype = in-browser bridge (default) or a **dev-only PeerJS** adapter for true two-device demos. Production = the real server-mediated flow.

### Layers (dependency direction points inward)
```
ui  →  services  →  domain
        ↑   ↑
     ports (DataStore, Transport)  ←  adapters (IndexedDB / API, LocalBridge / Peer)
```
- **`domain/`** — pure business logic and types. No I/O, no React, no browser APIs. Fully unit-testable. (balance calculation, reward-availability, redemption rules, token generation, validation.)
- **`services/`** — application services that orchestrate the domain against the ports.
- **`ports/`** — TypeScript interfaces. The seams.
- **`adapters/`** — concrete implementations of the ports.
- **`ui/`** — React components/screens. Talk only to services, never to adapters directly.

### Critical design rule — async from day one
The `DataStore` interface is **fully async** (returns Promises) even though IndexedDB/localStorage could be synchronous. This guarantees the prototype's call sites are byte-for-byte compatible with the future HTTP adapter, which is inherently async. **Do not** write synchronous storage calls.

---

## 5. Tech Stack

### Confirmed — your React/Node assumption is correct, with specifics:

**Prototype (this repo, GitHub Pages):**
- React + **TypeScript**
- **Vite** (build/dev server; static output for GitHub Pages)
- **react-router** (use `HashRouter` OR the 404.html SPA fallback — see §14)
- IndexedDB via **`idb`** or **Dexie** (storage adapter)
- **`qrcode`** (QR generation), **`html5-qrcode`** or **`@zxing/browser`** (camera scanning)
- **`peerjs`** (dev-only transport adapter)
- **Vitest** (unit tests)
- Styling: functional only for v1 — Tailwind or plain CSS modules. (See §12.)

**Production (final stack):**
- **Frontend:** same React SPA, served statically.
- **Backend:** **Node + TypeScript** with **Express** or **Fastify**.
- **Database:** **PostgreSQL**.
- **Hosting:** flat-rate VPS (predictable cost; no metered surprises). Cloudflare in front for TLS + rate-limiting.
- **Wallet:** Apple Wallet pass updates **require the Node backend** (PassKit web service + APNs); Google Wallet pass updates via Google's REST API. This is precisely why a static-only architecture cannot be the final form — but the prototype stubs it cleanly.

The `domain/` and `ports/` layers are stack-agnostic and move/share directly into the Node backend at production time. Only adapters and the wallet/transport implementations change.

---

## 6. Data Model

Key decisions carried from design discussion:
- **Append-only ledger, not a counter + flag.** Current balance and "reward available" are **derived** by summing the ledger. This gives history, dispute resolution, and auditability for free, and corrections become entries rather than destructive edits.
- **Random opaque token as identity.** The QR/pass holds a 128-bit random token (e.g. UUIDv4 or random base64url). It is **never** derived from name/phone (which are low-entropy and forgeable). A leaked/screenshotted card therefore exposes no personal data.
- **Personal data is optional.** The token is the identity. Name/email/phone only enable *features* (recovery, notifications), not identity.

### Entities

**ProgramConfig** (single record; admin-editable)
- `pointsPerReward` (threshold, e.g. 9)
- `rewardDescription` (e.g. "Free regular coffee")
- `pointsPerPurchase` (default 1)
- `maxPointsPerTransaction` (safeguard cap, e.g. 3)
- `cardInactivityDays` (optional expiry/retention policy)

**StaffAccount**
- `id`, `username`, `passwordHash` (production; prototype may mock auth), `role` (`admin` | `staff`), `active` (bool), `createdAt`

**Customer**
- `id` (internal), `token` (random, opaque — goes in QR/pass)
- `displayName?` (optional), `email?` (optional), `phone?` (optional)
- `status` (`active` | `deleted`)
- `consentAt` (timestamp of registration consent), `createdAt`

**LoyaltyTransaction** (append-only — source of truth for points)
- `id`, `customerId`, `type` (`accrual` | `redemption` | `reversal`)
- `points` (signed delta: +N accrual, −threshold redemption, ± reversal)
- `staffId` (actor), `timestamp`, `note?`, `reversesTransactionId?`

Derived: `balance(customer) = Σ points`; `rewardAvailable = balance ≥ pointsPerReward`.
Redemption writes a `redemption` entry that subtracts `pointsPerReward`, **checked-and-written atomically** to prevent double-spend.

**AuditLogEntry** (append-only — full action trail, broader than the ledger)
- `id`, `actorId`, `actorRole`, `action` (e.g. `staff.login`, `card.issue`, `loyalty.accrue`, `loyalty.redeem`, `loyalty.reverse`, `customer.delete`, `staff.create`, `staff.disable`, `config.update`)
- `targetId?`, `details?`, `timestamp`

The ledger covers point accountability; the audit log additionally covers non-loyalty actions (auth, staff/config management, deletions).

---

## 7. Pluggable Seams (the heart of portability)

### 7.1 `DataStore` port (`ports/DataStore.ts`)
A single async interface the whole app codes against. Indicative methods:
```ts
interface DataStore {
  // customers
  createCustomer(input): Promise<Customer>;
  getCustomerByToken(token): Promise<Customer | null>;
  findCustomers(query): Promise<Customer[]>;       // recovery search by name/email/phone
  updateCustomer(id, patch): Promise<Customer>;    // staff-mediated correction only
  softDeleteCustomer(id): Promise<void>;

  // loyalty (append-only)
  appendTransaction(tx): Promise<LoyaltyTransaction>;
  listTransactions(customerId): Promise<LoyaltyTransaction[]>;
  redeemReward(customerId, staffId): Promise<RedeemResult>; // atomic check+write

  // staff & config
  createStaff(input): Promise<StaffAccount>;
  setStaffActive(id, active): Promise<void>;
  listStaff(): Promise<StaffAccount[]>;
  getConfig(): Promise<ProgramConfig>;
  updateConfig(patch): Promise<ProgramConfig>;

  // audit
  appendAudit(entry): Promise<void>;
  listAudit(filter): Promise<AuditLogEntry[]>;

  // backup/restore (prototype: JSON export/import)
  exportAll(): Promise<Snapshot>;
  importAll(snapshot): Promise<void>;
}
```
**Adapters:**
- `adapters/storage/IndexedDbStore.ts` — prototype. Implements everything against IndexedDB.
- `adapters/storage/ApiStore.ts` — production skeleton. Same interface, each method maps to an HTTP call to the Node backend. Ships as a clearly-marked stub in the prototype repo so the contract is visible and the swap is a one-line wiring change.

### 7.2 `Transport` port (`ports/Transport.ts`)
Models the **registration handoff** between the customer's device and the staff device (in production this is server-mediated; in the prototype it is simulated).
```ts
interface Transport {
  // staff side opens a session; customer joins via scanned code; details flow back
  createRegistrationSession(): Promise<{ sessionId; joinPayload }>;
  onCustomerJoined(cb): void;
  sendToCustomer(sessionId, data): Promise<void>;
  onCustomerSubmitted(cb): void;   // receives completed registration details
  close(sessionId): void;
}
```
**Adapters:**
- `adapters/transport/LocalBridgeTransport.ts` — **default.** Runs both the staff panel and the customer view inside one browser (dual-pane or role switcher), using an in-memory/BroadcastChannel bridge. Best for UI/UX testing and most demos — zero networking.
- `adapters/transport/dev/PeerTransport.ts` — **DEV-ONLY.** PeerJS over WebRTC (with a TURN server for relay) so a real customer phone and a real staff device can talk during a live two-device demo.

> **Dev-only enforcement (required):** `PeerTransport` lives under `adapters/transport/dev/`, is selected **only** when `import.meta.env.VITE_DEV_TRANSPORT === 'peer'`, carries a prominent header comment ("DEVELOPMENT-ONLY transport stub — not for production"), and is **excluded from / no-ops in any production build**. It must be obvious in code review that this is a demo scaffold, not a shipping transport. Production replaces this seam entirely with the server-mediated flow.

We are intentionally **not** building the QR-bounce handoff (staff QR → customer → return QR → staff scan): the in-browser bridge is simpler for testing and PeerJS is better for live two-device demos.

---

## 8. Core Workflows

### 8.1 Registration (card creation)
1. Staff (logged in) taps **Issue card** → app creates a `Customer` shell with a fresh random `token` and opens a registration session (`Transport`).
2. Customer scans the displayed QR → lands on the **registration view** (prototype: bridge/PeerJS; production: their browser hits the server URL).
3. Staff prepares the drink meanwhile.
4. Customer enters **optional** details (name/email/phone — all skippable), reads the **privacy notice**, gives **consent**, submits. A fully token-only ("anonymous") account is allowed, with a clear note that recovery and email notifications won't be available.
5. App finalizes the customer, records `consentAt`, writes an audit entry, and offers the card: QR (always) + **Add to Apple/Google Wallet** (production; stubbed in prototype).
6. Key fields are **not customer-editable** afterward, but **staff can correct them** with an audit trail (a typo'd phone otherwise breaks recovery/notifications — never make them truly immutable).
7. **Duplicate prevention:** if a name/email/phone matches an existing active customer, warn the staff before creating a second card.

### 8.2 Loyalty accrual
1. Customer shows their QR. Staff scans it from the staff panel.
2. App resolves the customer by `token` and shows their state (name if present — lets staff confirm "is this you, Maria?", current balance, progress).
3. Staff enters points (default `pointsPerPurchase`, capped at `maxPointsPerTransaction`) and confirms.
4. App appends an `accrual` transaction + audit entry. If the new balance crosses the threshold, the customer becomes reward-eligible (and in production, a wallet push / email fires).

### 8.3 Redemption
1. Staff scans the customer's QR; app shows that a reward is available.
2. Staff taps **Redeem** and confirms. The free drink itself is given through the café's normal process; the system only records the entitlement use.
3. App calls `redeemReward` which **atomically** verifies `balance ≥ threshold` and writes a `redemption` transaction (−threshold), preventing double-redeem. Audit entry written.

### 8.4 Recovery & reissue
1. Customer lost their phone/card. Staff opens **Find customer** and searches by name/email/phone (whatever was provided).
2. Staff confirms identity and **reissues** the card (re-render QR / re-add pass). Token may be kept (simple) or rotated (safer if the old card may be in someone else's hands) — make rotation the configurable default for production. Audit entry written.
3. Token-only customers who provided no details **cannot** be recovered — this tradeoff is stated to them at registration.

### 8.5 Correction / undo
- Staff can reverse a **recent** accrual or redemption (wrong customer, fat-finger) via a `reversal` transaction referencing the original. Nothing is silently edited; the reversal is itself logged.

### 8.6 Deletion / opt-out
- Reachable from the customer's status page (or by asking staff). Requires staff confirmation. Performs a soft delete (status `deleted`, PII cleared), writes an audit entry. Honors the GDPR right to erasure; trivial because the café owns the data.

### 8.7 Staff management (admin)
- Admin lists staff, creates accounts, **disables** departed employees (critical — a former employee must lose the ability to issue points/redeem), resets passwords. All logged.

### 8.8 Program configuration (admin)
- Admin sets `pointsPerReward`, `rewardDescription`, `pointsPerPurchase`, `maxPointsPerTransaction`, `cardInactivityDays`. Changes logged.

---

## 9. Safeguards & Integrity
- **Staff initiates the credit** — the core anti-fraud principle. Customers can only *display*; only staff commit points/redemptions.
- **Per-transaction point cap** (`maxPointsPerTransaction`).
- **Append-only ledger + audit log** — over-issuing and self-dealing are visible and reviewable; disputes are resolvable.
- **Atomic redemption** — no double-spend.
- **Corrections are entries, never destructive edits.**
- **Random opaque token QR** — a stolen/screenshotted card exposes no PII; the residual risk (someone redeeming a copied card) is bounded because staff are present at redemption.

---

## 10. Security & Privacy
- **Data minimization is the primary control** — most PII is optional; the token carries identity. Less data held = smaller breach + lighter compliance.
- **No passwords for customers** (no hashes to leak; no credential-stuffing surface).
- **Production:** encrypt at rest (disk/DB), TLS in transit, **encrypt backups**, keep the DB off the public internet, and ensure **name/email never enter application logs or error reports** (a common accidental-leak path).
- **Privacy notice + consent at registration** — short, accurate: what's collected, why, lawful basis (consent for an opt-in scheme), retention, rights, and the international-transfer disclosure for Apple/Google. The **café is the data controller**; the notice is template-based (national DPA templates), no lawyer required at this scale. A data-processing agreement between developer and café covers the processor relationship.
- **Deletion flow** honors erasure.
- Prototype note: browser storage is not "secure storage"; the prototype is for demo/testing only and must not hold real customer data.

---

## 11. UI Spec (functional for v1)

Visual polish is a **later pass** — v1 UI is functional. Still hold a quality floor (from frontend-design conventions): responsive down to mobile, visible keyboard focus, reduced-motion respected, and **plain, active-voice, consistent labels** ("Add points," not "Submit"; the button that says "Redeem" produces a "Redeemed" confirmation). Name things by what the user controls, not by system internals. Errors state what happened and how to fix it.

### Screens
**Auth**
- Staff/Admin login.

**Staff panel**
- **Scan/Home:** scan customer QR → customer state card → **Add points** / **Redeem** actions + confirm.
- **Issue card:** generate + display registration QR; live status as the customer joins/submits.
- **Find customer:** search by name/email/phone → result → **Reissue card** / view history / **Correct** recent entry.

**Admin panel** (extends staff)
- **Staff:** list / create / disable / reset.
- **Program:** edit config (threshold, reward, caps, inactivity).
- **Stats:** basic counts (active customers, points issued, rewards redeemed).
- **Audit log:** filterable list of actions.

**Customer-facing**
- **Register:** optional details + privacy notice + consent → card issued; **Add to Apple/Google Wallet** (stub in prototype) + QR.
- **Status:** view points/progress and reward availability via token (the web checkup).
- **Delete my data:** request erasure.

A clear **demo role switcher** (Staff / Admin / Customer device) is acceptable and useful in the prototype, since one browser is simulating multiple devices.

---

## 12. File Tree (self-descriptive, split by functionality)
```
cafe-loyalty/
├── README.md
├── CLAUDE.md                      # rules, architecture, agent workflow
├── package.json
├── vite.config.ts                # base path for GitHub Pages project site
├── index.html
├── public/
│   └── 404.html                  # SPA fallback for GitHub Pages
├── docs/
│   └── SPEC.md                    # this document
├── src/
│   ├── main.tsx                  # entry
│   ├── App.tsx                   # router/shell, role switcher (prototype)
│   ├── config/
│   │   └── env.ts                # build mode + feature flags (VITE_DEV_TRANSPORT)
│   ├── domain/                   # pure logic, no I/O, no React — fully tested
│   │   ├── models.ts             # entity types
│   │   ├── loyalty.ts            # balance, reward-availability, redemption rules
│   │   ├── tokens.ts             # random token generation
│   │   └── validation.ts         # input + duplicate checks
│   ├── ports/                    # the pluggable seams (interfaces)
│   │   ├── DataStore.ts
│   │   └── Transport.ts
│   ├── adapters/
│   │   ├── storage/
│   │   │   ├── IndexedDbStore.ts # prototype storage
│   │   │   └── ApiStore.ts       # production HTTP stub (same interface)
│   │   └── transport/
│   │       ├── LocalBridgeTransport.ts   # default in-browser handoff
│   │       └── dev/
│   │           └── PeerTransport.ts      # DEV-ONLY P2P stub (PeerJS), flagged
│   ├── services/                 # orchestrate domain + ports
│   │   ├── CustomerService.ts
│   │   ├── LoyaltyService.ts
│   │   ├── StaffService.ts
│   │   ├── ConfigService.ts
│   │   └── AuditService.ts
│   ├── qr/
│   │   ├── encode.ts             # QR payloads (token, registration handoff)
│   │   └── scan.ts               # camera scanning wrapper
│   ├── wallet/
│   │   ├── passStub.ts           # prototype: simulated add-to-wallet
│   │   └── README.md             # production Apple/Google integration notes
│   └── ui/
│       ├── auth/
│       ├── staff/
│       ├── admin/
│       ├── customer/
│       └── common/               # QrDisplay, QrScanner, layout, shared bits
├── tests/                        # domain + service unit tests (Vitest)
└── .github/workflows/deploy.yml  # build + deploy to GitHub Pages
```

---

## 13. Build, Hosting & GitHub Pages

- Vite **`base`** must be set to `'/<repo-name>/'` for a GitHub Pages project site, else assets 404.
- SPA routing on GitHub Pages: use **`HashRouter`**, OR ship a `public/404.html` that redirects into the app (the standard GH-Pages SPA fallback). Pick one; HashRouter is simplest.
- Prototype is **fully client-side** — no env secrets, no API. Everything runs against `IndexedDbStore`.
- CI: `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on push to `main`.
- Camera scanning (`getUserMedia`) requires a secure context — GitHub Pages is HTTPS, so this works; localhost also counts as secure for dev.

---

## 14. Prototype → Production Migration

The prototype is **true to the architecture**, so going live is bounded and mechanical:
1. **Storage:** wire `ApiStore` in place of `IndexedDbStore` (one composition-root change). Implement the Node + Express/Fastify + Postgres backend behind the same `DataStore` contract. `domain/` moves/shares server-side.
2. **Transport:** replace the bridge/PeerJS seam with the real server-mediated registration flow (customer's browser hits a real URL).
3. **Wallet:** implement the PassKit web service + APNs (Apple) and Google Wallet REST updates (Google) in the Node backend; replace `wallet/passStub.ts`.
4. **Auth:** real staff/admin auth + hashed passwords server-side.
5. **Ops:** flat-rate VPS + Cloudflare; encrypted DB + **encrypted, tested** backups; restore path verified once for real.

Because every app call already goes through async ports, no UI or service call site should need to change.

---

## 15. Acceptance Criteria (prototype "done")
- [ ] Staff/admin login (mockable) with role gating.
- [ ] Issue card → customer registration handoff works in-browser (and via PeerJS for two devices).
- [ ] Optional-PII and token-only registration both work; duplicate warning fires.
- [ ] Accrual respects the per-transaction cap; ledger is append-only; balance/progress derived correctly.
- [ ] Redemption is atomic (no double-spend) and clears against threshold.
- [ ] Recovery/search + reissue works; token-only customers correctly cannot be recovered.
- [ ] Correction/reversal works and is logged.
- [ ] Deletion/opt-out works (staff-confirmed) and clears PII.
- [ ] Admin: staff create/disable, config edit, basic stats, audit log viewer all work.
- [ ] Add-to-wallet and notifications are stubbed but visibly present in the flow.
- [ ] Storage is entirely behind `DataStore`; swapping to `ApiStore` requires no UI/service changes.
- [ ] `PeerTransport` is clearly dev-only and excluded from production builds.
- [ ] Domain logic has unit tests; file tree matches §12.
