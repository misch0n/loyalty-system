import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbStore } from '../../src/adapters/storage/IndexedDbStore';
import { AuditService } from '../../src/services/AuditService';
import { ConfigService } from '../../src/services/ConfigService';
import { StaffService } from '../../src/services/StaffService';
import { CustomerService } from '../../src/services/CustomerService';
import { LoyaltyService } from '../../src/services/LoyaltyService';
import type { Actor } from '../../src/services/types';

/** Build a clean, isolated set of services on a fresh in-memory IndexedDB. */
export function freshServices() {
  // Reset the IndexedDB backing so each test starts empty.
  globalThis.indexedDB = new IDBFactory();
  const store = new IndexedDbStore();
  const audit = new AuditService(store);
  return {
    store,
    audit,
    config: new ConfigService(store, audit),
    staff: new StaffService(store, audit),
    customers: new CustomerService(store, audit),
    loyalty: new LoyaltyService(store, audit),
  };
}

export const STAFF: Actor = { id: 's1', username: 'staff', role: 'staff' };
export const ADMIN: Actor = { id: 'a1', username: 'admin', role: 'admin' };
