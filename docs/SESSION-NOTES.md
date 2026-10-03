# Session notes — uncommitted decisions, 2026-09-17

> **Why this file exists.** Two decisions were taken in conversation after UI-0 landed and had
> nowhere in the repo to live yet: the **shape of the error surface** (register row **X2**) and
> **retiring the staff PIN** (row **S1**). The maintainer is picking the work up with a separate
> agent on a local branch, so they are written down here rather than left in a chat log.
>
> **These supersede the recommendations in [`UI-PLAN.md`](UI-PLAN.md) §1 for X2 and S1.** When
> those rows are implemented, fold the content into
> [`UI-RECONCILIATION.md`](UI-RECONCILIATION.md) / [`SCOPE-DECISIONS.md`](SCOPE-DECISIONS.md) and
> delete this file — it is a staging area, not a permanent document.
>
> **Branch note.** Everything else discussed is already committed. This branch
> (`claude/backend-implementation-2kqb08`) is **28 commits ahead of `main`** and `main` has **none**
> of it — not the server, not the three-package layout, not any decision document. A branch cut
> from `main` is missing the entire backend.

---

## 1 · X2 — where errors surface  ·  **status: awaiting confirmation, blocks UI-1**

`UI-PLAN.md` §1 records this as "adapter-level", which is an incomplete answer: the adapter cannot
render anything. The question has two halves and conflating them is what made the row murky.

### Half one — who classifies a failure (not really a decision)

`ApiStore.request` turns every failure, whether a raw `fetch` rejection or a non-2xx response, into
**one typed union**: `offline`, `locked`, `forbidden`, `rate_limited` (carrying `retry-after`),
`email_in_use`, `conflict`, `server`. No screen parses a status code. There is no good argument for
the alternative — twenty screens classifying independently will disagree within a month.

### Half two — where it is *shown*, which depends on scope

| Scope | Examples | Where it surfaces |
|---|---|---|
| **Session** | session expired, "sign out all devices", account disabled or deleted | **Global only.** One central handler routes to sign-in. No screen handles it. These invalidate the whole view, not one action; per-screen handling means every screen reimplements the same thing and one gets it wrong. |
| **Connectivity** | offline, 5xx, timeout | **Both.** A persistent global banner (it affects anything they try next) **and** the failure reported at the point of action. |
| **Action** | `409 email_in_use`, `over_cap`, `already_spent`, a rate-limited form | **Local only**, on the field or control that needs fixing. Never a toast or banner. |

### Three things that fall out of it

- **Connectivity genuinely needs both halves.** A global banner alone is the trap: staff tap "add
  points", see a banner, and cannot tell **whether the points landed**. With the 3-second
  pre-commit hold in the flow, "did that write or not" is precisely the question they will have —
  so the failed action must report where it happened, and **the staged transaction must survive for
  retry** (only the Scan screen can do that; see SCOPE-DECISIONS §2.4, which already fixes the
  staff-side copy).
- **Background failures stay silent.** When `GET /events` reports a change and the refetch fails,
  nobody asked for anything; interrupting them is noise. It retries, or goes quietly stale. Only
  user-initiated actions report. (Relevant to UI-5.)
- **`retry-after` is data, not decoration.** A rate-limited sign-in disables the button and counts
  down. It does not say "too many attempts" and let someone mash it.

**Open:** confirmation that the three-scope split is how it should feel. UI-1 builds the classifier
and the global handlers; UI-4 builds the local halves — which is why they are separate phases.

---

## 2 · S1 — retiring the staff PIN  ·  **status: decided in principle, one question open**

### Decided

**The PIN goes, and the session runs long.** The maintainer's reasoning: a device already behind its
own passcode, running a page people stay signed into, is not meaningfully protected by a 4-digit
code every member of staff knows. The PIN is friction without security. It can come back later if
it is ever wanted.

### What is already built (verified in `packages/server/src/auth/sessions.ts`)

```
REMEMBERED_TTL_MS = 30 days      // "remember me until I sign out"
EPHEMERAL_TTL_MS  = 12 hours     // "one sign-in per day"
IDLE_LOCK_MS      = 5 minutes    // the only thing forcing re-auth mid-shift
CUSTOMER_TTL_MS   = 365 days
```

Both of the maintainer's suggestions — a 12-hour session, and a proper remember-me — **already
exist**. Nothing makes staff sign in again during a shift except the 5-minute idle lock. So the
change is surgical, not a session redesign:

- drop `IDLE_LOCK_MS` and the idle-lock check in `auth/guards.ts`,
- retire `POST /auth/unlock` (`routes/auth.ts`) and the PIN verification behind it,
- the `pin` column, `setStaffPin`, `verifySecret` on PINs and the `PinPad` UI become dead,
- `AuthContext.unlock` and the `/staff/unlock` screen go with them.

This is **backend work** as much as UI work, and it is the first change since Phase 9 to touch
`packages/server`. The server suite must stay green.

### The open question — attribution, not security

**The PIN was not protecting the device. It was establishing who was holding it.**

`packages/shared/src/domain/alerts.ts` keys both detectors on `staffId`, and `staffId` comes from
the session. On a shared till with a 12-hour session, Sam signs in at 07:00 and every coffee Priya
adds at 15:00 is recorded as Sam. Three things the triage deliberately kept then degrade:

- **Self-dealing detection** ("same staff credited then redeemed the same card within
  `selfDealWindowSec`") becomes "same *till*" — which is every transaction. It goes silent, or
  flags someone who was not there.
- **"Your last hour"** on the counter becomes the terminal's history, not the person's.
- **The audit log names the wrong person**, permanently and unfixably.

None of this is about the device being stolen. It is purely about who the rows say did the work.

**Three ways out, and which applies depends on one fact nobody has stated yet — whether the staff
device is a shared till on the counter or each staff member's own phone:**

| If… | Then |
|---|---|
| **Each staff member uses their own phone** | The session **is** the person. Attribution is correct for free, both detectors keep working, and the PIN and idle lock go with nothing lost. The maintainer's instinct is simply right and there is no cost to discuss. |
| **One shared till, attribution still wanted** | Replace the PIN with a **no-friction "who's on shift" name-tap** — tap your name when you take over, no credential, one tap per shift change. Attribution survives; it is not a security gate and should not look like one. |
| **One shared till, per-till attribution accepted** | Redefine the actor as **the terminal**, not the person. Detectors catch a till behaving oddly rather than a person. Defensible for a single café where the owner knows who was on — but `CLAUDE.md`'s "every staff/admin action writes an audit entry" then promises more than it delivers, so **the docs must say so explicitly**. |

**Status:** the maintainer's answer was "let's talk about it" — the device model is undecided, and
the PIN removal should not land until it is, because the three outcomes differ in what replaces it.

---

## 3 · Still open, and already recorded in the repo

These need no restating here — they are in [`UI-PLAN.md`](UI-PLAN.md) §1 with recommendations:

- **P7** — remove the `audit.log` calls from the services rather than making `AuditService` a no-op.
- **P6** — a fake in-memory `DataStore` for the service suites, built **inside** UI-2.
- **X5** — what the SPA's environment actually is (UI-6 decides, with the nginx story in hand).
- **X7** — whether a config change should push to open cards.

## 4 · The one thing that is not a decision

**`main` has none of this work.** 28 commits: the whole backend, the three-package workspace, CI,
the Compose bundle, and every decision document. A clean clone, or any branch cut from `main`,
gets the pre-triage `CLAUDE.md` (five ports, PII optional, prototype framing) and no server at all.
Merging is the maintainer's call and has been outstanding for several sessions.
