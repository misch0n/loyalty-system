import { describe, it, expect } from 'vitest';
import {
  deriveAlerts,
  DEFAULT_THRESHOLDS,
  type AlertThresholds,
  type AttributedEvent,
} from '../../src/domain/alerts';
import type { LoyaltyTransaction } from '../../src/domain/models';

let seq = 0;

/** Minimal ledger-entry factory. `at` is an ISO timestamp. */
function tx(p: Partial<LoyaltyTransaction> & { staffId: string; at: string }): LoyaltyTransaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    customerId: p.customerId ?? 'c1',
    type: p.type ?? 'accrual',
    points: p.points ?? 1,
    staffId: p.staffId,
    timestamp: p.at,
    note: p.note,
    reversesTransactionId: p.reversesTransactionId,
  };
}

/** Attributed audit event (the self-dealing detector's input). */
function ev(staffId: string, customerId: string, kind: 'accrue' | 'redeem', at: string): AttributedEvent {
  return { staffId, customerId, kind, at };
}

/** A daytime base time (12:00 local). */
function at(minuteOffset: number): string {
  const base = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();
  return new Date(base + minuteOffset * 60_000).toISOString();
}

/** Same base clock, offset in seconds (self-dealing works in seconds). */
function atSec(secondOffset: number): string {
  const base = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();
  return new Date(base + secondOffset * 1_000).toISOString();
}

function kinds(alerts: { kind: string }[]): Set<string> {
  return new Set(alerts.map((a) => a.kind));
}

describe('detector set', () => {
  it('exposes exactly the two Appendix E detectors and nothing else', () => {
    // A ledger + event stream that would have tripped every retired detector:
    // a burst of rapid credits, an over-cap multi-add, and a late-night credit.
    const lateNight = new Date(2026, 0, 5, 23, 30, 0, 0).toISOString();
    const ledger = [
      ...Array.from({ length: 20 }, (_, i) => tx({ staffId: 's1', customerId: `c${i}`, at: at(i) })),
      tx({ staffId: 's1', customerId: 'cBig', points: 9, at: at(1) }),
      tx({ staffId: 's1', customerId: 'cLate', at: lateNight }),
    ];
    expect(deriveAlerts(ledger, [])).toEqual([]);
  });
});

describe('self-dealing', () => {
  const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, selfDealWindowSec: 30, selfDealCount: 3 };

  it('fires when the same staff credits then redeems the same card, repeatedly', () => {
    const events = [
      ev('s1', 'c4', 'accrue', atSec(0)),
      ev('s1', 'c4', 'redeem', atSec(5)),
      ev('s1', 'c4', 'accrue', atSec(600)),
      ev('s1', 'c4', 'redeem', atSec(610)),
      ev('s1', 'c4', 'accrue', atSec(1200)),
      ev('s1', 'c4', 'redeem', atSec(1205)),
    ];
    const found = deriveAlerts([], events, t).find((a) => a.kind === 'self-dealing');
    expect(found?.staffId).toBe('s1');
    expect(found?.customerId).toBe('c4');
    expect(found?.detail).toContain('3 times');
  });

  it('stays quiet for a single close pair (a customer redeeming straight away is normal)', () => {
    const events = [ev('s1', 'c4', 'accrue', atSec(0)), ev('s1', 'c4', 'redeem', atSec(5))];
    expect(kinds(deriveAlerts([], events, t)).has('self-dealing')).toBe(false);
  });

  it('does not pair across different staff', () => {
    const events = [
      ev('s1', 'c4', 'accrue', atSec(0)),
      ev('s2', 'c4', 'redeem', atSec(5)),
      ev('s1', 'c4', 'accrue', atSec(600)),
      ev('s2', 'c4', 'redeem', atSec(605)),
      ev('s1', 'c4', 'accrue', atSec(1200)),
      ev('s2', 'c4', 'redeem', atSec(1205)),
    ];
    expect(kinds(deriveAlerts([], events, t)).has('self-dealing')).toBe(false);
  });

  it('does not pair across different cards', () => {
    const events = [
      ev('s1', 'c1', 'accrue', atSec(0)),
      ev('s1', 'c2', 'redeem', atSec(5)),
      ev('s1', 'c3', 'accrue', atSec(600)),
      ev('s1', 'c4', 'redeem', atSec(605)),
      ev('s1', 'c5', 'accrue', atSec(1200)),
      ev('s1', 'c6', 'redeem', atSec(1205)),
    ];
    expect(kinds(deriveAlerts([], events, t)).has('self-dealing')).toBe(false);
  });

  it('does not fire when each redeem is outside the proximity window', () => {
    const events = [
      ev('s1', 'c4', 'accrue', atSec(0)),
      ev('s1', 'c4', 'redeem', atSec(120)),
      ev('s1', 'c4', 'accrue', atSec(600)),
      ev('s1', 'c4', 'redeem', atSec(900)),
      ev('s1', 'c4', 'accrue', atSec(1200)),
      ev('s1', 'c4', 'redeem', atSec(1500)),
    ];
    expect(kinds(deriveAlerts([], events, t)).has('self-dealing')).toBe(false);
  });

  it('flags an admin actor the same as staff — no role exemption', () => {
    const events = [
      ev('admin1', 'c4', 'accrue', atSec(0)),
      ev('admin1', 'c4', 'redeem', atSec(5)),
      ev('admin1', 'c4', 'accrue', atSec(600)),
      ev('admin1', 'c4', 'redeem', atSec(605)),
      ev('admin1', 'c4', 'accrue', atSec(1200)),
      ev('admin1', 'c4', 'redeem', atSec(1205)),
    ];
    const found = deriveAlerts([], events, t).find((a) => a.kind === 'self-dealing');
    expect(found?.staffId).toBe('admin1');
  });
});

