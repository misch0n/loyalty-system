# Scope decisions — maintainer triage (2026-09-02)

> **Authoritative record of the feature triage.** The maintainer reviewed all 123 features
> (everything the prototype ships plus everything the backend plan proposed) and marked each
> keep / drop / change. This file is the outcome: what is being built, what is being deleted,
> and what changes shape. It **supersedes** earlier scope statements in
> [`BACKEND-PLAN.md`](BACKEND-PLAN.md), and where it contradicts `../CLAUDE.md` or
> [`SPEC.md`](SPEC.md), the contradictions are listed in §5 to be reconciled.
>
> Tally: **89 keep · 18 drop · 6 change**, plus 10 already-removed items confirmed to stay out.
> **All open questions (Q1–Q7) answered 2026-09-15 — see §4.**
>
> **§6 holds later maintainer decisions**, taken after the triage and equally authoritative. Two
> from 2026-09-16, both large: the backend is now built **before** the UI and without regard for
> it, and the IndexedDB prototype is **retired**. Then the **2026-10-03** batch (§6.3–§6.7), the
> first answers to the UI reconciliation register: the staff device is a **shared till** and the
> PIN and idle lock go, admin step-up becomes a plain confirmation, the SPA's service tests run
> against the real server rather than a fake store, and the branch is **tagged, not merged**. Read
> §6 before §5 — it changes what "the prototype keeps its current behaviour until the backend
> reaches each item" means.

---

## 1 · Dropped — do not build, and delete where it exists

| ID | Feature | Consequence |
|---|---|---|
| FE-C-09 | Wallet button | With FE-X-09 and BE-S-06/07, **the entire `WalletProvider` port retires.** |
| FE-C-13 | Remember / remove card on this device | Device binding moves server-side (BE-A-07). Un-binding is handled by recovery — see §3.2. |
| FE-C-15 | Recovery-aware removal copy | Moot: every card is recoverable now that email is mandatory (FE-C-02). |
| FE-C-19 | Device remembers one card (client-managed) | Replaced by the server identity cookie, not abandoned. |
| FE-C-20 | Shared-card behaviour | A card is now bound to the device holding the cookie. |
| FE-S-12 | Auto-advance to scanner | **Changed target, not removed:** after a commit the terminal returns to the **counter**, not straight to the camera. |
| FE-A-02 | Four stat tiles | Data still collected — presentation dropped. |
| FE-A-03 | Stat breakdown popover | As above. |
| FE-A-13 | Export activity | Data still collected — no surface. |
| FE-A-14 | Past exports list | As above. |
| FE-X-09 | Static wallet passes | Part of the wallet removal. |
| BE-A-12 | Audited export as one operation | Nothing to audit — the export surface is gone. Retires `AuditService.exportActivity`, the `audit.export` action, and **resolves BACKEND-PLAN §4-F by deletion**. |
| BE-S-05 | Server registration handoff | With no other production implementation, **the `Transport` port retires.** Registration is a customer opening a URL. |
| BE-S-06 | Apple Wallet pass service | Needed Apple certificates; not worth the surface. |
| BE-S-07 | Google Wallet updates | As above. |
| BE-S-08 | Bounded stats reads | No stats surface to serve. |
| BE-D-10 | Ranged audit query | **Partially retained — see §3.1.** Dropped as an admin-facing API; retained as an internal server capability the detectors need. |
| BE-A-11 | Audit written by the server | **Reinstated on review — see §3.1.** |

**Net architectural effect: five swappable seams become three** — `DataStore`, `Mailer`,
`IdentityStore`. `WalletProvider` and `Transport` are deleted along with their ports,
adapters and the `VITE_WALLET` / `VITE_TRANSPORT` flags.

---

## 2 · Changed

### 2.1 FE-C-02 · Registration requires name and email
Name and email are **no longer optional**. Optional PII was found to be more confusing than
useful.

**This deletes token-only accounts**, and with them the "PII is optional" architecture rule.
Every card now has a recovery path, which is why FE-C-03 and FE-C-15 fall away. See §5 for
the documentation this contradicts.

