/**
 * RecoveryService — customer self-service "lost my card" (SCOPE-DECISIONS §2.3).
 *
 * Two public routes, shaped as a pair:
 *
 *   `request(email)`        → `POST /recovery/request` — a six-character code
 *                             goes to the inbox
 *   `consume(email, code)`  → `POST /recovery/consume` — the card is bound to
 *                             *this* device, and its token comes back
 *
 * There is no magic link any more. A link opens on whichever device reads the
 * mail — often a laptop, while the customer stands at the counter with their
 * phone — and binding the card there is the wrong answer. A typed code binds
 * the device that typed it. The server mints the code, sends the mail and
 * writes the audit rows; this file only asks.
 *
 * Neither call says whether the address has a card. `request` resolves the same
 * way for every address, and `consume` resolves `null` for every way a code can
 * be wrong — unknown address, wrong code, expired, used, locked out — because
 * the server answers all of them with one `invalid_code`. A rate limit or a
 * till trying to become a customer's device still throws (`services/errors.ts`).
 */

import { isApiError } from './errors';
import type { Api } from './types';

export class RecoveryService {
  constructor(private readonly api: Api) {}

  /** Ask for a code. Resolves identically whether or not the address has a card. */
  async request(email: string): Promise<void> {
    await this.api.request('POST', '/recovery/request', { email: email.trim() });
  }

  /**
   * Trade the emailed code for the card. On success the server has already
   * bound this device to it (an HttpOnly cookie); the token is returned so the
   * caller can open the card. `null` when the code cannot be used.
   */
  async consume(email: string, code: string): Promise<{ token: string } | null> {
    try {
      return await this.api.request<{ token: string }>('POST', '/recovery/consume', {
        email: email.trim(),
        code: code.trim(),
      });
    } catch (err) {
      if (isApiError(err) && err.failure.kind === 'rejected' && err.failure.code === 'invalid_code') {
        return null;
      }
      throw err;
    }
  }
}
