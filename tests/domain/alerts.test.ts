import { describe, it, expect } from 'vitest';
import {
  deriveAlerts,
  DEFAULT_THRESHOLDS,
  type AlertThresholds,
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

/** A daytime base time (12:00 local) to avoid accidental off-hours flags. */
function at(minuteOffset: number): string {
  const base = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();
  return new Date(base + minuteOffset * 60_000).toISOString();
}

function kinds(alerts: { kind: string }[]): Set<string> {
  return new Set(alerts.map((a) => a.kind));
}

describe('velocity', () => {
  it('fires when one staff exceeds the cup limit inside the window', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, velocityCups: 3, velocityWindowMin: 10 };
    const ledger = [
      tx({ staffId: 's1', at: at(0) }),
      tx({ staffId: 's1', at: at(2) }),
      tx({ staffId: 's1', at: at(4) }),
      tx({ staffId: 's1', at: at(6) }),
    ];
    expect(kinds(deriveAlerts(ledger, t)).has('velocity')).toBe(true);
  });

  it('does not fire when spread beyond the window', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, velocityCups: 3, velocityWindowMin: 10 };
    const ledger = [
      tx({ staffId: 's1', at: at(0) }),
      tx({ staffId: 's1', at: at(20) }),
      tx({ staffId: 's1', at: at(40) }),
      tx({ staffId: 's1', at: at(60) }),
    ];
    expect(kinds(deriveAlerts(ledger, t)).has('velocity')).toBe(false);
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
    const a = deriveAlerts(ledger, t).find((x) => x.kind === 'repeat-target');
    expect(a?.customerId).toBe('c9');
  });

  it('does not fire across different staff', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, repeatCount: 2, repeatWindowMin: 30 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'c9', at: at(0) }),
      tx({ staffId: 's2', customerId: 'c9', at: at(5) }),
      tx({ staffId: 's3', customerId: 'c9', at: at(10) }),
    ];
    expect(kinds(deriveAlerts(ledger, t)).has('repeat-target')).toBe(false);
  });
});

describe('oversized-multi-add', () => {
  it('fires at the cap and flags over-cap distinctly', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, multiAddCap: 3 };
    const ledger = [
      tx({ staffId: 's1', points: 3, at: at(0) }),
      tx({ staffId: 's1', points: 5, at: at(1) }),
    ];
    const found = deriveAlerts(ledger, t).filter((x) => x.kind === 'oversized-multi-add');
    expect(found.length).toBe(2);
    expect(found.some((x) => x.detail.includes('exceeds'))).toBe(true);
  });

  it('does not fire below the cap', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, multiAddCap: 3 };
    const ledger = [tx({ staffId: 's1', points: 2, at: at(0) })];
    expect(kinds(deriveAlerts(ledger, t)).has('oversized-multi-add')).toBe(false);
  });
});

describe('off-hours', () => {
  it('fires for a credit outside opening hours', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, hours: { open: 6, close: 20 } };
    const lateNight = new Date(2026, 0, 5, 23, 30, 0, 0).toISOString();
    const ledger = [tx({ staffId: 's1', at: lateNight })];
    expect(kinds(deriveAlerts(ledger, t)).has('off-hours')).toBe(true);
  });

  it('does not fire during opening hours', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, hours: { open: 6, close: 20 } };
    const ledger = [tx({ staffId: 's1', at: at(0) })]; // noon
    expect(kinds(deriveAlerts(ledger, t)).has('off-hours')).toBe(false);
  });
});

describe('outlier-share', () => {
  it('fires when one staff dominates the period', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, outlierMinCredits: 5, outlierShare: 0.8 };
    const ledger = [
      ...Array.from({ length: 9 }, (_, i) => tx({ staffId: 's1', at: at(i) })),
      tx({ staffId: 's2', at: at(10) }),
    ];
    const a = deriveAlerts(ledger, t).find((x) => x.kind === 'outlier-share');
    expect(a?.staffId).toBe('s1');
  });

  it('does not fire below the minimum credit count', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, outlierMinCredits: 50, outlierShare: 0.8 };
    const ledger = [tx({ staffId: 's1', at: at(0) }), tx({ staffId: 's1', at: at(1) })];
    expect(kinds(deriveAlerts(ledger, t)).has('outlier-share')).toBe(false);
  });
});

describe('earn-then-redeem', () => {
  it('fires when a redemption closely follows an accrual by the same staff/customer', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, earnThenRedeemWindowMin: 2 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'c4', points: 3, at: at(0) }),
      tx({ staffId: 's1', customerId: 'c4', type: 'redemption', points: -9, at: at(1) }),
    ];
    expect(kinds(deriveAlerts(ledger, t)).has('earn-then-redeem')).toBe(true);
  });

  it('does not fire when the redemption is by a different staff', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, earnThenRedeemWindowMin: 2 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'c4', points: 3, at: at(0) }),
      tx({ staffId: 's2', customerId: 'c4', type: 'redemption', points: -9, at: at(1) }),
    ];
    expect(kinds(deriveAlerts(ledger, t)).has('earn-then-redeem')).toBe(false);
  });

  it('does not fire when the redemption is outside the window', () => {
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, earnThenRedeemWindowMin: 2 };
    const ledger = [
      tx({ staffId: 's1', customerId: 'c4', points: 3, at: at(0) }),
      tx({ staffId: 's1', customerId: 'c4', type: 'redemption', points: -9, at: at(30) }),
    ];
    expect(kinds(deriveAlerts(ledger, t)).has('earn-then-redeem')).toBe(false);
  });
});

describe('decoration + cleanliness', () => {
  it('attaches staff names when provided and stays quiet on a benign ledger', () => {
    const ledger = [
      tx({ staffId: 's1', customerId: 'c1', points: 1, at: at(0) }),
      tx({ staffId: 's2', customerId: 'c2', points: 1, at: at(120) }),
    ];
    expect(deriveAlerts(ledger)).toEqual([]);
    // Force one alert and check the name decoration.
    const t: AlertThresholds = { ...DEFAULT_THRESHOLDS, multiAddCap: 1 };
    const withName = deriveAlerts(ledger, t, { s1: 'Sam' }).find((a) => a.staffId === 's1');
    expect(withName?.staffName).toBe('Sam');
  });
});
