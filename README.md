# ☕ Café Loyalty — v1 prototype

A digital loyalty system for a **single café**. Staff scan a customer's QR and
commit loyalty points; customers collect points and earn rewards. **The system
never handles money** — it only tracks loyalty state.

This repo is the **v1 functional prototype**: a React + TypeScript SPA with
browser storage, deployed to GitHub Pages. Its architecture is **true to the
production design**, so going live means swapping pluggable adapters — not a
rewrite. Authoritative requirements live in [`docs/SPEC.md`](docs/SPEC.md);
working rules for agents in [`CLAUDE.md`](CLAUDE.md); current build status in
[`docs/STATUS.md`](docs/STATUS.md).

> ⚠️ **Prototype only.** Browser storage is **not** secure storage. Do not enter
> real customer data.

**Live demo:** https://misch0n.github.io/loyalty-system/ · Demo logins:
`admin / admin` or `staff / staff`.

---

## Table of contents
- [What it does](#what-it-does)
- [Feature set](#feature-set)
- [Architecture](#architecture)
- [Core flows](#core-flows)
- [Data model](#data-model)
- [Project layout](#project-layout)
- [The pluggable seams](#the-pluggable-seams)
- [Running it](#running-it)
- [Path to production](#path-to-production)

---

## What it does

The trust anchor is **staff-side**: only staff can commit points or redemptions,
because staff presence confirms a real transaction happened. Customers can only
*display* their card. Identity is a **random 128-bit opaque token** (in the QR) —
never derived from name/phone — so a screenshotted card leaks no personal data.
Personal details are **optional**; a fully anonymous (token-only) account is
valid.

Points live in an **append-only ledger**. Balance and "reward available" are
*derived* by summing entries — never stored as a counter. Corrections are
`reversal` entries, never destructive edits. Every staff/admin action writes an
**audit entry**.

---

## Feature set

| Area | Capabilities |
|---|---|
| **Auth (mock)** | Login-based device role: signed-in devices show staff/admin screens; everyone else defaults to customer. One shared sign-in page (`src/ui/auth/LoginScreen.tsx`) — admin credentials unlock admin tools. Prefilled with `staff`/`staff`; one-tap fills for both roles available. Disabling a departed employee instantly revokes access. |
| **Self-service registration** | PRIMARY path: customer visits `/register`, creates their own card in one step — remembered on the browser via `IdentityStore`. No approval queue, no staff involvement. |
| **Staff-initiated registration** | SECONDARY path: staff start a card at `/staff/issue` over real PeerJS; customer joins on their own device. Duplicate details **warn before** a second card is created. |
| **Auto-provision on scan** | Scanning an unknown-but-valid token creates a token-only card on the staff device so accrual can proceed immediately. Staff still initiates the credit. |
| **Loyalty accrual** | Staff scan → see customer state → add points (default `pointsPerPurchase`, **capped** at `maxPointsPerTransaction`). Appends an `accrual` + audit entry. Sends a best-effort reward-available email on threshold crossing (when customer has an email). |
| **Redemption** | Staff redeem when balance ≥ threshold. **Atomic** check-and-write — no double-spend. |
| **Self-service recovery** | Customer visits `/recover`, enters their registered email → single-use link (15-min expiry) via EmailJS → opening the link re-establishes identity on the browser. Token-only customers remain unrecoverable by design (disclosed at signup). Uniform response (no account enumeration). |
| **Staff recovery / reissue** | `/staff/find`: find customer by name/email/phone; reissue with a **rotated token** (default) or keep it. Backup path. |
| **Correction / undo** | Reverse a recent accrual/redemption via an offsetting `reversal` entry — logged, never silent. |
| **Deletion / opt-out** | Staff-confirmed soft delete: status → `deleted`, PII cleared, audited. Honors right to erasure. |
| **Admin — staff** | List / create / disable / re-enable / reset password. |
| **Admin — program** | Edit threshold, reward text, points-per-purchase, per-transaction cap, inactivity days. |
| **Admin — stats** | Basic counts: active customers, points issued, rewards redeemed. |
| **Admin — audit log** | Filterable, append-only action trail (no PII). |
| **Backup** | JSON export/import (behind the same `DataStore` port). |
| **Prototype tools menu** | A "prototype" dropdown in the header (`src/ui/common/PrototypeMenu.tsx`) groups all demo scaffolding: Pair/Unpair this device, Reset this device (closes + deletes IndexedDB, clears storage, reloads), and a staff/admin sign-in shortcut. Replaces the old always-visible device-switcher tabs and header pair pill. |
| **Reset device** | `Services.reset()` (backed by `IndexedDbStore.close()`) drops the `cafe-loyalty` database and clears `cafe-loyalty.customer` / `cafe-loyalty.actor` keys so a workflow can be rerun from a clean device state. Prototype-only. |
| **Device pairing (prototype)** | Every device defaults to hosting: it shows its own pairing QR inside the Prototype menu. Scanning another device's QR makes this device a customer of that till. The till accepts **many customer devices simultaneously**; each gets its own `StoreServer` instance so change notifications fan out to all. The first customer to pair routes the till to `/staff` and the customer to `/`. Unpairing signals every connected device (`{ t: 'unpair' }`) and each side resumes hosting. The pairing QR lives in the **Prototype tools menu** — opening the menu shows this device's QR with a "Scan a code" button beneath. A till shows the paired-device count and "Unpair all"; a paired customer shows a "Paired to the till" label with Unpair + Reset. `/pair` is now scan-only: a `?host=` URL auto-joins (QR-only; `QrScanner` receives `allowManual={false}`). The customer device's `DataStore` is transparently served by the till over PeerJS — the no-backend stand-in for a production server. |
| **Device persistence (B1)** | A device remembers exactly one card (via `IdentityStore`). Viewing a card never auto-saves it, so opening a shared card URL never overwrites the saved card silently. Registration has a "Remember this card on this device" toggle (default ON when no card saved, OFF with a replace-notice when another card is already saved). The own-card Status page shows `RememberControl`: "Remember this card on this device" when not saved; "Remove this card from this device" (forget — clears device persistence only, not the account) when saved. Token-only (no email/name) cards confirm before forgetting. "Delete my card" removes the account AND the card. |
| **Card QR = card URL (B2)** | The card QR encodes the full card-page URL (`…/#/status/<token>`). Staff scan extracts the token via `tokenFromCardScan()`; bare tokens still accepted for backward compatibility. No PII in the URL. |
| **Recovery tiers disclosed at signup (B3)** | `SelfRegister` shows which recovery tier applies: email → self-recovery link; name-only → staff best-effort; neither → not recoverable. Name remains optional. |
| **Review prompt (B4)** | After a customer's FIRST redemption, a dismissible prompt deep-links to the café's Google write-review dialog. Shown once per device (`cafe-loyalty.reviewPrompted` in localStorage). Place ID via `VITE_GOOGLE_PLACE_ID` (default: Ckyka Specialty Coffee Shop, Sofia). No sentiment gating; shown to everyone (required by Google). |
| **Wallet — predetermined passes** | "Add to Wallet" button (`WalletButton`) appears on the post-register `CardView` and the own-card Status view. Detects device OS (iOS → Apple Wallet, else Google Wallet) and links to a pre-generated walletwallet.dev pass. The first three cards on a store get fixed preset tokens (`PROTOcard0000000000001..3`) mapped to three real pass serials; later cards rotate stably for display. `CustomerService.nextCardToken()` assigns preset tokens via `countActiveCustomers()`. Old `wallet/passStub.ts` replaced by `wallet/passes.ts`. |
| **Footer (B6, partial)** | Layout footer has a "Find Ckyka Specialty Coffee Shop" Google Maps link (place-pinned, coordinate-centred) and a placeholder "Contact" mailto. Café details live in `config/cafe.ts`. |
| **Family / couples sharing (B7)** | Opening the card URL or QR on a second device shows that card without overwriting either device's saved card. Balance pools naturally (one ledger, one token). This is expected behaviour: the card is a shared credential. No feature code needed and future changes must not bind a card to exactly one device. |
| **Base-URL landing** | `/` routes by context: authenticated staff/admin → staff home; recognized browser → `/status/:token`; otherwise → the self-registration form (`SelfRegister`) directly. A "Lost your card?" recovery link appears at the end of that form. Staff/admin session always takes precedence (never auto-shows a customer card). Staff sign-in shortcut lives in the Prototype menu. |

---

## Architecture

Layered **ports & adapters (hexagonal)**. Dependencies point **inward**: the UI
talks only to services; services orchestrate the pure domain against interfaces
(ports); concrete adapters plug into those ports at one composition root.

```mermaid
flowchart TB
    subgraph ui["ui/ · React screens"]
        AUTH[auth] & STAFF[staff] & ADMIN[admin] & CUST[customer]
        PAIR[PairingProvider / PairDevices]:::proto
    end

    subgraph services["services/ · orchestration"]
        SVC["CustomerService · LoyaltyService · RecoveryService<br/>StaffService · ConfigService · AuditService"]
        SYNC["SyncKit (services.sync)"]:::proto
    end

    subgraph domain["domain/ · pure logic (no I/O)"]
        DOM["models · loyalty · tokens · validation"]
    end

    subgraph ports["ports/ · the seams (interfaces)"]
        DS{{DataStore}}
        TR{{Transport}}
        ML{{Mailer}}
        ID{{IdentityStore}}
    end

    subgraph adapters["adapters/ · concrete implementations"]
        IDB[IndexedDbStore]:::proto
        API[ApiStore stub]:::prod
        PEER[PeerTransport · PeerJS+TURN]:::proto
        SRV[ServerTransport stub]:::prod
        EJS[EmailJsMailer]:::proto
        NOOP[NoopMailer]:::proto
        LSI[LocalStorageIdentityStore]:::proto
        subgraph sync["adapters/sync/ · prototype pairing"]
            OBS[ObservableStore]:::proto
            SWI[SwitchableStore]:::proto
            PCS[PeerClientStore]:::proto
            SSV[StoreServer]:::proto
            PJL[PeerJsLink · PeerJS+TURN]:::proto
        end
    end

    ui --> services --> domain
    services --> ports
    PAIR --> SYNC
    SYNC --> OBS & SWI & SSV
    SWI -.wraps.-> DS
    PCS -.proxies via.-> PJL
    DS -.implemented by.-> IDB & API
    TR -.implemented by.-> PEER & SRV
    ML -.implemented by.-> EJS & NOOP
    ID -.implemented by.-> LSI

    classDef proto fill:#e3f3ea,stroke:#2f7d57;
    classDef prod fill:#eef,stroke:#5b6cc0,stroke-dasharray:4;
```

**Rules that keep the swap cheap:**
- `domain/` is pure — no I/O, no React, no browser APIs → fully unit-testable and
  shared verbatim with the future Node backend.
- `DataStore` is **async everywhere** (returns Promises), even though IndexedDB
  could be sync, so call sites match the future HTTP adapter byte-for-byte.
- The **composition root** ([`src/services/Services.ts`](src/services/Services.ts))
  is the *only* place that names a concrete adapter.
- The UI **never** touches an adapter or storage directly.

---

## Core flows

### Self-service registration (primary path)

The customer creates their own card without staff involvement. `IdentityStore`
persists the token in the browser so subsequent visits skip registration.

```mermaid
sequenceDiagram
    actor C as Customer browser
    participant App as CustomerService
    participant IS as IdentityStore

    C->>App: selfRegister(optional details + consent)
    App->>App: checkDuplicates() → warn if match
    App->>App: createCard() → token + audit(card.provision)
    App->>IS: saveToken(token)
    App-->>C: card (card-URL QR + WalletButton)
```

### Staff-initiated registration (secondary path)

Staff and customer devices communicate over **PeerJS + TURN** (real two-device
connection; no single-browser simulation).

```mermaid
sequenceDiagram
    actor S as Staff device
    participant App as Services
    participant T as Transport (PeerJS)
    actor C as Customer device

    S->>App: issueCard()
    App-->>S: token-only shell + audit(card.issue)
    S->>T: createRegistrationSession()
    T-->>S: { sessionId, joinPayload }
    S-->>C: show registration QR
    C->>T: joinSession(sessionId)
    T-->>S: onCustomerJoined
    C->>T: submitRegistration(optional details + consent)
    T-->>App: onCustomerSubmitted
    App->>App: checkDuplicates() → warn if match
    App->>App: finalizeRegistration() → record consent + audit
    App-->>C: card (card-URL QR + WalletButton)
```

### Accrual & redemption (append-only ledger)

```mermaid
flowchart LR
    SCAN([Staff scans token]) --> STATE[Resolve customer<br/>derive balance = Σ ledger]
    STATE --> ADD["Add points<br/>(clamped to cap)"]
    STATE --> RDM{balance ≥<br/>threshold?}
    ADD --> ACC[(append accrual<br/>+ audit)]
    RDM -- yes --> RED[(atomic: append redemption<br/>−threshold + audit)]
    RDM -- no --> NA[Show progress]
    STATE --> REV[(Reverse recent entry<br/>= offsetting reversal)]
```

---

## Data model

Append-only ledger + audit log. `Customer.token` is the opaque identity; PII is
optional. Balance and reward-availability are derived, never stored.

```mermaid
erDiagram
    ProgramConfig {
        number pointsPerReward
        string rewardDescription
        number pointsPerPurchase
        number maxPointsPerTransaction
        number cardInactivityDays
    }
    StaffAccount {
        string id PK
        string username
        string role "admin | staff"
        boolean active
    }
    Customer {
        string id PK
        string token "128-bit opaque, in QR"
        string displayName "optional"
        string email "optional"
        string phone "optional"
        string status "active | deleted"
        string consentAt
    }
    LoyaltyTransaction {
        string id PK
        string customerId FK
        string type "accrual | redemption | reversal"
        number points "signed delta"
        string staffId FK
        string reversesTransactionId "nullable"
    }
    AuditLogEntry {
        string id PK
        string actorId
        string actorRole
        string action
        string targetId
        string details "never PII"
    }

    Customer ||--o{ LoyaltyTransaction : "has ledger"
    StaffAccount ||--o{ LoyaltyTransaction : "commits"
    LoyaltyTransaction |o--o| LoyaltyTransaction : "reverses"
    StaffAccount ||--o{ AuditLogEntry : "acts"
```

---

## Project layout

```
src/
├── config/
│   ├── env.ts             # feature flags (VITE_TRANSPORT, VITE_EMAILJS_*, VITE_TURN_*, VITE_GOOGLE_PLACE_ID), baseUrl, iceServers
│   ├── links.ts           # appUrl() — builds absolute HashRouter URLs for QR + emails
│   └── cafe.ts            # café public details: name, address, Google Maps URL, contact email (B6)
├── domain/                # pure logic, fully unit-tested
│   ├── models.ts          # entity types (incl. card.provision, customer.recover audit actions)
│   ├── loyalty.ts         # balance, reward-availability, redemption rules
│   ├── tokens.ts          # 128-bit opaque token generation
│   └── validation.ts      # input + duplicate checks
├── ports/                 # the seams (interfaces)
│   ├── DataStore.ts       # includes createRecoveryCode / consumeRecoveryCode
│   ├── Transport.ts
│   ├── Mailer.ts          # NEW — email abstraction
│   └── IdentityStore.ts   # NEW — browser identity (token storage)
├── adapters/
│   ├── storage/
│   │   ├── IndexedDbStore.ts   # prototype storage (schema v2, recoveryCodes store); close() drops DB
│   │   ├── ApiStore.ts         # production HTTP stub
│   │   └── schema.ts           # IndexedDB schema + seed data
│   ├── transport/
│   │   ├── PeerTransport.ts    # prototype: PeerJS + TURN (real cross-device)
│   │   └── ServerTransport.ts  # production placeholder (throws)
│   ├── email/
│   │   ├── EmailJsMailer.ts    # client-side EmailJS via fetch
│   │   └── NoopMailer.ts       # fallback when EmailJS unconfigured
│   ├── identity/
│   │   └── LocalStorageIdentityStore.ts   # stores token only (no PII)
│   └── sync/                   # PROTOTYPE-ONLY — device pairing via PeerJS (one till, many clients)
│       ├── PeerLink.ts         # channel interface + SyncMessage envelopes (incl. {t:'unpair'})
│       ├── PeerJsLink.ts       # PeerJS+TURN: ConnLink (single connection), joinHost() (client),
│       │                       #   PeerJsHost (one peer, many clients; onClient/onCountChange/
│       │                       #   count/unpairAll/close)
│       ├── ObservableStore.ts  # DataStore wrapper that emits on mutation
│       ├── SwitchableStore.ts  # DataStore whose target swaps local↔remote at runtime
│       ├── PeerClientStore.ts  # DataStore that proxies calls to host over RPC
│       ├── StoreServer.ts      # host side: one instance per client; serves RPC + pushes changed
│       └── storeMethods.ts     # canonical DataStore method list + mutating subset
├── services/              # orchestrate domain + ports
│   ├── CustomerService.ts · LoyaltyService.ts · StaffService.ts
│   ├── ConfigService.ts · AuditService.ts
│   ├── RecoveryService.ts # self-service recovery (single-use expiring codes)
│   └── Services.ts        # ← composition root; wires adapters/sync → SyncKit (services.sync)
│                          #   exposes reset() — closes + drops IndexedDB (prototype-only)
├── qr/                    # encode (cardPayload = card-page URL, tokenFromCardScan, registrationPayload) + scan
├── wallet/
│   └── passes.ts          # PRESET_CARD_TOKENS, PASS_SERIALS, passSerialForToken, walletPassUrl,
│                          #   detectWalletKind — walletwallet.dev integration (prototype)
└── ui/
    ├── auth/              # LoginScreen (shared staff/admin sign-in, one-tap fills)
    ├── staff/ · admin/
    ├── customer/          # CustomerHome · SelfRegister (recovery-tier disclosure) · Recover
    │                      #   · Status · CardView · DeleteData
    │                      #   · WalletButton (OS-detected, walletwallet.dev)
    │                      #   · RememberControl (device persistence, B1)
    │                      #   · ReviewPrompt (post-redemption, once per device, B4)
    └── common/            # QrDisplay, QrScanner (allowManual prop), Layout (footer: Maps + Contact),
                           #   PairingContext/usePairing, PairDevices (QR-only; role by initiation),
                           #   PrototypeMenu, guards
tests/                     # Vitest: domain, service, adapter, qr, wallet, config (179 passing)
.env.example               # documents required build-time secrets
.github/workflows/deploy.yml   # build + test + deploy (injects secrets at build time)
```

---

## The pluggable seams

| Seam | Prototype adapter | Production adapter | Swap cost |
|---|---|---|---|
| **`DataStore`** (persistence) | `IndexedDbStore` | `ApiStore` → Node + Postgres | One line in `Services.ts` |
| **`Transport`** (registration handoff) | `PeerTransport` (PeerJS + TURN) | `ServerTransport` (server-mediated) | One line in `Services.ts` |
| **`Mailer`** (email) | `EmailJsMailer` (client-side EmailJS) or `NoopMailer` | Server-side provider | One line in `Services.ts` |
| **`IdentityStore`** (browser identity) | `LocalStorageIdentityStore` | Server-cookie adapter | One line in `Services.ts` |
| **`adapters/sync/` (device pairing)** | `PeerJsHost` / `ConnLink` / `joinHost` + `SwitchableStore` stack (one till, many clients) | Server-mediated DataStore — remove the sync layer | Rewire composition root |

### Prototype transport
`adapters/transport/PeerTransport.ts` uses PeerJS with a Metered TURN relay for
real two-device connectivity. Selected when `VITE_TRANSPORT=peer` (the default).
TURN credentials and EmailJS keys are **build-time-injected demo secrets** —
publicly readable in the static bundle, rotated after demos. See `.env.example`
for the full list. `adapters/transport/ServerTransport.ts` is the production
placeholder (every method throws until the backend exists).

### Prototype device pairing
`adapters/sync/` is a second PeerJS-backed channel, separate from registration.
Every device defaults to hosting: `PeerJsHost` creates one PeerJS peer that
accepts **many simultaneous client connections**. Each accepted connection becomes
a `ConnLink` handed to an `onClient` subscriber; the host spawns one `StoreServer`
per client, so change notifications fan out to every paired device. The till's
pairing QR lives in the **Prototype tools menu** (not a dedicated page); `/pair`
is now scan-only and auto-joins on a `?host=` URL parameter.

Once a customer device scans the QR, `joinHost(remoteId)` dials the till and
returns an open `ConnLink`. The customer device's `DataStore` is transparently
replaced (via `SwitchableStore`) with a `PeerClientStore` that proxies all reads
and writes to the host over RPC. `SyncMessage` now includes a `{ t: 'unpair' }`
variant — sent by either side when unpairing — so every peer can clean up
gracefully. After unpairing, each device resumes hosting so its QR becomes
available again.

Screens (`Status`, `CustomerStatePanel`) refetch on the `dataVersion` counter
exposed by `PairingProvider`. This is the **no-backend stand-in for the production
server**: in production, the server coordinates state centrally and the sync layer
is dropped entirely.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 179 unit tests (Vitest)
npm run build      # static output in dist/
npm run typecheck  # strict TS, no emit
```

Copy `.env.example` to `.env.local` and fill in your credentials before running
locally (TURN + EmailJS). `.env.local` is gitignored.

**Two-device demo:** PeerJS transport is the default. Open `http://localhost:5173`
on two devices on the same network (or use the deployed Pages URL). For
registration: scan the registration QR from the customer device. For live pairing:
open the "Prototype" menu on one device — its pairing QR is shown immediately;
tap "Scan a code" on the other device to scan it. The scanned device becomes the
customer and is routed to `/`; the till is routed to `/staff` on first pair. The
till shows the live paired-device count and an "Unpair all" button; a paired
customer shows a "Paired to the till" label with Unpair + Reset. Multiple customer
devices can pair to the same till simultaneously. State reflects live on all paired
devices. Use "Reset this device" (also in the Prototype menu) to rerun a workflow
from a clean state.

Sign in as staff/admin: `admin / admin` or `staff / staff` (available via the
Prototype menu or the sign-in link on the landing page).

### Deployment
Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):
it installs, **runs tests**, builds with the Pages base path (`/loyalty-system/`),
injects `VITE_EMAILJS_*` and `VITE_TURN_*` secrets from GitHub repository secrets
into the static bundle, and publishes to GitHub Pages. Routing uses `HashRouter`,
so no server rewrites are needed (a `public/404.html` fallback is shipped as a
belt-and-braces). `VITE_TRANSPORT` defaults to `peer`, so the deployed build uses
PeerJS on real devices.

> Pages source must be set to **GitHub Actions** (Settings → Pages → Source).
> Secrets must be added under Settings → Secrets → Actions before the first deploy.

---

## Path to production

Bounded and mechanical (see [SPEC §14](docs/SPEC.md)):

```mermaid
flowchart LR
    A[Swap IndexedDbStore → ApiStore<br/>one line in Services.ts] --> B[Node + Express/Fastify + Postgres<br/>behind the same DataStore contract]
    C[Swap PeerTransport → ServerTransport<br/>one line in Services.ts] --> D[Server-mediated registration over HTTP]
    E[Swap EmailJsMailer → server-side provider<br/>one line in Services.ts] --> F[Reliable transactional email]
    G[Swap LocalStorageIdentityStore → server-cookie adapter<br/>one line in Services.ts] --> H[Secure cross-device identity]
    I[Implement wallet passes<br/>PassKit + APNs / Google REST] --> J[replace walletwallet.dev prototype in passes.ts]
    K[Real hashed-password auth] --> L[server-side sessions]
    M[Drop adapters/sync/ pairing layer<br/>server coordinates state centrally] --> N[No PeerJS in data path]
```

Because every app call already goes through async ports, **no UI or service call
site changes**. `domain/` and `ports/` move/share into the backend unchanged.
