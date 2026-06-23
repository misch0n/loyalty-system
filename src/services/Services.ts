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
import type { WalletProvider } from '../ports/WalletProvider';
import {
  storeKind,
  transportKind,
  walletKind,
  emailConfig,
  isEmailConfigured,
} from '../config/env';
import { IndexedDbStore } from '../adapters/storage/IndexedDbStore';
import { ApiStore } from '../adapters/storage/ApiStore';
import { EmailJsMailer } from '../adapters/email/EmailJsMailer';
import { NoopMailer } from '../adapters/email/NoopMailer';
import { LocalStorageIdentityStore } from '../adapters/identity/LocalStorageIdentityStore';
import { StaticWalletProvider } from '../adapters/wallet/StaticWalletProvider';
import { ServerWalletProvider } from '../adapters/wallet/ServerWalletProvider';
import { createObservableStore } from '../adapters/sync/ObservableStore';
import { createSwitchableStore } from '../adapters/sync/SwitchableStore';
import { DB_NAME } from '../adapters/storage/schema';

import { AuditService } from './AuditService';
import { ConfigService } from './ConfigService';
import { StaffService } from './StaffService';
import { CustomerService } from './CustomerService';
import { LoyaltyService } from './LoyaltyService';
import { RecoveryService } from './RecoveryService';

/**
 * Prototype sync kit — the seam that lets a paired device stand in for the
 * server. `observable` is the local store wrapped to emit on every mutation (the
 * host serves + watches it); `switchable` is the live store the services use —
 * flipping its target to a remote peer-client routes all reads/writes to the
 * paired host with no service/UI changes.
 */
export interface SyncKit {
  observable: { store: DataStore; onMutate(cb: () => void): () => void };
  switchable: { store: DataStore; setTarget(t: DataStore): void; getTarget(): DataStore };
}

export interface Services {
  store: DataStore;
  transport: Transport;
  mailer: Mailer;
  identity: IdentityStore;
  wallet: WalletProvider;
  sync: SyncKit;
  audit: AuditService;
  config: ConfigService;
  staff: StaffService;
  customers: CustomerService;
  loyalty: LoyaltyService;
  recovery: RecoveryService;
  /** Prototype-only: wipe this device's local store (used by the Reset action). */
  reset(): Promise<void>;
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

function createWalletProvider(store: DataStore): WalletProvider {
  // Production swaps the static, key-free map for server-side mint-on-demand.
  return walletKind === 'server'
    ? new ServerWalletProvider()
    : new StaticWalletProvider(store);
}

export async function createServices(): Promise<Services> {
  // Local store → observable (emits on mutation) → switchable (the live target).
  // Services bind to the switchable store, so pairing can re-point it at a remote
  // peer-client without touching any service or screen.
  const local = createStore();
  const observable = createObservableStore(local);
  const switchable = createSwitchableStore(observable.store);
  const store = switchable.store;

  const transport = await createTransport();
  const mailer = createMailer();
  const identity = createIdentityStore();
  const wallet = createWalletProvider(store);
  const audit = new AuditService(store);
  return {
    store,
    transport,
    mailer,
    identity,
    wallet,
    sync: { observable, switchable },
    audit,
    config: new ConfigService(store, audit),
    staff: new StaffService(store, audit),
    customers: new CustomerService(store, audit, mailer),
    loyalty: new LoyaltyService(store, audit, mailer),
    recovery: new RecoveryService(store, mailer, audit),
    reset: async () => {
      // Close our connection first so deleteDatabase isn't blocked, then drop it.
      await (local as { close?: () => Promise<void> }).close?.();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    },
  };
}