### 2.2 FE-C-03 · Privacy notice
The recovery-tier warning ("a card with no email can't be recovered") is removed — it cannot
happen any more. The privacy notice itself stays; it now describes what we hold and why.

### 2.3 FE-C-16 / FE-C-17 · Recovery becomes a typed code
The emailed magic link is replaced by a **code the customer types on the device they are
holding**:

1. Customer enters their email on the lost-card screen.
2. The page moves to a waiting-for-code state.
3. The server emails a short single-use code.
4. Customer types the code and submits.
5. On success the server sets the identity cookie — **the card is now bound to this device.**

Better than a link because a link opens on whichever device reads the mail, which is
frequently the wrong one. This is also the **only** un-bind mechanism (§3.2).

`BE-S-03` (hardened recovery codes) follows this shape: hashed at rest, single-use, short
expiry, identical responses for known and unknown addresses, rate-limited. A typed code must
be short enough to key in, so **rate limiting and attempt lockout do the work length no longer
does** — a 6-character code with unlimited attempts is not a secret.

### 2.4 FE-S-13 · Counter error states become a first-class surface
Staff must never be left on an empty screen. Every failure the terminal can detect gets a
plain statement of what happened **and a remediation action**:

| Situation | What staff sees |
|---|---|
| No customer for this code | "No card matches that code." → ask the customer to check they've registered |
| Customer doesn't hold the rewards being redeemed | Names which rewards are already used; the rest still commit |
| Over the per-scan cap | The cap, and what was attempted |
| Network / server unreachable | "Couldn't reach the till system." → retry, with the staged transaction preserved |
| Camera unavailable or permission denied | Fall back to manual short-code entry |
| Scan unreadable | "Couldn't read that code." → retry or type the short code |

This ties directly to `BE-F-02` (offline posture) — the two are one piece of work.

### 2.5 FE-A-09 · Configure program
Adds "number of drinks on card" — which is **the reward threshold itself** (Q1): X drinks earn
a reward, admin-configurable. The card grid follows as `threshold + 1` (X earnable cups plus
the pre-stamped free cup) exactly as it does today. No independent grid size, no new field —
the label in Configure just needs to say plainly what it controls.

---

## 3 · Reconciled conflicts

### 3.1 Audit integrity (BE-A-11 reinstated, BE-D-10 partially retained)
Dropping server-written audit rows was collateral from removing the export items beside it.
Reinstated, because **the alert detectors are derived from audit rows** — a client-written
audit log means the detectors judge fraud using data the person committing it authored.
The server already handles the route; writing the row there is the same work in a safer place.

`BE-D-10` is retained on the same grounds, narrowed: the ranged, multi-actor audit query is an
**internal server capability with no route attached**. It is what `BE-S-09` (server-side
detection) queries. It is not an admin API and there is no export endpoint.

### 3.2 Un-binding a card (FE-C-13 dropped, no replacement needed)
Raised as a gap; it is not one. **Recovery is the un-bind.** A customer who finds someone
else's card on their phone recovers their own (§2.3), which overwrites the cookie. Nothing
extra to build.

### 3.3 Deletion semantics (FE-C-14)
"Delete permanently" against an append-only ledger resolves cleanly because **the ledger
references the internal `customerId`, never the token**:

- **Keep** the customer row as a tombstone: `id`, `createdAt`, `status = 'deleted'`.
- **Erase** `displayName`, `email`, `token`, `shortCode`.
- **Keep** every transaction, reward and audit row, still pointing at the id.

The ledger stays internally consistent and shop totals stay correct; nothing on the row
resolves to a person; the dead token can never be scanned again. Erasing the email also
**frees the address for re-registration**, which is correct after a deletion request — the new
card starts at zero. Rejected alternative: repointing rows to a shared "deleted" id, which
destroys per-card history and can corrupt reward integrity.

