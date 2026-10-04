/**
 * Composition root.
 *
 * The ONLY place that names concrete adapters. Phase 6 left it with very little
 * to decide: the triage deleted the wallet and transport seams, and retiring the
 * IndexedDB prototype left one store. Five seams became three, and each of the
 * three now has one implementation.
 *
 *   - `DataStore`     → `ApiStore` (the Fastify API). There is no other.
 *   - `Mailer`        → `NoopMailer`. **The routes send the mail now** — the
 *                       welcome mail from `POST /customers`, the
 *                       reward-available one from the commit — so a client-side
 *                       mailer here would mean every customer got each one
 *                       twice. `EmailJsMailer` is gone; it shipped its provider
 *                       credential in the bundle, where anyone could drive it.
 *   - `IdentityStore` → `ServerIdentityStore` (`/me`). The device is bound by
 *                       an HttpOnly cookie the server sets, the recognition
 *                       that survives iOS ITP; `LocalStorageIdentityStore` is
 *                       gone (UI-3, `UI-RECONCILIATION.md` C6).
 *
 * `ApiStore` sits on one `ApiClient`, which is also exposed — as its subscribe
 * half only — as `connection`: the global handlers listen there for a session
 * that ended and for the server going away (`UI-RECONCILIATION.md` X2). The
 * services that need a route the port does not carry — sign-in, recovery,
 * alerts — and the identity adapter get the same client, so those calls share
 * its cookies, its CSRF header and its one typed failure.
 *
 * No service writes an audit row or sends mail: the routes do both, from the
 * session (UI-2, `UI-RECONCILIATION.md` P7).
 *
 * `options` exists for the test harness, which drives the real server from Node
 * and so needs its own `fetch` (a cookie jar) and its own CSRF reader.
 */

import type { DataStore } from '@cafe/shared/ports/DataStore';
import type { Mailer } from '@cafe/shared/ports/Mailer';
import type { IdentityStore } from '@cafe/shared/ports/IdentityStore';
import { apiBaseUrl } from '../config/env';
import { ApiClient, type ApiClientOptions, type ApiEvents } from '../adapters/http/ApiClient';
import { ApiStore } from '../adapters/storage/ApiStore';
import { NoopMailer } from '../adapters/email/NoopMailer';
import { ServerIdentityStore } from '../adapters/identity/ServerIdentityStore';

import { AuditService } from './AuditService';
import { ConfigService } from './ConfigService';
import { StaffService } from './StaffService';
import { CustomerService } from './CustomerService';
import { LoyaltyService } from './LoyaltyService';
import { RecoveryService } from './RecoveryService';

export interface Services {
  store: DataStore;
  /** What the API client saw — for the global session and connectivity handlers. */
  connection: ApiEvents;
  mailer: Mailer;
  identity: IdentityStore;
  audit: AuditService;
  config: ConfigService;
  staff: StaffService;
  customers: CustomerService;
  loyalty: LoyaltyService;
  recovery: RecoveryService;
}

export async function createServices(
  options: ApiClientOptions = { baseUrl: apiBaseUrl },
): Promise<Services> {
  const api = new ApiClient(options);
  const store: DataStore = new ApiStore(api);

  return {
    store,
    connection: api,
    mailer: new NoopMailer() satisfies Mailer,
    identity: new ServerIdentityStore(api) satisfies IdentityStore,
    audit: new AuditService(store),
    config: new ConfigService(store),
    staff: new StaffService(store, api),
    customers: new CustomerService(store),
    loyalty: new LoyaltyService(store, api),
    recovery: new RecoveryService(api),
  };
}
