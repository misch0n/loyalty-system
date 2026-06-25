# Rewards rework — decision log & reasoning

> The *why* behind every choice in `REWARDS-PLAN.md`. ADR-style: each entry is
> **Decision · Why · Rejected · Consequence**. Reference when a future session is
> tempted to "simplify" something — the reasoning is usually load-bearing.

---

## Foundations (adopting Appendices C + D)

### F1 — Rewards are first-class objects; points are consumed at mint
**Decision.** A reward is a discrete `Reward` object **minted** (with `pointsPerReward`
consumed in the same atomic step) the moment an accrual pushes `balance ≥ threshold`.
`balance` then means only *progress toward the next reward* (settles `0…threshold−1`);
"N free coffees" = count of **unspent** `Reward` objects.
**Why.** The implicit `balance ≥ threshold` boolean can't represent discrete, countable,
ownable rewards. Three needs force objects: (1) **stacking** — someone who kept buying should
see "3 free coffees", not a balance three times over the line; (2) **forgot-card** — earning
more while a prior reward is unredeemed must accumulate, not stall; (3) the **gifting seam** —
a reward can only be passed on if it exists apart from the card. Consuming at mint keeps the
balance from sitting above threshold and makes the card UX fall out directly (stamp grid =
`balance mod threshold`; count = unspent rewards — two independent derivations).
**Rejected.** Keeping the derived boolean / counter+flag — can't stack, can't gift, stalls on forgot-card.
**Consequence.** New `Reward`/`RewardEvent` entities; `reward_issue` ledger type replaces the
old redemption subtraction; "redemption" moves to the reward side.

### F2 — Reward event log is truth; the `Reward` row is a projection
**Decision.** Reward lifecycle is a **fold over an append-only `RewardEvent` log**; the `Reward`
row (with `status`) is a **materialized projection** for fast reads + the redemption lock.
**Why.** Preserves the append-only philosophy (same as `balance` = fold over the points ledger).
Nothing is mutated in place; corrections are new events. The projection gives O(1) reads and a
concrete row to lock at redemption.
**Consequence.** `status` is never edited except as a projection of appended events (an invariant + test).

### F3 — Redemption is a transaction *attribute*, never a gated action
**Decision.** A counter transaction is "customer X, add N points, redeem rewards [list]" — any
field may be empty; staff can add points **and** redeem in one commit. Staff actions are **never**
branched on which QR arrived; the QR type tag gates **validation**, not available actions.
**Why (D0/D2).** A real visit can be both — one free drink + one paid. Branching the UI on QR
type is artificial and worse UX. The source tag's only jobs are per-source validation and
wallet-vs-app analytics; it grants no extra trust (a webapp scan is not "more authenticated").
**Consequence.** The unified `commitCounterTransaction`; a reward scan only **pre-attaches** rewards.

### F4 — No per-transaction freshness / rotating code (pinned — do not re-litigate)
**Decision.** The card QR is **identification only** — a static opaque token + source tag, no
freshness, on every path. The reward QR adds **owner binding** for integrity, not possession proof.
**Why (D3).** The wallet pass barcode is static and unmutatable — it sets the security *ceiling*,
so any freshness scheme on the webapp is effort spent on one door while the door beside it stays
open. Freshness doesn't prove possession anyway (a screenshot taken in-window is valid; the
victim's unlocked phone is valid). The manual short-code fallback can't carry freshness, and a
"dynamic short code" goes stale for a customer who loaded the page minutes ago in line — worse UX
than the threat it prevents. The real control is the **human at the counter** (needs the unlocked
phone or a visibly-a-photo screen — adequate for one-coffee value). The malicious-**staff** threat
needs no customer QR at all — it's covered by the attributed append-only ledger + named accounts +
anomaly alerts, not customer-side QR validation.
**Consequence.** Simpler scanning; integrity comes from owner binding + **re-validation at commit**, not time.

### F5 — Atomicity via a single IndexedDB transaction (prototype fidelity)
**Decision.** The prototype gets atomicity from **one multi-store IDB `readwrite` transaction**;
there is no row lock.
**Why.** IndexedDB has no `SELECT … FOR UPDATE`. A single transaction over every touched store
is the strongest guarantee available, and matches how the existing atomic redeem already works.
**Rejected.** Faking a lock (extra reads/flags) — adds complexity without a real guarantee.
**Consequence.** Recorded as a divergence; the whole commit must fit one tx. Production swaps to real row locks.

---

## Gating decisions (Q1–Q14)

### Q1 — `commitCounterTransaction` is the single atomic entry
**Why.** D6 requires accrual + mint + redeem-N to be **one** atomic, idempotent transaction. Two
separately-awaited calls (`appendAccrual` then `redeemReward`) **cannot** be atomic — a failure
between them leaves inconsistent state. So one method does everything in one DB tx;
`appendAccrual`/`redeemReward` are demoted to internal helpers. `CommitResult` is a discriminated
union so callers get either `{ok:true, state, …}` or a typed error.

### Q2 — Clean reset to v5, no migration
**Why.** It's a prototype — **no live customer data to protect**. Converting existing
over-threshold balances + `redemption` entries into `Reward` objects was the single **riskiest**
piece (lossy if wrong, and it would have to run in the post-open backfill to avoid the Safari
`versionchange` hang). Since the data is disposable, dropping + recreating stores on the v5 bump
and reseeding in the new model **eliminates that entire risk class**.
**Consequence.** v5 upgrade just recreates; `demoSeed` rewritten in the reward model.

