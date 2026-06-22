/**
 * RecoveryService — customer self-service "lost my card".
 *
 * Primary recovery path: the customer enters their registered email and receives
 * a single-use, short-expiry link. Opening the link IS the login (no passwords):
 * it consumes the code and yields the customer's token, which the caller re-seeds
 * into the IdentityStore to re-establish the browser.
 *
 * Token-only customers (no contact detail) are unrecoverable by design — there
 * is nothing to send to. Staff-assisted in-person recovery (reissue) remains a
 * separate backup in CustomerService.
 */

import type { DataStore } from '../ports/DataStore';
import type { Mailer } from '../ports/Mailer';
import { generateToken } from '../domain/tokens';
import { normalizeEmail } from '../domain/validation';
import { appUrl } from '../config/links';
import type { AuditService } from './AuditService';
import { SYSTEM_ACTOR } from './types';

/** How long a recovery link stays valid. */
const EXPIRY_MINUTES = 15;

export class RecoveryService {
  constructor(
    private readonly store: DataStore,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
  ) {}

  /**
   * Request a recovery link for an email. Sends a link only if an active customer
   * with that email exists, but ALWAYS resolves the same way — callers must not
   * reveal whether the address was found (no account-enumeration oracle).
   */
  async request(email: string): Promise<void> {
    const wanted = normalizeEmail(email);
    if (!wanted) return;

    const matches = await this.store.findCustomers({ term: email });
    const customer = matches.find(
      (c) => c.status === 'active' && c.email && normalizeEmail(c.email) === wanted,
    );
    if (!customer || !customer.email) return;

    const code = generateToken();
    const expiresAt = Date.now() + EXPIRY_MINUTES * 60_000;
    await this.store.createRecoveryCode({ code, customerId: customer.id, expiresAt });

    const link = appUrl(`/recover/${code}`);
    await this.mailer.send({
      to: customer.email,
      kind: 'recovery',
      params: {
        recovery_link: link,
        expiry_minutes: String(EXPIRY_MINUTES),
        subject: 'Restore your café loyalty card',
        message: `Open this link to restore your loyalty card on this device: ${link}\n\nThe link is single-use and expires in ${EXPIRY_MINUTES} minutes. If you didn't request this, you can ignore this email.`,
      },
    });

    await this.audit.log(SYSTEM_ACTOR, 'customer.recover', customer.id, 'requested');
  }

  /**
   * Redeem a recovery code. Atomically consumes it (single-use) and returns the
   * customer's token to re-establish identity, or null if invalid/expired/used.
   */
  async redeem(code: string): Promise<{ token: string } | null> {
    const customerId = await this.store.consumeRecoveryCode(code);
    if (!customerId) return null;

    const customer = await this.store.getCustomerById(customerId);
    if (!customer || customer.status !== 'active') return null;

    await this.audit.log(SYSTEM_ACTOR, 'customer.recover', customer.id, 'redeemed');
    return { token: customer.token };
  }
}