Deletion must be a **server** operation (the maintainer's note on FE-C-14), not a local wipe.

### 3.4 Email uniqueness (FE-C-02 follow-on)
**One card per email address.** Registering with an address already in use offers recovery
instead of creating a second card. Enforced by a unique index over active customers — the
tombstone's erased email (§3.3) does not occupy the address.

### 3.5 Credential transport (BE-A-02)
The maintainer asked for credentials to be sent "obfuscated" rather than plaintext.
**Recorded, and not implemented as stated**, because client-side hashing does not achieve it:
whatever the client sends *is* the credential, so a captured hash is replayed directly. It
renames the secret rather than protecting it — the same defect as BACKEND-PLAN §4-A, arriving
from the other side.

**What is being built:** TLS in transit (encrypts the whole request body), argon2id at rest,
the PIN and password never in a URL, a log, or an error, and rate-limited attempts.

**Not being built unless asked:** a password-authenticated key exchange (OPAQUE / SRP), which
genuinely never transmits the secret. It is real, and it would be the most complex component
in this codebase, for a café with a handful of staff accounts. Flagged as disproportionate;
the maintainer's call.

### 3.6 PIN uniqueness dropped (BE-D-02)
The maintainer's reasoning is correct and has a second consequence worth stating: enforcing
global PIN uniqueness requires comparing a new PIN against every other account's PIN, which is
only possible while they are readable. With argon2id-hashed PINs it is **not implementable at
all** — and it is no longer *needed*, because `BE-A-02` verifies a PIN against an account the
device has already identified, rather than searching all accounts for a match. The uniqueness
constraint leaves the schema; `StaffService.assertPinUnique` goes with it.

> **Moot from 2026-10-03:** the PIN itself is removed (§6.3). §3.5's "PIN … never in a URL, a log,
> or an error" stands for the password; the PIN no longer exists to protect.

---

## 4 · Answered (was: open questions)

All seven answered by the maintainer on 2026-09-15. Kept numbered for reference.

| # | Question | Answer |
|---|---|---|
| **Q1** | FE-A-09 — is "number of drinks on card" the threshold or an independent grid size? | **The threshold.** X drinks earn a reward, configurable; the grid follows as `threshold + 1` (X earnable + the free cup). No new field, no decoupling. |
| **Q2** | BE-A-02 — credential transport? | **TLS + argon2id.** No PAKE. §3.5 stands as written. |
| **Q3** | FE-C-14 — re-registering a freed email address? | **Confirmed:** a new card starting at zero. The deleted card is gone and is not restored. |
| **Q4** | FE-S-06 — release the camera after 60s idle? | **No — fix the permission at the root instead.** See §4.1. |
| **Q5** | BE-D-10 — internal function, no route? | **Yes.** Internal only; no endpoint, no export. |
| **Q6** | FE-S-12 — return to the counter after a commit? | **Yes.** Counter home, not straight back to the camera. |
| **Q7** | FE-R-01…09 — stay removed? | **Yes**, all nine. Post-commit undo especially. |

### 4.1 Camera permission (Q4) — new scope

The maintainer's objection is correct: a 60-second timeout that buys a fresh permission
prompt is worse than either extreme. A one-time request is acceptable; a recurring one is not.
Two facts found while answering:

- `src/qr/scan.ts` calls a full `scanner.stop()`, which **releases the camera device** — that
  is what provokes the re-prompt. The "kept warm" note in `STATUS.md` describes an intent the
  code does not implement.
- The repo has **no web app manifest and no iOS standalone meta tags**, so there is no
  installed-app story today.

**Decided, in order:**

1. **Install the till as a home-screen web app.** iOS grants camera permission to an installed
   web app once and keeps it for that instance — there is no new browsing session to re-prompt
   for. Needs `manifest.json`, icons, and `apple-mobile-web-app-capable`. Suits a till anyway:
   dedicated device, full screen, no browser chrome. **Constraint:** camera access inside an
   installed iOS web app requires **iOS 16.4+**; below that it does not work at all and the till
   must stay in Safari.
2. **Safari fallback, one-time setup:** iOS Website Settings → Camera → Allow, set once on the
   till device. Documentation, not code.
3. **Then stop the camera freely.** Once a re-prompt costs nothing, release the device on
   leaving the scan view and after idle — full power saving *and* the camera indicator light
   goes out, which matters with a lens pointed at a customer across the counter.
4. **Between customers, `pause()` / `resume()`, never `stop()` / `start()`** — html5-qrcode
   supports both; pausing never releases the device, so it cannot prompt even without step 1.
   This is a straight fix to `qr/scan.ts` and is worth doing regardless.

This is **scope the triage did not contain** — added because it is the answer to Q4. It lands
with the staff-counter work in Phase 6; step 4 can land any time.

---

## 5 · Documentation this contradicts (reconcile before implementing)

These are maintainer decisions overriding written rules; the rules need rewriting rather than
quietly contradicting. A Scribe pass owes each of these an edit:

| Document | Rule | Now |
|---|---|---|
| `CLAUDE.md` non-negotiables | "PII is optional… Support a fully token-only account." | **False.** Name and email are required (§2.1). |
| `CLAUDE.md` goals | Goal 4, "Minimal, mostly-optional personal data." | Personal data is now mandatory and minimal. |
| `CLAUDE.md` non-negotiables | `WalletProvider` port is a required seam. | **Deleted.** |
| `CLAUDE.md` non-negotiables | `Transport` port is a required seam; PeerJS is the prototype transport. | Port **deleted**; PeerJS survives only as prototype device pairing. |
| `CLAUDE.md` UI | Card menu has two entries (remember/remove + delete). | One entry: delete. |
| `SPEC.md` §15 / `STATUS.md` | Optional-PII and token-only registration; wallet acceptance rows. | Rows retire. |
| `STATUS.md` | Admin stats, breakdowns, export workflow as shipped features. | Collected, not surfaced. |
| `INTEGRITY-PLAN.md` | Export workflow is the sanctioned route to cross-account activity. | No route at all — database access only. |
| `CLAUDE.md` architecture *(2026-10-03)* | Sessions carry a 5-minute idle lock, enforced server-side. | **Retired** (§6.3). Sessions run to their TTL — 30 days remembered, 12 hours otherwise. Removed from the server in UI-1b (2026-10-04, `backend-v1`); `CLAUDE.md` annotates the bullet. |
| `CLAUDE.md` non-negotiables *(2026-10-03)* | "Every staff/admin action writes an audit entry." | **Still true, with a stated limit** (§6.3): the entry names the *account* that was signed in, not the person at a shared till. `CLAUDE.md` now says so. |
| `CLAUDE.md` non-negotiables *(2026-10-03)* | "No mocked customer workflows" carves out a fake `DataStore` in the SPA's tests, held to the conformance suite. | **Withdrawn** (§6.5). Screen tests stub services; service tests hit the real server. Amended in `CLAUDE.md`. |
| `CLAUDE.md` UI *(2026-10-03)* | Staff/admin auth uses a quick PIN (`Unlock`, `PinPad`, `AuthContext.unlock`), the admin sheet has "reset PIN", Add profile takes a PIN, and program-config save / sign-out-all are step-up gated. | **Superseded** (§6.3, §6.4): no PIN anywhere; step-up is a plain confirmation. Flagged in the box at the top of `CLAUDE.md`; UI-9 rewrites the section. |
| `STATUS.md` *(2026-10-03)* | Step-up PIN re-auth (divergence **j**, Known gaps) and the idle-lock / PIN acceptance rows as shipped. | Annotated as superseded; the rows retire when UI-1b and UI-3 land. |

The prototype keeps its current behaviour until the backend build reaches each item; these
edits land with the work, not before.

---

## 6 · Later decisions (after the triage)

### 6.1 · 2026-09-16 — the backend is built first, and the UI follows it

The maintainer revoked [`BACKEND-PLAN.md`](BACKEND-PLAN.md)'s founding promise (*no UI or service
rewrite*):

