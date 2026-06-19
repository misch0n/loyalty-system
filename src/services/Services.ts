/**
 * Composition root.
 *
 * The ONLY place that names concrete adapters. It picks the DataStore and
 * Transport implementations from feature flags and wires the services. Swapping
 * the prototype for production is a change here and nowhere else:
 *   - DataStore: IndexedDbStore → ApiStore
 *   - Transport: LocalBridge/Peer → real server-mediated flow
 */

import type { DataStore } from '../ports/DataStore';
import type { Transport } from '../ports/Transport';
import { storeKind, transportKind, isProduction } from '../config/env';
import { IndexedDbStore } from '../adapters/storage/IndexedDbStore';
import { ApiStore } from '../adapters/storage/ApiStore';
import { LocalBridgeTransport } from '../adapters/transport/LocalBridgeTransport';

import { AuditService } from './AuditService';
import { ConfigService } from './ConfigService';
import { StaffService } from './StaffService';
import { CustomerService } from './CustomerService';
import { LoyaltyService } from './LoyaltyService';

export interface Services {
  store: DataStore;
  transport: Transport;
  audit: AuditService;
  config: ConfigService;
  staff: StaffService;
  customers: CustomerService;
  loyalty: LoyaltyService;
}

function createStore(): DataStore {
  if (storeKind === 'api') {
    // Production wiring. The base URL would come from build-time env.
    return new ApiStore({ baseUrl: import.meta.env.VITE_API_BASE ?? '/api' });
  }
  return new IndexedDbStore();
}

async function createTransport(): Promise<Transport> {
  // DEV-ONLY peer transport: lazy-imported so it tree-shakes out of the default
  // bundle, and never selected in a production build.
  if (transportKind === 'peer' && !isProduction) {
    const { PeerTransport } = await import('../adapters/transport/dev/PeerTransport');
    return new PeerTransport();
  }
  return new LocalBridgeTransport();
}

export async function createServices(): Promise<Services> {
  const store = createStore();
  const transport = await createTransport();
  const audit = new AuditService(store);
  return {
    store,
    transport,
    audit,
    config: new ConfigService(store, audit),
    staff: new StaffService(store, audit),
    customers: new CustomerService(store, audit),
    loyalty: new LoyaltyService(store, audit),
  };
}
