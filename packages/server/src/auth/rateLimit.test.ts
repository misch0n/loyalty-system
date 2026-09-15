import { beforeEach, describe, expect, it } from 'vitest';
import { AttemptLimiter } from './rateLimit';

describe('AttemptLimiter', () => {
  let clock: number;
  const now = (): number => clock;

  const limiter = (over: Partial<ConstructorParameters<typeof AttemptLimiter>[0]> = {}) =>
    new AttemptLimiter({ limit: 3, windowMs: 60_000, lockoutMs: 300_000, now, ...over });

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('allows an unseen key', () => {
    expect(limiter().check('a')).toEqual({ allowed: true, retryAfterSec: 0 });
  });

  it('locks out on the nth failure, not the n+1th', () => {
    const limit = limiter();
    limit.fail('a');
    limit.fail('a');
    expect(limit.check('a').allowed).toBe(true);

    limit.fail('a');
    expect(limit.check('a')).toEqual({ allowed: false, retryAfterSec: 300 });
  });

  it('counts each key separately', () => {
    const limit = limiter();
    limit.fail('a');
    limit.fail('a');
    limit.fail('a');
    expect(limit.check('b').allowed).toBe(true);
  });

  it('never throttles a key that keeps succeeding', () => {
    // The point of counting failures rather than requests: a till signing in all
    // day is not an attack.
    const limit = limiter();
    for (let i = 0; i < 50; i += 1) {
      limit.fail('a');
      limit.succeed('a');
    }
    expect(limit.check('a').allowed).toBe(true);
  });

  it('forgets failures once the window rolls over', () => {
    const limit = limiter();
    limit.fail('a');
    limit.fail('a');
    clock += 60_001;
    limit.fail('a');
    expect(limit.check('a').allowed).toBe(true);
  });

  it('counts down the lockout and then admits the key again', () => {
    const limit = limiter();
    limit.fail('a');
    limit.fail('a');
    limit.fail('a');

    clock += 200_000;
    expect(limit.check('a')).toEqual({ allowed: false, retryAfterSec: 100 });

    clock += 100_001;
    expect(limit.check('a').allowed).toBe(true);
  });

  it('starts a fresh count after a served lockout', () => {
    const limit = limiter();
    limit.fail('a');
    limit.fail('a');
    limit.fail('a');
    clock += 300_001;

    limit.fail('a');
    expect(limit.check('a').allowed).toBe(true);
  });

  it('sweeps spent entries so a key-space flood cannot grow the map forever', () => {
    const limit = limiter({ maxEntries: 4 });
    for (let i = 0; i < 4; i += 1) limit.fail(`key-${i}`);

    clock += 300_001 + 60_000;
    // The 5th failure crosses maxEntries and triggers the sweep; the four spent
    // entries go, and the map holds only the new key.
    limit.fail('fresh');
    limit.sweep();

    expect(limit.check('key-0').allowed).toBe(true);
    expect(limit.check('fresh').allowed).toBe(true);
  });

  it('keeps a locked-out entry through a sweep', () => {
    const limit = limiter();
    limit.fail('a');
    limit.fail('a');
    limit.fail('a');
    limit.sweep();
    expect(limit.check('a').allowed).toBe(false);
  });
});