> *"We are preparing the backend now. We do it the way it needs to be done without consideration
> for the UI. Once backend work is complete, we will adjust UI, taking the backend as ground
> truth, and marking conflicts for confirmation."*

**What it changes.** `ports/DataStore.ts` and `src/services/` become editable, so the fixes that
were forced to the route boundary purely to keep a shared file untouched can be taken properly
(BACKEND-PLAN §4). The three "this is where the promise is under pressure" problems —
`LoyaltyService.getAlerts`, `RecoveryService`, and the offline posture — stop being constraints
to design around and become UI-pass decisions.

**What it costs, stated once.** The UI is knowingly left broken for the duration: from the phase
that deletes `IndexedDbStore`, the SPA does not build, and the release gate is the server suite
plus the server typecheck. There is **no demoable build** until the server-backed UI is
deployable.

**The mechanism.** Every backend-vs-UI conflict is recorded in
[`UI-RECONCILIATION.md`](UI-RECONCILIATION.md) as it is created, with a status saying whether the
triage already answers it or the maintainer still has to. The UI pass starts from that register
with the maintainer's confirmations against it, not from discovery.

### 6.2 · 2026-09-16 — the IndexedDB prototype is retired, not frozen

Asked what the prototype was *for* once the port was free to change for the server's benefit, the
maintainer chose retirement over freezing it or keeping it in lockstep.

