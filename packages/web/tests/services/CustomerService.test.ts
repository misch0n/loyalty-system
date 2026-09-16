import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, STAFF } from '../helpers/freshStore';
import type { CustomerService } from '../../src/services/CustomerService';

let customers: CustomerService;

beforeEach(() => {
  customers = freshServices().customers;
});

describe('issueCard', () => {
  it('creates a token-only shell with a valid token and no PII', async () => {
    const shell = await customers.issueCard(STAFF);
    expect(shell.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(shell.displayName).toBeUndefined();
    expect(shell.status).toBe('active');
    expect(customers.canRecover(shell)).toBe(false);
  });
});

describe('finalizeRegistration', () => {
  it('stores details, records consent, and is recoverable', async () => {
    const shell = await customers.issueCard(STAFF);
    const result = await customers.finalizeRegistration(STAFF, shell.id, {
      displayName: 'Maria',
      email: 'maria@cafe.test',
      consent: true,
    });
    expect(result.ok).toBe(true);
    expect(result.customer?.consentAt).toBeTruthy();
    expect(customers.canRecover(result.customer!)).toBe(true);
  });

  it('allows a token-only finalize (anonymous account)', async () => {
    const shell = await customers.issueCard(STAFF);
    const result = await customers.finalizeRegistration(STAFF, shell.id, { consent: true });
    expect(result.ok).toBe(true);
    expect(customers.canRecover(result.customer!)).toBe(false);
  });

  it('rejects without consent', async () => {
    const shell = await customers.issueCard(STAFF);
    const result = await customers.finalizeRegistration(STAFF, shell.id, { consent: false });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.field === 'consent')).toBe(true);
  });
});

describe('selfRegister (self-service primary path)', () => {
  it('creates a card with token, details and consent in one step', async () => {
    const result = await customers.selfRegister({
      displayName: 'Sam',
      email: 'sam@cafe.test',
      consent: true,
    });
    expect(result.ok).toBe(true);
    expect(result.customer?.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(result.customer?.consentAt).toBeTruthy();
    expect(customers.canRecover(result.customer!)).toBe(true);
  });

  it('allows a token-only self-registration', async () => {
    const result = await customers.selfRegister({ consent: true });
    expect(result.ok).toBe(true);
    expect(customers.canRecover(result.customer!)).toBe(false);
  });

  it('rejects self-registration without consent', async () => {
    const result = await customers.selfRegister({ email: 'x@cafe.test', consent: false });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.field === 'consent')).toBe(true);
  });
});

describe('provisionFromToken (auto-provision on scan)', () => {
  it('creates a token-only card for an unknown well-formed token', async () => {
    const token = 'A'.repeat(22);
    const provisioned = await customers.provisionFromToken(STAFF, token);
    expect(provisioned.token).toBe(token);
    expect(provisioned.status).toBe('active');
    expect(await customers.getByToken(token)).toMatchObject({ id: provisioned.id });
  });

  it('returns the existing card when the token is already known (no duplicate)', async () => {
    const shell = await customers.issueCard(STAFF);
    const again = await customers.provisionFromToken(STAFF, shell.token);
    expect(again.id).toBe(shell.id);
  });

  it('rejects a malformed token', async () => {
    await expect(customers.provisionFromToken(STAFF, 'not-a-token')).rejects.toThrow();
  });
});

describe('checkDuplicates', () => {
  it('warns when details match an existing active customer', async () => {
    const shell = await customers.issueCard(STAFF);
    await customers.finalizeRegistration(STAFF, shell.id, {
      email: 'dup@cafe.test',
      consent: true,
    });
    const dups = await customers.checkDuplicates({ email: 'dup@cafe.test', consent: true });
    expect(dups).toHaveLength(1);
  });

  it('returns nothing for fresh details', async () => {
    expect(await customers.checkDuplicates({ email: 'new@cafe.test', consent: true })).toEqual([]);
  });
});

