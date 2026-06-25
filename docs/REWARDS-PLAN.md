# Rewards-as-objects — build plan (Appendices C + D + multi-reward)

> **Active initiative.** Reworks rewards from an implicit `balance ≥ threshold` boolean
> into discrete, countable, ownable **`Reward` objects**, plus a unified scan/commit
> contract and customer-driven **multi-reward composite redemption**.
> **Supersedes** SPEC §6 (reward derivation), §8.2/§8.3 (scan/commit), and refines B2.

---

## 0 · HOW TO USE THIS ACROSS SESSIONS (read first)

This file is written so work can continue **with context cleared between tasks**.
The maintainer starts fresh sessions to save tokens. Each phase below is an
**independently executable task** with explicit inputs, files, and done-criteria.

**Resume protocol for a new session:**
1. Read `docs/STATUS.md` (current state) and this file.
2. Find the first **unchecked** box in the *Progress* checklist below — that's the next task.
3. Do **only that phase**. Stay within its file list. Honour the architecture rules in `../CLAUDE.md`.
4. Before committing: `npx tsc --noEmit` + `npm test` + `npm run build` must all pass.
5. Tick the box here, update the `STATUS.md` "Last updated" line, commit + push to `main`.
6. Stop. The next session picks up the next box.

**Source appendices:** the full text of Appendix C (rewards-as-objects), Appendix D
(scan/transaction contract), and the multi-reward UX refinement were provided by the
maintainer **in-session** (not in-repo). The *actionable distillation* — decisions,
contracts, and acceptance criteria — is captured below and is sufficient to build. If
deep rationale is needed, ask the maintainer to re-paste the appendix. Gifting/transfer
(`GIFTING-WORKFLOW.md`) is **deferred** — schema-reserved enum values + commented seams only.

---

## 1 · Progress checklist

- [x] **Phase 0** — Contracts & types (no behavior)
- [x] **Phase 1** — Pure domain + unit tests
- [x] **Phase 2** — Storage adapter + schema v5 + new seed (the core)
- [ ] **Phase 3** — Services
- [ ] **Phase 4** — Sync / RPC allow-list
- [ ] **Phase 5** — Scan parser + staff Scan UI (unified commit + 5s undo)
- [ ] **Phase 6** — Customer card UI (reworks shipped overlay + badge)
- [ ] **Phase 7** — Wallet hooks
- [ ] **Phase 8** — Docs (STATUS divergences + acceptance rows)

Phase 0+1 can land together (safe, no behavior). Phase 2 is the big one. 5 & 6 are UI.

---

## 2 · Locked decisions (settled with the maintainer)

> **The reasoning behind each of these — trade-offs considered and alternatives rejected —
> is in [`REWARDS-DECISIONS.md`](REWARDS-DECISIONS.md).** Read it before "simplifying" any of them.

| # | Decision |
|---|---|
| Migration | **None.** Prototype only — clean reset to **schema v5**: upgrade drops & recreates stores, then seeds fresh in the new model. |
| Commit | **`commitCounterTransaction`** is the single atomic mutation entry (accrual + mint + redeem-N), **idempotent**. `appendAccrual`/`redeemReward` are internal helpers. |
| QR ids | **Full reward tokens** in the QR (single = 1-element composite). Reward **short codes** exist only for the **manual / camera-fail** path. Composite **cap 10** (hard 15). |
| over_cap | **Reject** (points add > `maxPointsPerTransaction`). Slider stays bounded; reject is the server-contract guard. |
| Partial redeem | **Subset redeem** — redeem the valid rewards, return the rest in `rejected[]`. |
| deviceId | **Dropped.** Not stamped/stored. Expand later if needed. |
| source tag | Stored on the **audit** entry (`source: 'a'\|'w'`), **not surfaced** now (available later). |
| Undo | **5-second window.** Reverse points, **void** any freshly-minted (unspent) reward, and **re-mint a replacement** reward for each reward spent in that commit (`reward.issued`, reason `undo_reissue`). A spent reward is never un-spent. Replaces "reverse last entry". |
| Routes | `/c` and `/r` are **staff-scan URLs only** (not customer-facing routes). |
| Wallet | Maintainer provisions wallet pass URLs. Wallet card QR = `…/#/c/<customerToken>?s=w`. Keep the scanner backward-compatible so old baked passes don't hard-fail. |
| Idempotency | **Real** dedup store (`idempotencyKey → CommitResult`). Low effort; correctness guard for the RPC-retry path. |