BACKEND-PLAN §2 had locked the opposite ("stays fully working and is not deleted") for three
reasons: it is the demo, it is the reference implementation, and it is how the swap is proven
behaviour-preserving. **The third is void** — §6.1 drops behaviour preservation as a goal — and
the first two do not justify mirroring every server-shaped port change into a second adapter.

Deleted in Phase 6: `IndexedDbStore`, `src/adapters/sync/` (PeerJS pairing), `src/adapters/transport/`
+ `ports/Transport.ts`, `src/adapters/wallet/` + `ports/WalletProvider.ts`, `EmailJsMailer`,
`demoSeed` and the preset tokens, the `VITE_*` adapter flags, and the GitHub Pages deploy; plus
the `peerjs` and `idb` dependencies. The shared conformance suite survives as `PostgresStore`'s
specification rather than as a cross-store contract. The prototype's *screens* go in the UI pass.

**Net architectural effect, updated:** the triage took five swappable seams to three. This takes
three to **one implementation each** — `PostgresStore`, `SmtpMailer`/`LogMailer`, and a
server-cookie `IdentityStore`. The ports remain as the boundary; what goes is the second
implementation behind each.

### 6.3 · 2026-10-03 — the staff device is a shared till; the PIN and the idle lock go (register S1)

Two decisions had been staged since 2026-09-17: retire the staff PIN, and settle what that does to
attribution. The open question was whether the staff device is a shared till or each person's own
phone. **It is a shared till.**

**Decided.**
- **No "who's on shift" picker.** It would mix *shift* identity with the signed-in account's
  *privileges* — the two must not be mixed — and a picker cannot stop an employee picking another
  employee's name. It would look like attribution without being any.
- **Attribution is the signed-in account.** The guard is behavioural: staff and owner log out, or
  use their own phones.
- **No idle lockout, and the PIN is removed completely.** Gone: `POST /auth/unlock`, `IDLE_LOCK_MS`
  and the idle-lock check in `auth/guards.ts`, the `pin` column, `setStaffPin` and PIN
  verification, `BOOTSTRAP_ADMIN_PIN`, `PinPad`, the Unlock screen, `AuthContext.unlock`, "reset
  PIN" in the admin account sheet, and PIN on Add profile. The reasoning staged on 2026-09-17
  stands: a device already behind its own passcode, running a page people stay signed into, is
  not meaningfully protected by a 4-digit code every member of staff knows — friction without
  security. It can come back later if it is ever wanted.
- **"Remember me" persists a login.** A rudimentary version now — the server already splits
  `REMEMBERED_TTL_MS` (30 days) from `EPHEMERAL_TTL_MS` (12 hours) in `auth/sessions.ts`. A
  **security-hardening round on remember-me comes later: deferred, not dropped.**

