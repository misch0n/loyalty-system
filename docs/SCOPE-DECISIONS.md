# Scope decisions — maintainer triage (2026-09-02)

> **Authoritative record of the feature triage.** The maintainer reviewed all 123 features
> (everything the prototype ships plus everything the backend plan proposed) and marked each
> keep / drop / change. This file is the outcome: what is being built, what is being deleted,
> and what changes shape. It **supersedes** earlier scope statements in
> [`BACKEND-PLAN.md`](BACKEND-PLAN.md), and where it contradicts `../CLAUDE.md` or
> [`SPEC.md`](SPEC.md), the contradictions are listed in §5 to be reconciled.
>
> Tally: **89 keep · 18 drop · 6 change**, plus 10 already-removed items confirmed to stay out.

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
Adds "number of drinks on card". **Open question (§4):** the grid is currently the reward
threshold plus the free cup and follows the threshold automatically — confirm whether the
displayed card size should become independent of the threshold.

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

---

## 4 · Open questions

1. **FE-A-09** — should the card's displayed cup count be independent of the reward threshold
   (e.g. a 12-cup card rewarding at 9), or does "number of drinks on card" just mean the
   threshold, which is already configurable?
2. **BE-A-02** — TLS + argon2id (recommended), or the PAKE?
3. **FE-R-01…09** — the already-removed features were left undecided; treated as **staying
   removed**. Post-commit undo in particular stays out, consistent with keeping the
   pre-commit hold.

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

The prototype keeps its current behaviour until the backend build reaches each item; these
edits land with the work, not before.
