/**
 * storageSnapshot — the prototype pairing storage push/pop.
 *
 * Verifies the snapshot/restore stack: pairing captures + clears the device's
 * own storage, a light reset clears everything but the snapshot, and unpair (or
 * boot self-heal) restores the pre-pair state and drops the reserved key.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllStorage,
  clearExceptSnapshot,
  hasSnapshot,
  restoreSnapshot,
  snapshotAndClear,
} from '../../../src/ui/common/storageSnapshot';

const RESERVED_KEY = 'cafe-loyalty.__pairSnapshot';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('snapshotAndClear', () => {
  it('captures local + session into the reserved key and clears the rest', () => {
    localStorage.setItem('cafe-loyalty.customer', 'tok-original');
    localStorage.setItem('cafe-loyalty.lastUser', 'sam');
    sessionStorage.setItem('cafe-loyalty.staffSession', '{"a":1}');

    snapshotAndClear();

    // Fresh device: only the reserved key survives.
    expect(localStorage.getItem('cafe-loyalty.customer')).toBeNull();
    expect(localStorage.getItem('cafe-loyalty.lastUser')).toBeNull();
    expect(sessionStorage.getItem('cafe-loyalty.staffSession')).toBeNull();
    expect(hasSnapshot()).toBe(true);
  });

  it('does not nest a prior snapshot into a new one', () => {
    localStorage.setItem('cafe-loyalty.customer', 'tok-original');
    snapshotAndClear();
    // Pretend the device wrote paired-era data, then re-pairs.
    localStorage.setItem('cafe-loyalty.customer', 'tok-paired');
    snapshotAndClear();

    restoreSnapshot();
    // Restores the paired-era frame (the latest snapshot), not a nested original.
    expect(localStorage.getItem('cafe-loyalty.customer')).toBe('tok-paired');
    expect(hasSnapshot()).toBe(false);
  });
});

describe('restoreSnapshot', () => {
  it('brings back the pre-pair storage and drops the reserved key', () => {
    localStorage.setItem('cafe-loyalty.customer', 'tok-original');
    sessionStorage.setItem('cafe-loyalty.staffSession', 'sess');
    snapshotAndClear();

    // Paired-era writes that must be discarded on unpair.
    localStorage.setItem('cafe-loyalty.customer', 'tok-paired');
    localStorage.setItem('cafe-loyalty.extra', 'junk');

    const restored = restoreSnapshot();

    expect(restored).toBe(true);
    expect(localStorage.getItem('cafe-loyalty.customer')).toBe('tok-original');
    expect(sessionStorage.getItem('cafe-loyalty.staffSession')).toBe('sess');
    expect(localStorage.getItem('cafe-loyalty.extra')).toBeNull();
    expect(hasSnapshot()).toBe(false);
  });

  it('is a no-op returning false when there is no snapshot', () => {
    localStorage.setItem('cafe-loyalty.customer', 'tok');
    expect(restoreSnapshot()).toBe(false);
    // Storage untouched.
    expect(localStorage.getItem('cafe-loyalty.customer')).toBe('tok');
  });
});

describe('clearExceptSnapshot (light/paired reset)', () => {
  it('clears all keys but preserves the snapshot', () => {
    localStorage.setItem('cafe-loyalty.customer', 'tok-original');
    snapshotAndClear();
    // Paired-era data a customer built up.
    localStorage.setItem('cafe-loyalty.customer', 'tok-paired');
    sessionStorage.setItem('cafe-loyalty.staffSession', 'sess');

    clearExceptSnapshot();

    expect(localStorage.getItem('cafe-loyalty.customer')).toBeNull();
    expect(sessionStorage.getItem('cafe-loyalty.staffSession')).toBeNull();
    // Snapshot survives so a later unpair still restores the original.
    expect(hasSnapshot()).toBe(true);
    restoreSnapshot();
    expect(localStorage.getItem('cafe-loyalty.customer')).toBe('tok-original');
  });
});

describe('clearAllStorage (full/host reset)', () => {
  it('clears everything including any snapshot', () => {
    localStorage.setItem('cafe-loyalty.customer', 'tok');
    localStorage.setItem(RESERVED_KEY, '{}');
    sessionStorage.setItem('x', 'y');

    clearAllStorage();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(hasSnapshot()).toBe(false);
  });
});

describe('boot self-heal scenario', () => {
  it('an unclean-exit snapshot restores the original device state', () => {
    // Pre-pair state.
    localStorage.setItem('cafe-loyalty.customer', 'tok-mine');
    snapshotAndClear(); // device paired, went fresh
    localStorage.setItem('cafe-loyalty.customer', 'tok-on-till'); // paired-era

    // Tab closed while paired → next boot finds a leftover snapshot.
    expect(hasSnapshot()).toBe(true);
    restoreSnapshot(); // boot recovery

    expect(localStorage.getItem('cafe-loyalty.customer')).toBe('tok-mine');
    expect(hasSnapshot()).toBe(false);
  });
});
