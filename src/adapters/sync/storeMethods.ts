/**
 * Canonical list of DataStore method names + which ones mutate.
 *
 * Single source of truth shared by the sync adapters (ObservableStore,
 * SwitchableStore, PeerClientStore, StoreServer) so the proxy/dispatch layers
 * stay in lockstep with the DataStore port. If a method is added to DataStore,
 * add it here too.
 */

import type { DataStore } from '../../ports/DataStore';

/** Every DataStore method. `satisfies` ties this to the port at compile time. */
export const STORE_METHODS = [
  'createCustomer',
  'getCustomerById',
  'getCustomerByToken',
  'findCustomers',
  'updateCustomer',
  'recordConsent',
  'rotateToken',
  'softDeleteCustomer',
  'appendTransaction',
  'listTransactions',
  'redeemReward',
  'createStaff',
  'getStaffByUsername',
  'getStaffByPin',
  'setStaffActive',
  'setStaffPassword',
  'listStaff',
  'getConfig',
  'updateConfig',
  'createRecoveryCode',
  'consumeRecoveryCode',
  'appendAudit',
  'listAudit',
  'countActiveCustomers',
  'listAllTransactions',
  'exportAll',
  'importAll',
] as const satisfies ReadonlyArray<keyof DataStore>;

export type StoreMethod = (typeof STORE_METHODS)[number];

export const STORE_METHOD_SET: ReadonlySet<string> = new Set(STORE_METHODS);

/** Methods that write — used to decide when to emit a change / push `changed`. */
export const MUTATING_METHODS: ReadonlySet<StoreMethod> = new Set<StoreMethod>([
  'createCustomer',
  'updateCustomer',
  'recordConsent',
  'rotateToken',
  'softDeleteCustomer',
  'appendTransaction',
  'redeemReward',
  'createStaff',
  'setStaffActive',
  'setStaffPassword',
  'updateConfig',
  'createRecoveryCode',
  'consumeRecoveryCode',
  'appendAudit',
  'importAll',
]);