**The consequence, stated plainly.** Audit rows, the counter's "your last hour", and both alert
detectors (self-dealing, repeat-target) are **per account, not per person at the till.** On a
shared till, whoever is signed in carries every transaction made under that session: a detector
flags an *account*, so it can name someone who was not there and cannot tell two colleagues at the
same till apart, and "your last hour" is the account's, not the person's. `CLAUDE.md`'s "every
staff/admin action writes an audit entry" stays true — but the entry names the account that was
signed in. This is accepted, with the behavioural guard above as the mitigation; the name-tap
alternative in the staged notes is the picker rejected above.

**Work.** Server **and** port: it touches `packages/server` and `packages/shared/src/ports/`
(`DataStore` loses the PIN methods), and lands **before UI-2** so UI-2 does not rebuild PIN logic
only to delete it. It is its own plan phase, **UI-1b** ([`UI-PLAN.md`](UI-PLAN.md)), done when the
server and shared suites are green. **Implemented 2026-10-04** (UI-1b): the server and port half
is done as listed, `@cafe/server` is at 439 tests and green; the SPA half (`PinPad`, Unlock,
`AuthContext.unlock`, "reset PIN", the PIN on Add profile) remains for UI-2 / UI-3.

### 6.4 · 2026-10-03 — admin step-up becomes a plain confirmation (register A7)

The admin `StepUp` sheet (program-config save, "Sign out all devices") re-authenticates by PIN, but
the server never enforced step-up — `PATCH /config` and `POST /auth/logout-all` only `requireAdmin`.
The gate lived only in the browser. With the PIN gone it becomes a plain **"Are you sure?"
confirmation** — no credential, and no claim to be a security boundary. Per-profile account actions
were never gated and stay that way.

### 6.5 · 2026-10-03 — no fake `DataStore`; the service tests run against the real server (register P6)

The earlier recommendation — a fake in-memory `DataStore`, held to the conformance suite — is
**reversed**. There is a proper backend. The SPA's service suites (and `ApiStore`) are tested
against **the real server and a test Postgres**, with the server suite's discipline: they fail, they
do not skip, without a database. Screen and component tests already stub at the **services** level
(`vi.fn()` through `ServicesProvider`), so isolated UI testing never needed a fake store.

This **withdraws the one exception** in `CLAUDE.md`'s "No mocked customer workflows" rule. Two work
items fall out: a **dev seed** for the backend, kept until release (what the deleted `demoSeed`
provided), and — because Node's `fetch` keeps no cookies — a **cookie jar** in the SPA-side
integration tests.

### 6.6 · 2026-10-03 — the branch is tagged, not merged

`claude/backend-implementation-2kqb08` is **not being merged into `main` yet**. It is **tagged** when
the backend is deemed complete enough and the UI rewire starts; the natural point is right after the
PIN-removal phase (**UI-1b**) lands. This replaces the earlier framing of the merge as an
outstanding decision. `main` still carries none of the server, the three-package layout or any
decision document: a branch cut from it gets the pre-triage `CLAUDE.md` and no server, so new work
is cut from this branch (or, once it exists, the tag). **Done 2026-10-04:** the tag is
**`backend-v1`**, on the commit that landed UI-1b.

### 6.7 · 2026-10-03 — smaller settlements, recorded in the register

Four more register rows were answered the same day; each row carries its own text.
- **X2 — the error surface.** One classifier in `ApiStore.request`; three routing rules by scope
  (session → global only, connectivity → both, action → local only); background failures silent.
- **P7 — `AuditService`.** The `audit.log` calls leave the SPA services; the client write path goes.
- **X7 — config staleness.** Next-load is fine; a `program` push scope stays the cheap upgrade.
- **X5 — the SPA's environment.** Base `/`; `VITE_API_BASE` stays. **Constraint recorded:** a
  GitHub Pages–hosted SPA cannot talk to this backend, because the session cookie needs the SPA
  and the API on the same site.