---

## 3 · Canonical contracts (lock before any phase)

### 3.1 Domain types — `domain/models.ts`
```ts
// 'redemption' is REMOVED from the points ledger.
type TransactionType = 'accrual' | 'reward_issue' | 'reversal';

interface LoyaltyTransaction {
  id; customerId; type: TransactionType; points; staffId;
  timestamp; note?; reversesTransactionId?;
  rewardId?;                 // set on reward_issue (and its reversal)
}

interface Reward {                       // materialized projection (cache for reads + locking)
  id; token;                             // 128-bit opaque; goes in the reward QR
  shortCode;                             // Crockford base32; MANUAL path only
  ownerId; status: 'unspent' | 'spent' | 'voided' | 'transfer_pending'; // last is RESERVED
  issuedAt; sourceTxnId;                 // the reward_issue txn that minted it
  descriptionSnapshot;                   // rewardDescription at mint (history-stable)
  spentAt?; spentByStaffId?;
}

interface RewardEvent {                  // append-only — SOURCE OF TRUTH for reward lifecycle
  id; rewardId;
  type: 'reward.issued' | 'reward.redeemed' | 'reward.voided'; // + reserved transfer_*/pooled
  customerId; staffId?; timestamp;
  details?;                              // e.g. { reason: 'mint_reversed' | 'undo_reissue' }
}
```

### 3.2 Derivation — `domain/loyalty.ts` (amend) + new `domain/rewards.ts` (pure)
```ts
balance(txns)        = Σ points            // now settles to 0..threshold-1
progress             = { current: balance, threshold }   // stamp grid; DROP rewardsAvailable
unspentRewards(rws)  = rws.filter(r => r.status === 'unspent').length
mintFold(balance,cfg): while balance >= threshold → emit reward_issue(-threshold) + one Reward
```

### 3.3 The commit (keystone) — `ports/DataStore.ts`
```ts
interface CounterTransaction {
  customerId; pointsDelta;          // 0..maxPointsPerTransaction
  redeemRewardIds: string[];        // 0..10 reward ids
  staffId; idempotencyKey; source: 'a' | 'w';   // NO deviceId
}

type CommitResult =
  | { ok: true; state: CustomerState;
      minted: Reward[]; redeemed: Reward[];
      rejected: { rewardId; reason: 'not_owner' | 'already_spent' | 'reward_invalid' }[] }
  | { ok: false; error: 'customer_not_found' | 'over_cap' };

commitCounterTransaction(txn): Promise<CommitResult>;  // ONE idb tx, idempotent
listRewards(customerId, status?): Promise<Reward[]>;
getCustomerState(customerId): Promise<CustomerState>;
undoCommit(idempotencyKey): Promise<CommitResult>;     // reverse + void fresh + re-mint spent
// redeemReward(rewardId, ownerId, staffId) — internal helper, not the public path
```

**Atomicity (prototype):** one IDB `readwrite` tx over
`config · transactions · rewards · rewardEvents · audit · idempotencyKeys`.
Order inside the tx: read the idempotency key → if present return the cached result with **no
writes**; else check `over_cap`/`customer_not_found` (short-circuit, no writes), append the
`accrual`, run `mintFold`, redeem each valid id (invalid → `rejected[]`, do **not** abort),
append audit (with `source`), persist the `CommitResult` under the key, commit. There is no
row-lock in IndexedDB — the tx scope is the lock (record as a divergence; prod = `SELECT … FOR UPDATE`).

### 3.4 CustomerState (one canonical shape) — `services/LoyaltyService.ts`
```ts
interface CustomerState {
  customer; config;
  balance;                       // 0..threshold-1
  progress: { current; threshold };
  rewards: Reward[];             // unspent (count drives the card); rewardAvailable boolean REMOVED
}
```

