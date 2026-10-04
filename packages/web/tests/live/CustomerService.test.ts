/**
 * CustomerService against the real server: registration (name and email
 * required, SCOPE-DECISIONS §2.1), the device binding it creates, staff lookups
 * and corrections, reissue, and both kinds of deletion.
 */

import { describe, expect, it } from 'vitest';
import { isApiError, type ApiFailure } from '../../src/services/errors';
import { adminDevice, customerPhone, device, signedIn, unique } from './harness';

async function failureOf(call: Promise<unknown>): Promise<ApiFailure> {
  try {
    await call;
  } catch (err) {
    if (isApiError(err)) return err.failure;
    throw err;
  }
  throw new Error('expected the call to fail');
}

describe('self-registration', () => {
  it('creates a card with a server-issued token and binds this phone to it', async () => {
    const phone = await device();
    const email = `maria-${unique()}@example.test`;
    const result = await phone.services.customers.selfRegister({
      displayName: '  Maria ',
      email,
      consent: true,
    });

    expect(result.ok).toBe(true);
    const card = result.customer!;
    expect(card).toMatchObject({ displayName: 'Maria', email, status: 'active' });
    expect(card.token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(card.consentAt).toBeTruthy();

    // Bound: this phone may read its own card by id; a stranger's phone may not.
    expect((await phone.services.customers.getById(card.id))?.id).toBe(card.id);
    expect(await (await device()).services.customers.getById(card.id)).toBeNull();
  });

  it('shows field errors without asking the server', async () => {
    const phone = await device();
    const result = await phone.services.customers.selfRegister({
      displayName: 'Maria',
      email: 'not-an-address',
      consent: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.map((e) => e.field).sort()).toEqual(['consent', 'email']);
  });

  it('needs a name and an email — the form says so, and the server refuses a card without them', async () => {
    const phone = await device();
    const result = await phone.services.customers.selfRegister({ displayName: 'Tom', consent: true });
    expect(result.ok).toBe(false);
    expect(result.errors?.map((e) => e.field)).toEqual(['email']);

    // Past the service's own check, the route refuses a blank name too.
    const failure = await failureOf(
      phone.services.store.createCustomer({ token: '', displayName: '   ', email: `tom-${unique()}@example.test` }),
    );
    expect(failure).toEqual({ kind: 'rejected', code: 'invalid_details' });
  });

  it('answers an address that already has a card with email_in_use', async () => {
    const first = await customerPhone();
    const second = await device();
    const failure = await failureOf(
      second.services.customers.selfRegister({ displayName: 'Again', email: first.email, consent: true }),
    );
    expect(failure.kind).toBe('email_in_use');
  });
});

describe('lookups', () => {
  it('resolves a card by its token for anyone holding it', async () => {
    const { customer } = await customerPhone();
    const counter = await signedIn('staff');
    expect((await counter.services.customers.getByToken(customer.token))?.id).toBe(customer.id);
  });

  it('answers null for a token that is no card', async () => {
    const phone = await device();
    expect(await phone.services.customers.getByToken('A'.repeat(22))).toBeNull();
  });

  it('finds and de-duplicates customers for staff', async () => {
    const { customer, email } = await customerPhone();
    const counter = await signedIn('staff');

    expect((await counter.services.customers.find(email)).map((c) => c.id)).toEqual([customer.id]);
    const dupes = await counter.services.customers.checkDuplicates({
      displayName: 'Someone else',
      email,
      consent: true,
    });
    expect(dupes.map((c) => c.id)).toEqual([customer.id]);
  });

  it('keeps search away from customers', async () => {
    const phone = await customerPhone();
    expect((await failureOf(phone.services.customers.find(phone.email))).kind).toBe('signed_out');
  });
});

describe('staff corrections', () => {
  it('corrects a name', async () => {
    const { customer } = await customerPhone();
    const counter = await signedIn('staff');
    const corrected = await counter.services.customers.correct(customer.id, { displayName: ' Mia ' });
    expect(corrected.displayName).toBe('Mia');
    expect(corrected.email).toBe(customer.email);
  });

  it('reissues with a new token; the old one stops resolving', async () => {
    const { customer } = await customerPhone();
    const counter = await signedIn('staff');

    const reissued = await counter.services.customers.reissue(customer.id);
    expect(reissued.id).toBe(customer.id);
    expect(reissued.token).not.toBe(customer.token);
    expect(await counter.services.customers.getByToken(customer.token)).toBeNull();
    expect((await counter.services.customers.getByToken(reissued.token))?.id).toBe(customer.id);
  });
});

describe('deletion', () => {
  it('lets the card’s own phone delete it, which frees the address', async () => {
    const phone = await customerPhone();
    await phone.services.customers.selfDelete(phone.customer.token);

    const counter = await signedIn('staff');
    expect(await counter.services.customers.getByToken(phone.customer.token)).toBeNull();
    const tombstone = await counter.services.customers.getById(phone.customer.id);
    expect(tombstone?.status).toBe('deleted');
    expect(tombstone?.email).toBeUndefined();

    const again = await (await device()).services.customers.selfRegister({
      displayName: 'Back again',
      email: phone.email,
      consent: true,
    });
    expect(again.ok).toBe(true);
    expect(again.customer?.id).not.toBe(phone.customer.id);
  });

  it('resolves quietly when the card is already gone', async () => {
    const phone = await customerPhone();
    await phone.services.customers.selfDelete(phone.customer.token);
    await expect(phone.services.customers.selfDelete(phone.customer.token)).resolves.toBeUndefined();
  });

  it('lets an admin delete a card, but not a staff till', async () => {
    const { customer } = await customerPhone();
    const counter = await signedIn('staff');
    expect((await failureOf(counter.services.customers.deleteCustomer(customer.id))).kind).toBe(
      'not_found',
    );

    const admin = await adminDevice();
    await admin.services.customers.deleteCustomer(customer.id);
    expect((await admin.services.customers.getById(customer.id))?.status).toBe('deleted');
  });
});
