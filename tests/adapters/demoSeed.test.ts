/**
 * The demo seed feeds the live admin panel on a fresh / just-reset device. It's
 * gated off in the main test suite (seeded only via `new IndexedDbStore({ seedDemo
 * true })` in the composition root), so these checks guard its internal coherence
 * directly: a duplicate id/token/short-code would trip a unique index and break
 * first-run on the deployed demo. Verifies the rewards-as-objects shape — settled
 * balances, discrete reward objects, append-only events.
 */
import { describe, it, expect } from 'vitest';
import { buildDemoSeed } from '../../src/adapters/storage/demoSeed';
import { balance } from '../../src/domain/loyalty';

const NOW = Date.UTC(2026, 5, 25, 12, 0, 0); // fixed clock — deterministic seed

describe('demoSeed (rewards-as-objects)', () => {
  const seed = buildDemoSeed(NOW);

  it('produces members with unique ids, tokens and short codes', () => {
    const ids = seed.customers.map((c) => c.id);
    const tokens = seed.customers.map((c) => c.token);
    const codes = seed.customers.map((c) => c.shortCode);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('produces rewards with unique ids, tokens and short codes', () => {
    const ids = seed.rewards.map((r) => r.id);
    const tokens = seed.rewards.map((r) => r.token);
    const codes = seed.rewards.map((r) => r.shortCode);
    expect(seed.rewards.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('ledger holds only accrual + reward_issue (no redemption entries); balances settle', () => {
    const types = new Set(seed.transactions.map((t) => t.type));
    expect(types.has('redemption' as never)).toBe(false);
    expect([...types].sort()).toEqual(['accrual', 'reward_issue']);

    // Every customer's balance settles to 0..threshold−1 (mint debits each cross).
    for (const c of seed.customers) {
      const bal = balance(seed.transactions.filter((t) => t.customerId === c.id));
      expect(bal).toBeGreaterThanOrEqual(0);
      expect(bal).toBeLessThan(8);
    }
  });

  it('each reward has a reward.issued event; spent rewards have a reward.redeemed event', () => {
    const issued = seed.rewardEvents.filter((e) => e.type === 'reward.issued');
    expect(issued).toHaveLength(seed.rewards.length);
    const redeemedEvents = seed.rewardEvents.filter((e) => e.type === 'reward.redeemed');
    const spent = seed.rewards.filter((r) => r.status === 'spent');
    expect(redeemedEvents).toHaveLength(spent.length);
    expect(spent.length).toBeGreaterThan(0);
  });

  it('is deterministic given the same clock', () => {
    expect(buildDemoSeed(NOW)).toEqual(seed);
  });
});
