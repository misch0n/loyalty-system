import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vite does not read tsconfig `paths`, so the `@cafe/shared/*` alias is declared
 * here as well. Both must point at the same place — Phase 10 repoints both.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@cafe\/shared\/(.*)$/,
        replacement: fileURLToPath(new URL('../../src/$1', import.meta.url)),
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