describe('repeat-target', () => {
  it('fires when same customer credited too often by same staff', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, repeatCount: 2, repeatWindowMin: 30 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'c9', at: at(0) }),
      tx({ staffId: 's1', customerId: 'c9', at: at(5) }),
      tx({ staffId: 's1', customerId: 'c9', at: at(10) }),
    ];
    const a = deriveAlerts(ledger, [], t).find((x) => x.kind === 'repeat-target');
    expect(a?.customerId).toBe('c9');
  });

  it('does not fire across different staff', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, repeatCount: 2, repeatWindowMin: 30 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'c9', at: at(0) }),
      tx({ staffId: 's2', customerId: 'c9', at: at(5) }),
      tx({ staffId: 's3', customerId: 'c9', at: at(10) }),
    ];
    expect(kinds(deriveAlerts(ledger, [], t)).has('repeat-target')).toBe(false);
  });

  it('does not fire when the credits are spread beyond the window', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, repeatCount: 2, repeatWindowMin: 30 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'c9', at: at(0) }),
      tx({ staffId: 's1', customerId: 'c9', at: at(60) }),
      tx({ staffId: 's1', customerId: 'c9', at: at(120) }),
    ];
    expect(kinds(deriveAlerts(ledger, [], t)).has('repeat-target')).toBe(false);
  });
});

describe('decoration + cleanliness', () => {
  it('attaches staff names when provided and stays quiet on a benign ledger', () => {
    const ledger = [
      tx({ staffId: 's1', customerId: 'c1', points: 1, at: at(0) }),
      tx({ staffId: 's2', customerId: 'c2', points: 1, at: at(120) }),
    ];
    expect(deriveAlerts(ledger, [])).toEqual([]);
    // Force one alert and check the name decoration.
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, repeatCount: 0, repeatWindowMin: 30 };
    const withName = deriveAlerts(ledger, [], t, { s1: 'Sam' }).find((a) => a.staffId === 's1');
    expect(withName?.staffName).toBe('Sam');
  });

  it('surfaces alerts newest-first and never blocks (pure derivation, no writes)', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, repeatCount: 1, repeatWindowMin: 30 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'cA', at: at(0) }),
      tx({ staffId: 's1', customerId: 'cA', at: at(1) }),
      tx({ staffId: 's2', customerId: 'cB', at: at(10) }),
      tx({ staffId: 's2', customerId: 'cB', at: at(11) }),
    ];
    const found = deriveAlerts(ledger, [], t);
    expect(found.length).toBe(2);
    expect(found[0].at >= found[1].at).toBe(true);
  });
});
