/**
 * IndexedDB schema definition + default seed values.
 *
 * Kept separate from the adapter so the store shape is easy to review and the
 * seed data (default config + mock staff accounts) is in one obvious place.
 */

import type { DBSchema } from 'idb';
import type {
  AuditLogEntry,
  Customer,
  LoyaltyTransaction,
  ProgramConfig,
  StaffAccount,
} from '../../domain/models';

export const DB_NAME = 'cafe-loyalty';
export const DB_VERSION = 3;

/** The legacy reward threshold, superseded by the 8-coffee default (see seed). */
export const LEGACY_POINTS_PER_REWARD = 10;

export const CONFIG_KEY = 'singleton';

/**
 * A single-use, short-expiry recovery code. Maps an opaque random secret to a
 * customerId only — never any PII. Consumed atomically (see IndexedDbStore).
 */
export interface RecoveryCodeRecord {
  code: string;
  customerId: string;
  expiresAt: number; // epoch ms
  usedAt?: number; // epoch ms; set once on consume
}

export interface LoyaltyDB extends DBSchema {
  config: {
    key: string;
    value: ProgramConfig & { id: string };
  };
  staff: {
    key: string;
    value: StaffAccount;
    indexes: { byUsername: string };
  };
  customers: {
    key: string;
    value: Customer;
    indexes: { byToken: string; byStatus: string };
  };
  transactions: {
    key: string;
    value: LoyaltyTransaction;
    indexes: { byCustomer: string };
  };
  audit: {
    key: string;
    value: AuditLogEntry;
    indexes: { byTimestamp: string; byAction: string };
  };
  recoveryCodes: {
    key: string;
    value: RecoveryCodeRecord;
  };
}

export const DEFAULT_CONFIG: ProgramConfig = {
  pointsPerReward: 8,
  rewardDescription: 'Free regular coffee',
  pointsPerPurchase: 1,
  maxPointsPerTransaction: 3,
  cardInactivityDays: 0,
};

/**
 * Mock staff for the prototype. Passwords are plain strings ONLY because auth
 * is mocked here — production hashes them server-side. This is demo seed data,
 * never real credentials.
 */
export const SEED_STAFF: StaffAccount[] = [
  {
    id: 'seed-admin',
    username: 'admin',
    name: 'Manager',
    passwordHash: 'admin',
    pin: '4321',
    role: 'admin',
    active: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-staff',
    username: 'staff',
    name: 'Sam',
    passwordHash: 'staff',
    pin: '1234',
    role: 'staff',
    active: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-staff-2',
    username: 'priya',
    name: 'Priya',
    passwordHash: 'priya',
    pin: '2468',
    role: 'staff',
    active: true,
    createdAt: '2024-01-02T00:00:00.000Z',
  },
];
