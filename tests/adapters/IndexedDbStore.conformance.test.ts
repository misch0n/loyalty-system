/**
 * The prototype adapter, held to the shared `DataStore` conformance suite.
 *
 * The suite itself lives in `tests/conformance/` and is run verbatim against
 * `PostgresStore` too (`packages/server/src/PostgresStore.test.ts`). Behaviour
 * specific to IndexedDB — the seed, the clean-reset upgrade, the short-code
 * backfill, self-healing a wedged database, `reset()` — stays in
 * `IndexedDbStore.test.ts`, beside the thing it is specific to.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbStore } from '../../src/adapters/storage/IndexedDbStore';
import { describeDataStoreConformance } from '../conformance/dataStoreConformance';

describeDataStoreConformance({
  name: 'IndexedDbStore',
  async create() {
    // A brand-new factory is the browser equivalent of a fresh database.
    globalThis.indexedDB = new IDBFactory();
    return new IndexedDbStore();
  },
  async dispose(store) {
    await (store as IndexedDbStore).close();
  },
});
