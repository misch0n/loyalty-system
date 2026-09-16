/**
 * Composition root.
 *
 * The ONLY place that names concrete adapters. Phase 6 left it with very little
 * to decide: the triage deleted the wallet and transport seams, and retiring the
 * IndexedDB prototype left one store. Five seams became three, and two of the
 * three now have one implementation each.
 *
 *   - `DataStore`     → `ApiStore` (the Fastify API). There is no other.
 *   - `Mailer`        → `NoopMailer`. **The routes send the mail now** — the
 *                       welcome mail from `POST /customers`, the
 *                       reward-available one from the commit — so a client-side
 *                       mailer here would mean every customer got each one
 *                       twice. `EmailJsMailer` is gone; it shipped its provider
 *                       credential in the bundle, where anyone could drive it.
 *   - `IdentityStore` → `LocalStorageIdentityStore`, for now. The server already
 *                       sets an HttpOnly identity cookie (`PUT /me`), which is
 *                       the recognition that survives iOS ITP; pointing the port
 *                       at it (`ServerIdentityStore`) is UI-pass work.
 *
 * **This does not work yet, knowingly.** `ApiStore.request` is unwritten, so
 * every call throws, and the services below still call methods the port no
 * longer has (`AuditService.appendAudit`, `RecoveryService`'s code pair,
 * `StaffService.loginWithPin`). That is the state BACKEND-PLAN's revoked-promise
 * box describes: the backend is built first and the UI is adjusted to it
 * afterwards, with every conflict recorded in `docs/UI-RECONCILIATION.md`.
 */

import type { DataStore } from '../ports/DataStore';
import type { Mailer } from '../ports/Mailer';
import type { IdentityStore } from '../ports/IdentityStore';
import { apiBaseUrl } from '../config/env';
import { ApiStore } from '../adapters/storage/ApiStore';
import { NoopMailer } from '../adapters/email/NoopMailer';
import { LocalStorageIdentityStore } from '../adapters/identity/LocalStorageIdentityStore';

import { AuditService } from './AuditService';
import { ConfigService } from './ConfigService';
import { StaffService } from './StaffService';
import { CustomerService } from './CustomerService';
import { LoyaltyService } from './LoyaltyService';
import { RecoveryService } from './RecoveryService';

export interface Services {
  store: DataStore;
  mailer: Mailer;
  identity: IdentityStore;
  audit: AuditService;
  config: ConfigService;
  staff: StaffService;
  customers: CustomerService;
  loyalty: LoyaltyService;
  recovery: RecoveryService;
}

export async function createServices(): Promise<Services> {
  const store: DataStore = new ApiStore({ baseUrl: apiBaseUrl });
  const mailer: Mailer = new NoopMailer();
  const identity: IdentityStore = new LocalStorageIdentityStore();
  const audit = new AuditService(store);

  return {
    store,
    mailer,
    identity,
    audit,
    config: new ConfigService(store, audit),
    staff: new StaffService(store, audit),
    customers: new CustomerService(store, audit, mailer),
    loyalty: new LoyaltyService(store, audit, mailer),
    recovery: new RecoveryService(store, mailer, audit),
  };
}