### 3.5 QR + routes (staff-scan only) — `qr/encode.ts`, `app/routes.ts`
```
card    .../#/c/<customerToken>?s=a|w
reward  .../#/r?ids=<rewardToken[,rewardToken...]>&c=<customerToken>&s=a   // 1..10, uniform
wallet  pass embeds  .../#/c/<customerToken>?s=w                           // maintainer provisions
manual  customer short code → full state + rewards list (per-reward short code optional pre-tick)

parseScan(text) → { kind: 'card' | 'reward', customerToken, rewardTokens: string[], source: 'a'|'w' }
```
**QR capacity (measured, EC-M):** full tokens — N=5 → v9, N=10 → **v12 (~65px, comfortably
scannable phone-to-phone)**, N=15 → v15. Hence full ids + cap 10. Short codes are not needed in
the QR (only manual).

### 3.6 Reward short code — `domain/tokens.ts`
Reuse the customer Crockford base32 machinery; new `byRewardShortCode` unique index. **Manual path only.**

---

## 4 · Phases (each = one task)

### Phase 0 — Contracts & types
- **Files:** `domain/models.ts`, `ports/DataStore.ts`, `services/LoyaltyService.ts` (type only), `adapters/storage/ApiStore.ts` (signatures).
- **Do:** add the §3 types + port signatures. No logic. Old code may keep compiling via temporary shims if needed.
- **Done when:** `tsc` passes; nothing wired.

### Phase 1 — Pure domain + tests
- **Files:** `domain/loyalty.ts`, new `domain/rewards.ts`, `domain/tokens.ts` (reward short code), tests in `tests/domain/` or co-located.
- **Do:** balance-settles derivation, `mintFold`, `unspentRewards`, per-reward validation predicate, cap check, undo decision (what to reverse/void/re-mint). All pure.
- **Done when:** unit tests cover mint-on-cross, multi-mint loop, validation, undo decision.

### Phase 2 — Storage adapter + schema v5 + seed  ⟵ the core
- **Files:** `adapters/storage/schema.ts` (DB_VERSION=5, new stores/indexes), `adapters/storage/IndexedDbStore.ts`, `adapters/storage/demoSeed.ts`, `adapters/storage/ApiStore.ts`, tests in `tests/adapters/`.
- **Do:** new stores `rewards` (byOwner/byToken/byStatus/byShortCode), `rewardEvents` (byReward/byOwner), `idempotencyKeys`. v5 upgrade **drops + recreates** (clean). Implement `commitCounterTransaction` (atomic + idempotent), `listRewards`, `getCustomerState`, `undoCommit`, internal `redeemReward`. Rewrite `demoSeed` to the reward model (customers with discrete unspent/spent Rewards + reward_issue ledger + reward events; balances settled). Keep the **post-open backfill / self-heal** discipline (never await loops inside the `versionchange` upgrade — Safari hang).
- **Done when:** tests pass for atomic commit, idempotent retry (same key → identical result, no double writes), subset-redeem (stale id → `rejected[]`), mint-on-cross, undo (void fresh + re-mint spent), over_cap/customer_not_found short-circuit, clean v5 from an older DB.

### Phase 3 — Services
- **Files:** `services/LoyaltyService.ts`, `domain/insights.ts` (metric source).
- **Do:** `commit()` wraps the store; `getState()` → `CustomerState`; `undo()`; one best-effort notification per commit *if any minted*; `getStats`/insights read `reward.redeemed` events (not the ledger). Alerts stay ledger-based; `source` lands on audit.
- **Done when:** service tests green; stats count reward events.

### Phase 4 — Sync / RPC
- **Files:** `adapters/sync/storeMethods.ts`, `adapters/sync/PeerClientStore.ts`, `StoreServer.ts`.
- **Do:** add `commitCounterTransaction`, `listRewards`, `getCustomerState`, `undoCommit`, new `redeemReward` to the allow-list; pass-through. The idempotency dedup makes the 10s RPC retry safe.
- **Done when:** sync tests green; a retried RPC commit doesn't double-apply.

