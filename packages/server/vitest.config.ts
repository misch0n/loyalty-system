import { defineConfig } from 'vitest/config';

/**
 * No aliases. Phase 10 made `@cafe/shared` a real npm workspace package, so the
 * contract resolves through its `exports` map exactly as it does for `tsc` and
 * for `node dist/index.js` — one resolution mechanism for the type-check, the
 * test run and the running server. The `pretest` script builds it first.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    // The database gate. Aborts the whole run when no Postgres is reachable,
    // rather than letting the database-backed suites skip themselves into a
    // green tick that proved nothing. See src/testing/globalSetup.ts.
    globalSetup: ['./src/testing/globalSetup.ts'],
    // Migration/store tests share one database; running files in parallel would
    // have them trample each other's schema.
    fileParallelism: false,
  },
});