### Q3 — Maintainer owns the wallet pass URLs
**Why.** The prototype wallet passes are **pre-generated on walletwallet.dev with fixed baked-in
barcodes** the app can't change, and we don't control/know the exact baked payload. The maintainer
will provision the pass URLs (embedding the new card-QR format), so it isn't a blocker for the app.
**Consequence.** The app publishes the URL contract (`…/#/c/<customerToken>?s=w`) and keeps the
scanner **backward-compatible** so any old baked passes don't hard-fail.

### Q4 — Drop `deviceId`
**Why.** D6 lists `deviceId` for "attribution/alerts," but the alerts key only on **staffId**, and
the anti-fraud anchor is the **named-staff attributed append-only ledger** (the staff *is* the
trusted terminal). In a single café, `deviceId` only helps a hypothetical future multi-terminal
fraud check — marginal value for real plumbing now.
**Consequence.** `CounterTransaction` omits it; reserve and expand later if a real need appears.

### Q5 — Real idempotency dedup store (not a stub)
**Why.** Low effort — one small store keyed `idempotencyKey → CommitResult`, checked at the start
of the commit tx. It's the **correctness guarantee for the paired-device RPC path**, where the
client has a 10s timeout and can retry → double-apply without dedup. Cheap + correct beats stub + divergence.

### Q6 — Reject `over_cap` (don't silently clamp)
**Why.** It concerns `pointsDelta` (the "add N coffees" amount) exceeding `maxPointsPerTransaction`.
The current code silently **clamps**, which hides input errors. Rejecting makes the server contract
honest. The staff slider stays bounded so the UI never trips it; the reject guards the manual/RPC path.

### Q7 — Source tag on the audit entry, store-don't-surface
**Why.** D2 wants wallet-vs-app trackable "for free." A `source: 'a'|'w'` field on the **audit**
entry captures it with **no new store** and makes it queryable later. The maintainer wants it
*available* later but with **no surface requirement now** — so store it, build no UI.

### Q8 — Reward short codes: manual path **only** (not in the QR)
**Why (evolved).** D7 called per-reward short codes optional. The composite flow *seemed* to need
them in the QR (assumed N full 128-bit tokens wouldn't fit). But **measured QR capacity disproved
that** — full tokens fit to ~10 ids at v12 (~65px, comfortably scannable). So short codes are **not**
needed in the QR; they're still added but **only for the manual / camera-fail path** (parity with
the customer short code). This removed the dual-encoding complexity (the old M2/M3).

### Q9 — Undo: 5-second window + re-mint a replacement (don't un-spend)
**Why.** C6 forbids un-spending a spent reward (append-only integrity). To still make the customer
whole, undo **mints a new replacement reward** (`reward.issued`, reason `undo_reissue`) — the
original stays `spent` in history. A **5-second window** bounds it to a quick "oops" affordance;
after that, corrections go through the admin reversal flow. Undo covers the **whole** counter
transaction: reverse the points, void any **freshly-minted** (unspent) reward, re-mint replacements
for any **spent** ones.
**Consequence.** Replaces the old "reverse last ledger entry" undo.

### Q10 — `/c` and `/r` are staff-scan URLs only
**Why.** These URLs are scan **envelopes** the staff terminal parses, not customer destinations. A
customer reaches their card via the app/identity, not by scanning their own QR — so making them real
customer routes adds surface for no v1 benefit.

### Q11 / Q12 — Full reward tokens in the QR; single = 1-element composite
**Why.** Measured: full 22-char tokens fit to ~10 ids at v12 (~65px), easily scannable
phone-to-phone. The maintainer preferred full ids if they fit. **Unifying** single and composite onto
one encoding (a single reward is a 1-element list) means **one route, one parser, no special-casing**
— simpler and less error-prone than maintaining two encodings.

### Q13 — Subset redeem (not all-or-nothing)
**Why.** With N pre-attached rewards, one might become spent/invalid between scan and commit.
All-or-nothing would block the whole redemption for one stale item — bad UX at the counter for a
one-coffee value. **Redeem the valid ones, report the rest in `rejected[]`**; the human is present to
see what happened. The commit stays atomic over the valid set.

### Q14 — Composite cap = 10
**Why.** Full-token QR capacity stays comfortably scannable through ~v12–13 (≈65–69px) at N=10; v15
(N=15) is the practical ceiling for screen-to-screen scanning with the dot style. A customer
realistically never has more than a handful of rewards, so 10 is generous with a comfortable scan
margin (hard ceiling 15).

---

## Measured evidence behind the QR decisions (Q8/Q11/Q12/Q14)
Composite payload `…/#/r?ids=<ids>&c=<full customer token>&s=a`, error-correction M:

| rewards | full tokens | short codes |
|--|--|--|
| 1 | v6 · 41px | v5 · 37px |
| 5 | v9 · 53px | v7 · 45px |
| **10** | **v12 · 65px** | v9 · 53px |
| 15 | v15 · 77px | v10 · 57px |

Reproduce with `qrcode`'s `QRCode.create(url,{errorCorrectionLevel:'M'}).modules.size`
(version = `(size − 17) / 4`). v6–13 scan easily phone-to-phone with the dot style.
