import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices, STAFF } from '../helpers/freshStore';
import { SpyMailer } from '../helpers/spyMailer';
import type { CustomerService } from '../../src/services/CustomerService';
import type { RecoveryService } from '../../src/services/RecoveryService';

let customers: CustomerService;
let recovery: RecoveryService;
let mailer: SpyMailer;

beforeEach(() => {
  mailer = new SpyMailer();
  const services = freshServices(mailer);
  customers = services.customers;
  recovery = services.recovery;
});

async function registerWithEmail(email: string) {
  const shell = await customers.issueCard(STAFF);
  await customers.finalizeRegistration(STAFF, shell.id, { email, consent: true });
  return shell;
}

describe('request', () => {
  it('emails a single-use recovery link to a matching active customer', async () => {
    await registerWithEmail('lost@cafe.test');
    await recovery.request('lost@cafe.test');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].kind).toBe('recovery');
    expect(mailer.sent[0].to).toBe('lost@cafe.test');
    expect(mailer.sent[0].params.recovery_link).toContain('#/recover/');
  });

  it('matches case-insensitively', async () => {
    await registerWithEmail('Mixed@Cafe.test');
    await recovery.request('mixed@cafe.test');
    expect(mailer.sent).toHaveLength(1);
  });

  it('sends nothing for an unknown email (no enumeration)', async () => {
    await recovery.request('nobody@cafe.test');
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('redeem', () => {
  it('consumes a valid code and returns the customer token', async () => {
    const shell = await registerWithEmail('me@cafe.test');
    await recovery.request('me@cafe.test');
    const code = mailer.sent[0].params.recovery_link.split('/recover/')[1];

    const result = await recovery.redeem(code);
    expect(result?.token).toBe(shell.token);
  });

  it('is single-use — a second redeem fails', async () => {
    await registerWithEmail('me@cafe.test');
    await recovery.request('me@cafe.test');
    const code = mailer.sent[0].params.recovery_link.split('/recover/')[1];

    expect(await recovery.redeem(code)).not.toBeNull();
    expect(await recovery.redeem(code)).toBeNull();
  });

  it('returns null for an unknown code', async () => {
    expect(await recovery.redeem('nope')).toBeNull();
  });
});
