import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vite does not read tsconfig `paths`, so the `@cafe/shared/*` alias is declared
 * here as well. Both must point at the same place — Phase 10 repoints both.
 *
 * `@cafe/conformance` is the shared `DataStore` conformance suite, run against
 * both the prototype and the production store. One suite, imported — never
 * copied, for the same reason `domain/` and `ports/` are imported: a second copy
 * of the contract is a contract that drifts.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@cafe\/shared\/(.*)$/,
        replacement: fileURLToPath(new URL('../../src/$1', import.meta.url)),
      },
      {
        find: '@cafe/conformance',
        replacement: fileURLToPath(
          new URL('../../tests/conformance/dataStoreConformance.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Migration/store tests share one database; running files in parallel would
    // have them trample each other's schema.
    fileParallelism: false,
  },
});
