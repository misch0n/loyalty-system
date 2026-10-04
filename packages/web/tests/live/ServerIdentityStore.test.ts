/**
 * ServerIdentityStore against the real server: the device binding is an
 * HttpOnly cookie, read and written through `/me` (UI-RECONCILIATION C6).
 */

import { describe, expect, it } from 'vitest';
import { customerPhone, device } from './harness';

describe('identity', () => {
  it('does not recognise a fresh device', async () => {
    const phone = await device();
    expect(await phone.services.identity.get()).toBeNull();
  });

  it('recognises the phone a card was registered on, until it is cleared', async () => {
    const phone = await customerPhone();
    expect(await phone.services.identity.get()).toBe(phone.customer.token);

    await phone.services.identity.clear();
    expect(await phone.services.identity.get()).toBeNull();
  });

  it('binds a second device that presents the token', async () => {
    const { customer } = await customerPhone();
    const second = await device();
    await second.services.identity.set(customer.token);
    expect(await second.services.identity.get()).toBe(customer.token);
  });
});
