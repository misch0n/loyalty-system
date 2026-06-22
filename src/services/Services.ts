/**
 * Composition root.
 *
 * The ONLY place that names concrete adapters. It picks the DataStore,
 * Transport, Mailer and IdentityStore implementations from feature flags and
 * wires the services. Swapping the prototype for production is a change here and
 * nowhere else:
 *   - DataStore:     IndexedDbStore → ApiStore
 *   - Transport:     PeerTransport (PeerJS+TURN) → ServerTransport (server flow)
 *   - Mailer:        EmailJsMailer → server-side provider
 *   - IdentityStore: LocalStorageIdentityStore → server cookie/session
 */

import type { DataStore } from '../ports/DataStore';
import type { Transport } from '../ports/Transport';
import type { Mailer } from '../ports/Mailer';
import type { IdentityStore } from '../ports/IdentityStore';
import { storeKind, transportKind, emailConfig, isEmailConfigured } from '../config/env';
import { IndexedDbStore } from '../adapters/storage/IndexedDbStore';
import { ApiStore } from '../adapters/storage/ApiStore';
import { EmailJsMailer } from '../adapters/email/EmailJsMailer';
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
  transport: Transport;
  mailer: Mailer;
  identity: IdentityStore;
  audit: AuditService;
  config: ConfigService;
  staff: StaffService;
  customers: CustomerService;
  loyalty: LoyaltyService;
  recovery: RecoveryService;
}

function createStore(): DataStore {
  if (storeKind === 'api') {
    // Production wiring. The base URL would come from build-time env.
    return new ApiStore({ baseUrl: import.meta.env.VITE_API_BASE ?? '/api' });
  }
  return new IndexedDbStore();
}

async function createTransport(): Promise<Transport> {
  if (transportKind === 'server') {
    // Production: server-mediated registration. Dynamic import + the dead branch
    // means PeerJS tree-shakes out of a production-configured build.
    const { ServerTransport } = await import('../adapters/transport/ServerTransport');
    return new ServerTransport();
  }
  // Prototype's REAL transport: PeerJS + TURN between two devices. This is the
  // default, including the deployed GitHub Pages build.
  const { PeerTransport } = await import('../adapters/transport/PeerTransport');
  return new PeerTransport();
}

function createMailer(): Mailer {
  // EmailJS when configured (secrets injected at build time); otherwise a no-op
  // so local dev without secrets doesn't crash on send.
  return isEmailConfigured ? new EmailJsMailer(emailConfig) : new NoopMailer();
}

function createIdentityStore(): IdentityStore {
  return new LocalStorageIdentityStore();
}

export async function createServices(): Promise<Services> {
  const store = createStore();
  const transport = await createTransport();
  const mailer = createMailer();
  const identity = createIdentityStore();
  const audit = new AuditService(store);
  return {
    store,
    transport,
    mailer,
    identity,
    audit,
    config: new ConfigService(store, audit),
    staff: new StaffService(store, audit),
    customers: new CustomerService(store, audit),
    loyalty: new LoyaltyService(store, audit, mailer),
    recovery: new RecoveryService(store, mailer, audit),
  };
}
