import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbStore } from '../../src/adapters/storage/IndexedDbStore';
import { AuditService } from '../../src/services/AuditService';
import { ConfigService } from '../../src/services/ConfigService';
import { StaffService } from '../../src/services/StaffService';
import { CustomerService } from '../../src/services/CustomerService';
import { LoyaltyService } from '../../src/services/LoyaltyService';
import { RecoveryService } from '../../src/services/RecoveryService';
import { NoopMailer } from '../../src/adapters/email/NoopMailer';
import type { Mailer } from '../../src/ports/Mailer';
import type { Actor } from '../../src/services/types';

/**
 * Build a clean, isolated set of services on a fresh in-memory IndexedDB.
 * Pass a spy Mailer to assert on outbound email (recovery / reward-available).
 */
export function freshServices(mailer: Mailer = new NoopMailer()) {
  // Reset the IndexedDB backing so each test starts empty.
  globalThis.indexedDB = new IDBFactory();
  const store = new IndexedDbStore();
  const audit = new AuditService(store);
  return {
    store,
    audit,
    mailer,
    config: new ConfigService(store, audit),
    staff: new StaffService(store, audit),
    customers: new CustomerService(store, audit),
    loyalty: new LoyaltyService(store, audit, mailer),
    recovery: new RecoveryService(store, mailer, audit),
  };
}

export const STAFF: Actor = { id: 's1', username: 'staff', role: 'staff' };
export const ADMIN: Actor = { id: 'a1', username: 'admin', role: 'admin' };
