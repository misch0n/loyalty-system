/**
 * ServerIdentityStore — the `IdentityStore` port over the server's `/me` routes
 * (`packages/server/src/routes/identity.ts`).
 *
 * "This browser remembers which card it belongs to" is an HttpOnly cookie the
 * server sets, not something script holds. It is the only recognition that
 * survives iOS tracking prevention, which prunes script-written storage — the
 * reason `LocalStorageIdentityStore` was retired (`UI-RECONCILIATION.md` C6).
 *
 *   `get()`      → `GET /me`    → `{ token: string | null }`
 *   `set(token)` → `PUT /me`    — presenting the token is the authorization
 *   `clear()`    → `DELETE /me` — succeeds with nothing to forget
 *
 * Most binding happens without this adapter: `POST /customers`,
 * `GET /customers/by-token/:token` and a completed recovery each set the cookie
 * themselves. Only the opaque token ever crosses the wire — never PII. A failure
 * throws the {@link ApiError} every API call throws; callers decide what "could
 * not ask" means for them.
 */
import type { IdentityStore } from '@cafe/shared/ports/IdentityStore';
import type { ApiClient } from '../http/ApiClient';

export class ServerIdentityStore implements IdentityStore {
  constructor(private readonly api: ApiClient) {}

  async get(): Promise<string | null> {
    const { token } = await this.api.request<{ token: string | null }>('GET', '/me');
    return token ?? null;
  }

  async set(token: string): Promise<void> {
    await this.api.request('PUT', '/me', { token });
  }

  async clear(): Promise<void> {
    await this.api.request('DELETE', '/me');
  }
}
