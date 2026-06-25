/**
 * Rewards-as-objects — pure derivation and decision logic (REWARDS-PLAN §3.2).
 *
 * Rewards are discrete, countable, ownable {@link Reward} objects rather than an
 * implicit `balance ≥ threshold` boolean. This module holds the PURE rules that
 * decide what a commit/undo does; the storage adapter (Phase 2) performs the
 * actual writes (id/token/timestamp allocation is I/O and lives there).
 *
 * Everything here is total and side-effect free, so it is exhaustively
 * unit-testable and shared verbatim with the production backend.
 */

import type { ProgramConfig, Reward } from './models';

// ── derivation ────────────────────────────────────────────────────────────────

/**
 * How many of a customer's rewards are still redeemable. The unspent count is
 * what drives the card ("N free"), replacing the old `rewardAvailable` boolean.
 */
export function unspentRewards(rewards: Reward[]): number {
  return rewards.filter((r) => r.status === 'unspent').length;
}

export interface CardProgress {
  /** Points toward the next reward — the settled balance, 0..threshold−1. */
  current: number;
  /** The threshold (pointsPerReward). */
  threshold: number;
}

/**
 * Card stamp-grid progress. In the rewards-as-objects model the balance already
 * settles to 0..threshold−1 (minting debits −threshold on every crossing), so
 * `current` is simply the balance. Note the dropped `rewardsAvailable` field —
 * the unspent {@link Reward} count carries that now (see {@link unspentRewards}).
 */
export function cardProgress(currentBalance: number, config: ProgramConfig): CardProgress {
  const threshold = config.pointsPerReward;
  const safeBalance = Math.max(0, currentBalance);
  const current = threshold > 0 ? safeBalance % threshold : safeBalance;
  return { current, threshold };
}

// ── minting (the fold) ──────────────────────────────────────────────────────────

/**
 * What a mint-fold over the current balance yields. The store appends one
 * `reward_issue` ledger entry of {@link perMintPoints} and materializes one
 * {@link Reward} per `mintCount`, leaving the balance settled at
 * {@link settledBalance}.
 */
export interface MintPlan {
  /** Number of rewards to mint (0 when below threshold). */
  mintCount: number;
  /** The threshold crossed each time (pointsPerReward). */
  threshold: number;
  /** Signed points on each `reward_issue` ledger entry: −threshold. */
  perMintPoints: number;
  /** Balance left after the mints settle: 0..threshold−1. */
  settledBalance: number;
}

/**
 * Decide minting on the post-accrual balance: while `balance ≥ threshold`, emit a
 * `reward_issue(−threshold)` and one reward. Folds the whole crossing in one step
 * (a single large accrual can mint several rewards). Pure — the caller writes.
 */
export function mintFold(currentBalance: number, config: ProgramConfig): MintPlan {
  const threshold = config.pointsPerReward;
  if (threshold <= 0 || currentBalance < threshold) {
    return { mintCount: 0, threshold, perMintPoints: -threshold, settledBalance: currentBalance };
  }
  const mintCount = Math.floor(currentBalance / threshold);
  return {
    mintCount,
    threshold,
    perMintPoints: -threshold,
    settledBalance: currentBalance - mintCount * threshold,
  };
}

// ── redemption validation (per-reward, at commit time) ──────────────────────────

/** Reason a single reward in a redeem set failed re-validation at commit time. */
export type RedemptionRejectReason = 'not_owner' | 'already_spent' | 'reward_invalid';

export type RedemptionValidity =
  | { ok: true }
  | { ok: false; reason: RedemptionRejectReason };

/**
 * Re-validate one reward id against the live row at commit time (subset-redeem:
 * an invalid id is reported, never aborts the whole commit). Checks, in order:
 *   • exists           → else `reward_invalid`
 *   • owned by caller   → else `not_owner` (ownership beats status)
 *   • status `unspent`  → `spent` ⇒ `already_spent`, anything else ⇒ `reward_invalid`
 */
export function validateRedemption(
  reward: Reward | null | undefined,
  ownerId: string,
): RedemptionValidity {
  if (!reward) return { ok: false, reason: 'reward_invalid' };
  if (reward.ownerId !== ownerId) return { ok: false, reason: 'not_owner' };
  if (reward.status === 'unspent') return { ok: true };
  if (reward.status === 'spent') return { ok: false, reason: 'already_spent' };
  // voided / transfer_pending (reserved) — not a redeemable reward.
  return { ok: false, reason: 'reward_invalid' };
}

// ── cap guard ───────────────────────────────────────────────────────────────────

/**
 * Server-contract guard: a commit whose `pointsDelta` exceeds the configured
 * per-transaction cap (or is negative) is rejected as `over_cap` — the slider
 * stays bounded in the UI, this is the backstop. Zero is allowed (redeem-only).
 */
export function isOverCap(pointsDelta: number, config: ProgramConfig): boolean {
  return (
    !Number.isInteger(pointsDelta) ||
    pointsDelta < 0 ||
    pointsDelta > config.maxPointsPerTransaction
  );
}

// ── undo decision (5-second window) ─────────────────────────────────────────────

/** A record of what one committed counter-transaction did, enough to undo it. */
export interface CommittedEffect {
  /** Points accrued by the commit (the `accrual` entry it appended). */
  pointsDelta: number;
  /** Threshold in force at commit time (pointsPerReward). */
  threshold: number;
  /** Ids of the rewards the commit minted (now unspent). */
  mintedRewardIds: string[];
  /** Ids of the existing rewards the commit redeemed (now spent). */
  spentRewardIds: string[];
}

/**
 * The undo plan for a commit (REWARDS-PLAN §2 "Undo"):
 *   • reverse the commit's net point effect so the balance returns to its
 *     pre-commit value,
 *   • void every freshly-minted (still-unspent) reward, and
 *   • re-mint one replacement reward for each reward the commit spent.
 * A spent reward is NEVER un-spent — it stays spent and a replacement is issued.
 */
export interface UndoPlan {
  /** Points delta to append as the reversal entry (restores the pre-commit balance). */
  reversePoints: number;
  /** Freshly-minted rewards to void. */
  voidRewardIds: string[];
  /** Spent rewards each needing a fresh replacement (reason `undo_reissue`). */
  reissueForSpentRewardIds: string[];
}

/**
 * Compute the undo plan from a commit's recorded effect. The reversal nets the
 * accrual (+pointsDelta) and the mint debits (−threshold × minted) back to zero:
 * `reversePoints = mintedCount·threshold − pointsDelta`. Re-minting replacements
 * for spent rewards is point-neutral (those rewards were earned in an earlier
 * commit), so it never touches `reversePoints`.
 */
export function planUndo(effect: CommittedEffect): UndoPlan {
  const reversePoints = effect.mintedRewardIds.length * effect.threshold - effect.pointsDelta;
  return {
    reversePoints,
    voidRewardIds: [...effect.mintedRewardIds],
    reissueForSpentRewardIds: [...effect.spentRewardIds],
  };
}