### Phase 5 — Scan parser + staff Scan UI
- **Files:** `qr/encode.ts` (parser), `ui/screens/staff/Scan/*`, `ui/app/routes.ts`.
- **Do:** `parseScan` for `/c` & `/r` (+source). Identify → state + pre-attached rewards (show valid vs invalid). **Unified counter panel:** points slider AND reward checklist (pre-checked from the scan), one `commit`. `over_cap` guard. **5-second Undo** affordance. Manual short-code path returns the list to tick. Remove the separate accrue/redeem two-call flow.
- **Done when:** combined-commit works; reward scan pre-attaches; over_cap rejected; undo within 5s; component tests green.

### Phase 6 — Customer card UI  ⟵ reworks what was shipped this session
- **Files:** `ui/components/LoyaltyCard/*`, `ui/screens/customer/Card/*`, `ui/screens/customer/EnlargedQr/*`.
- **Do:** reward entry on the card; count badge when >1; tap entry → single reward QR (`/r?ids=<token>&c=…`); tap badge → expand selectable list below (first preselected, `×Y` by the label), badge becomes a QR icon; tap QR icon → composite reward QR of the selected ids. Switch the shipped **botanical redeem overlay from the card QR to the reward QR**. Badge source → `rewards.length`; bg sage/blush → `unspentRewards > 0`.
- **Done when:** card shows discrete rewards; single + composite QRs scan; tests green.

### Phase 7 — Wallet hooks
- **Files:** `ports/WalletProvider.ts`, `adapters/wallet/StaticWalletProvider.ts`, `ui/screens/customer/EnlargedQr/*`, `ui/screens/staff/Scan/*` (D9 path).
- **Do:** `WalletProvider` boolean → count; `pushUpdate` shape; wallet scan surfaces the redeem checklist from the returned list (no composite QR on wallet). Confirm the embed contract (§3.5) with the maintainer.

### Phase 8 — Docs
- **Files:** `docs/STATUS.md`, this file (tick boxes), `README.md` if architecture diagrams change.
- **Do:** record divergences + acceptance rows (below); document reward/QR/short-code formats + the undo model. Cannot edit `docs/SPEC.md` (authoritative) — record divergence there is NOT allowed; note it in STATUS.

---

## 5 · Acceptance (C9 / D10 → tests)

| Criterion | Test |
|---|---|
| Crossing threshold mints exactly one reward per `pointsPerReward`, same commit | over-threshold commit → `minted.length`, balance settles |
| Retried commit (same key) neither double-accrues nor double-mints | commit twice same key → identical result, one write set |
| `balance` 0..threshold−1; "N free" = unspent count | derivation test |
| Redeem atomic + idempotent; 2nd → `already_spent`; non-owner → `not_owner` | concurrent + cross-owner |
| Reversing a minting accrual voids the minted reward | undo/reverse test |
| Reward log append-only; status only via events | store invariant |
| One commit can add points AND redeem ≥1; never gated by QR type | combined-commit |
| Source tag parsed + recorded; drives nothing but validation/analytics | parse + audit field |
| No per-transaction freshness anywhere | design (no timestamp validation) |
| Every redeemRewardId re-validated at commit; subset redeemed, rest reported | stale-in-set → `rejected[]` |
| Wallet scan with rewards surfaces redeem affordance from the list | wallet-path UI |
| All three input paths return `{customer, balance, rewards}` | card / reward / manual identify |
| Undo within 5s: points reversed, fresh mint voided, spent re-minted | undo service test |

---

## 6 · Risk notes
- **Atomicity** in the prototype = single IDB-tx scope (no row lock). Record as divergence; prod swaps to `SELECT … FOR UPDATE`.
- **Shipped this session** (botanical redeem overlay showing the *card* QR; reward badge reading `progress.rewardsAvailable`) is intentionally reworked in Phase 6 — those files will change.
- **Gifting** stays schema-reserved (`transfer_*`/`pooled` enum values + commented seams). Do not build.
- The IndexedDB **self-heal / blocked-open** hardening (watchdog + delete-and-reopen + `blocking` handler) shipped this session — keep it; Phase 2's v5 upgrade must not reintroduce an await-loop inside the `versionchange` upgrade.
