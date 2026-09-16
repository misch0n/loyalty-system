import { defineConfig } from 'vitest/config';

/**
 * `domain/` has no I/O, no React and no browser APIs, so its tests need no
 * environment beyond plain Node and no aliases at all — they import the source
 * directly. This suite is green independently of the SPA, which is the reason it
 * lives here rather than in `packages/web`: the server depends on `domain/`, and
 * a contract's tests should not sit inside a package that is knowingly red.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
