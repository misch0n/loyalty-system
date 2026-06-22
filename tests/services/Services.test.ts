/**
 * Composition root smoke test. Verifies the default wiring resolves a complete,
 * working service graph (IndexedDbStore + PeerTransport) — the path the app
 * actually boots through outside production.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { createServices } from '../../src/services/Services';
import { PeerTransport } from '../../src/adapters/transport/PeerTransport';

beforeEach(() => {
  // Fresh IndexedDB so the seed runs cleanly for each construction.
  globalThis.indexedDB = new IDBFactory();
});

describe('createServices', () => {
  it('wires every service and a default store + transport', async () => {
    const services = await createServices();
    expect(services.store).toBeDefined();
    expect(services.audit).toBeDefined();
    expect(services.config).toBeDefined();
    expect(services.staff).toBeDefined();
    expect(services.customers).toBeDefined();
    expect(services.loyalty).toBeDefined();
    expect(services.recovery).toBeDefined();
    expect(services.mailer).toBeDefined();
    expect(services.identity).toBeDefined();
    // Prototype transport is the real PeerJS adapter (production swaps it).
    expect(services.transport).toBeInstanceOf(PeerTransport);
  });

  it('produces services that share one store (an action is visible end-to-end)', async () => {
    const services = await createServices();
    const shell = await services.customers.issueCard({
      id: 'a1',
      username: 'admin',
      role: 'admin',
    });
    await services.loyalty.accrue(
      { id: 'a1', username: 'admin', role: 'admin' },
      shell.id,
      3,
    );
    const state = await services.loyalty.getStateById(shell.id);
    expect(state?.balance).toBe(3);
  });
});
