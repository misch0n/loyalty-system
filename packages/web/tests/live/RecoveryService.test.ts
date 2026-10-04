/**
 * RecoveryService against the real server, with the real mail: request a code,
 * read it out of the inbox, type it on a new phone, and get the card back
 * (SCOPE-DECISIONS §2.3). Neither call may reveal whether an address has a card.
 */

import { describe, expect, it } from 'vitest';
import { isApiError } from '../../src/services/errors';
import { customerPhone, device, mailCount, recoveryCodeFor, signedIn, unique } from './harness';

describe('recovery', () => {
  it('mails a code that binds a new phone to the card', async () => {
    const lost = await customerPhone();
    const newPhone = await device();
    // The new phone knows nothing about the card yet.
    expect(await newPhone.services.customers.getById(lost.customer.id)).toBeNull();

    await newPhone.services.recovery.request(lost.email);
    const code = await recoveryCodeFor(lost.email);
    expect(code).toMatch(/^[A-Z0-9-]{6,}$/);

    const restored = await newPhone.services.recovery.consume(` ${lost.email} `, code.toLowerCase());
    expect(restored).toEqual({ token: lost.customer.token });
    // Bound: the new phone may now read its card by id.
    expect((await newPhone.services.customers.getById(lost.customer.id))?.id).toBe(lost.customer.id);
  });

  it('answers a wrong code with null — and a used one, too', async () => {
    const lost = await customerPhone();
    const phone = await device();
    await phone.services.recovery.request(lost.email);
    const code = await recoveryCodeFor(lost.email);

    expect(await phone.services.recovery.consume(lost.email, 'WRONG1')).toBeNull();
    expect(await phone.services.recovery.consume(lost.email, code)).not.toBeNull();
    expect(await phone.services.recovery.consume(lost.email, code)).toBeNull();
  });

  it('cannot be told apart for an address with no card', async () => {
    const phone = await device();
    const nobody = `nobody-${unique()}@example.test`;
    await expect(phone.services.recovery.request(nobody)).resolves.toBeUndefined();
    expect(await phone.services.recovery.consume(nobody, 'ABC123')).toBeNull();
    // …and nothing was sent to it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await mailCount(nobody)).toBe(0);
  });

  it('refuses to make a staff till into a customer’s device', async () => {
    const lost = await customerPhone();
    const till = await signedIn('staff');
    await till.services.recovery.request(lost.email);
    const code = await recoveryCodeFor(lost.email);

    const failure = await till.services.recovery.consume(lost.email, code).then(
      () => null,
      (err: unknown) => (isApiError(err) ? err.failure : null),
    );
    expect(failure).toEqual({ kind: 'forbidden', code: 'staff_device' });
  });

  it('rate-limits repeated requests for one address', async () => {
    const lost = await customerPhone();
    const phone = await device();
    for (let i = 0; i < 3; i += 1) await phone.services.recovery.request(lost.email);
    const failure = await phone.services.recovery.request(lost.email).then(
      () => null,
      (err: unknown) => (isApiError(err) ? err.failure.kind : null),
    );
    expect(failure).toBe('rate_limited');
  });
});