describe('recovery, reissue and deletion', () => {
  it('finds a customer by partial name and reissues with a rotated token', async () => {
    const shell = await customers.issueCard(STAFF);
    await customers.finalizeRegistration(STAFF, shell.id, { displayName: 'Maria', consent: true });

    const found = await customers.find('mar');
    expect(found).toHaveLength(1);

    const reissued = await customers.reissue(STAFF, shell.id, true);
    expect(reissued.token).not.toBe(shell.token);
  });

  it('cannot find token-only customers (unrecoverable by design)', async () => {
    const shell = await customers.issueCard(STAFF);
    await customers.finalizeRegistration(STAFF, shell.id, { consent: true });
    expect(await customers.find('anything')).toHaveLength(0);
  });

  it('soft-deletes: status deleted and PII cleared', async () => {
    const shell = await customers.issueCard(STAFF);
    await customers.finalizeRegistration(STAFF, shell.id, {
      displayName: 'Maria',
      email: 'maria@cafe.test',
      consent: true,
    });
    await customers.deleteCustomer(STAFF, shell.id);
    const after = await customers.getById(shell.id);
    expect(after?.status).toBe('deleted');
    expect(after?.displayName).toBeUndefined();
    expect(after?.email).toBeUndefined();
  });

  it('self-deletes by token: clears PII, status deleted, audits under system', async () => {
    const services = freshServices();
    const svc = services.customers;
    const shell = await svc.issueCard(STAFF);
    await svc.finalizeRegistration(STAFF, shell.id, {
      displayName: 'Maria',
      email: 'maria@cafe.test',
      consent: true,
    });

    await svc.selfDelete(shell.token);

    const after = await svc.getById(shell.id);
    expect(after?.status).toBe('deleted');
    expect(after?.displayName).toBeUndefined();
    expect(after?.email).toBeUndefined();

    const audit = await services.audit.list();
    const entry = audit.find((a) => a.action === 'customer.delete' && a.targetId === shell.id);
    expect(entry).toBeTruthy();
    expect(entry?.actorRole).toBe('system');
  });

  it('self-delete is a no-op for an unknown or already-deleted token', async () => {
    const shell = await customers.issueCard(STAFF);
    await customers.selfDelete(shell.token);
    // second call (already deleted) and a bogus token both resolve without throwing
    await expect(customers.selfDelete(shell.token)).resolves.toBeUndefined();
    await expect(customers.selfDelete('Z'.repeat(22))).resolves.toBeUndefined();
  });

  it('reissues keeping the same token when rotation is declined', async () => {
    const shell = await customers.issueCard(STAFF);
    const reissued = await customers.reissue(STAFF, shell.id, false);
    expect(reissued.token).toBe(shell.token);
  });

  it('throws when reissuing a customer that does not exist', async () => {
    await expect(customers.reissue(STAFF, 'nope')).rejects.toThrow();
  });
});

describe('correction', () => {
  it('updates fields, trims blanks to undefined, and is resolvable by token', async () => {
    const shell = await customers.issueCard(STAFF);
    const corrected = await customers.correct(STAFF, shell.id, {
      displayName: '  Maria  ',
      email: '   ',
    });
    expect(corrected.displayName).toBe('Maria');
    expect(corrected.email).toBeUndefined();
    expect(await customers.getByToken(shell.token)).toMatchObject({ id: shell.id });
  });
});

describe('duplicate detection across fields', () => {
  it('dedupes a customer matched by both name and email into a single warning', async () => {
    const shell = await customers.issueCard(STAFF);
    await customers.finalizeRegistration(STAFF, shell.id, {
      displayName: 'Maria',
      email: 'maria@cafe.test',
      consent: true,
    });
    const dups = await customers.checkDuplicates({
      displayName: 'Maria',
      email: 'maria@cafe.test',
      consent: true,
    });
    expect(dups).toHaveLength(1);
  });
});
