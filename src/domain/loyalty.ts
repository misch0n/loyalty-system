/**
 * Loyalty rules — pure functions over the append-only ledger.
 *
 * Balance and "reward available" are DERIVED here by summing transactions; the
 * system never stores a counter. All functions are total and side-effect free,
 * so they are exhaustively unit-testable and shared with the production backend.
 */

import type { LoyaltyTransaction, ProgramConfig } from './models';

/**
 * Current balance = signed sum of all of a customer's ledger entries.
 *
 * In the rewards-as-objects model (REWARDS-PLAN) the ledger gains a
 * `reward_issue(−threshold)` entry on every crossing, so the balance now
 * SETTLES to 0..threshold−1 instead of accumulating. The sum is unchanged; the
 * new derivation (mint-fold, settled card progress, unspent reward count) lives
 * in `domain/rewards.ts`. The functions below are the transitional pre-rework
 * derivation, removed once the service rework (Phase 3) lands.
 */
export function balance(transactions: LoyaltyTransaction[]): number {
  return transactions.reduce((sum, tx) => sum + tx.points, 0);
}

/** A reward can be redeemed once the balance reaches the threshold. */
export function rewardAvailable(currentBalance: number, config: ProgramConfig): boolean {
  return currentBalance >= config.pointsPerReward;
}

export interface Progress {
  /** Points counted toward the next reward (0 .. threshold). */
  current: number;
  /** The threshold (pointsPerReward). */
  threshold: number;
  /** Whole rewards already earned but not yet redeemed. */
  rewardsAvailable: number;
}

/**
 * Progress toward the next reward. `current` resets each time a full reward's
 * worth of points is accumulated, so the UI can render a fresh "x of N" bar.
 */
export function progress(currentBalance: number, config: ProgramConfig): Progress {
  const threshold = config.pointsPerReward;
  const safeBalance = Math.max(0, currentBalance);
  const rewardsAvailable = threshold > 0 ? Math.floor(safeBalance / threshold) : 0;
  const current = threshold > 0 ? safeBalance % threshold : 0;
  return { current, threshold, rewardsAvailable };
}

/**
 * Clamp a requested accrual to the configured per-transaction cap and to a
 * sane minimum of 1. Returns the number of points that may actually be granted.
 */
export function clampAccrual(requestedPoints: number, config: ProgramConfig): number {
  const rounded = Math.floor(requestedPoints);
  if (Number.isNaN(rounded) || rounded < 1) return 1;
  return Math.min(rounded, config.maxPointsPerTransaction);
}

/** Validate a requested accrual without silently clamping. */
export function isValidAccrual(requestedPoints: number, config: ProgramConfig): boolean {
  return (
    Number.isInteger(requestedPoints) &&
    requestedPoints >= 1 &&
    requestedPoints <= config.maxPointsPerTransaction
  );
}

export interface RedemptionCheck {
  ok: boolean;
  /** Signed delta to write if `ok` (negative). */
  delta: number;
  reason?: string;
}

/**
 * Decide whether a redemption may proceed given the current balance. The
 * caller writes the entry atomically; this is the rule, not the side effect.
 */
export function checkRedemption(
  currentBalance: number,
  config: ProgramConfig,
): RedemptionCheck {
  if (!rewardAvailable(currentBalance, config)) {
    return {
      ok: false,
      delta: 0,
      reason: `Not enough points yet — needs ${config.pointsPerReward}, has ${currentBalance}.`,
    };
  }
  return { ok: true, delta: -config.pointsPerReward };
}
