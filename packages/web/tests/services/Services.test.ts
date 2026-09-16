/**
 * Composition root smoke test.
 *
 * It used to boot the whole prototype graph — IndexedDB, PeerJS, a wallet
 * provider — and then prove an action was visible end to end through it. Phase 6
 * deleted all three adapters, and the one store left is `ApiStore`, whose
 * `request` is unwritten until the UI pass. So there is no graph to exercise
 * here any more; what is still worth pinning is the *wiring*, and in particular
 * the two choices that are easy to get quietly wrong.
 */
import { describe, it, expect } from 'vitest';
import { createServices } from '../../src/services/Services';
import { ApiStore } from '../../src/adapters/storage/ApiStore';
import { NoopMailer } from '../../src/adapters/email/NoopMailer';

describe('createServices', () => {
  it('wires every service', async () => {
    const services = await createServices();
    expect(services.audit).toBeDefined();
    expect(services.config).toBeDefined();
    expect(services.staff).toBeDefined();
    expect(services.customers).toBeDefined();
    expect(services.loyalty).toBeDefined();
    expect(services.recovery).toBeDefined();
    expect(services.identity).toBeDefined();
  });

  it('wires the one store there is', async () => {
    expect((await createServices()).store).toBeInstanceOf(ApiStore);
  });

  it('wires a NoopMailer, because the routes are the only sender', async () => {
    // `POST /customers` sends the welcome mail and the commit route sends the
    // reward-available one. A client-side mailer here means every customer gets
    // each of them twice (`UI-RECONCILIATION.md` P3).
    expect((await createServices()).mailer).toBeInstanceOf(NoopMailer);
  });
});
