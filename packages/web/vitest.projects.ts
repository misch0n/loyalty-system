import { defineWorkspace } from 'vitest/config';

/**
 * The SPA's two test projects, run together by `npm test`.
 *
 *   - **ui** — screens, components, pure helpers, the adapters' unit tests. jsdom;
 *     everything below the services is stubbed with `vi.fn()` through
 *     `ServicesProvider`. Needs nothing running: `npx vitest --project ui`.
 *   - **live** — the services and `ApiStore` against the **real server and a test
 *     Postgres** (register P6: there is no fake `DataStore`). Node; one file at a
 *     time, because the files share one server and some of what they change —
 *     the program config, "sign out all devices" — is global. It fails, never
 *     skips, without a database (`tests/live/globalSetup.ts`).
 *
 * Named so Vitest does not auto-detect it: `vite.config.ts` points at it, and
 * the e2e config (`vitest.e2e.config.ts`, same directory) stays a single project.
 */
export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: {
      name: 'ui',
      environment: 'jsdom',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/ui/**/*.test.tsx'],
      exclude: ['tests/live/**'],
    },
  },
  {
    test: {
      name: 'live',
      environment: 'node',
      globals: true,
      include: ['tests/live/**/*.test.ts'],
      globalSetup: ['tests/live/globalSetup.ts'],
      // One file at a time. `fileParallelism` alone is not honoured per project in
      // Vitest 2.1, so the pool is pinned to a single fork as well.
      fileParallelism: false,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 15_000,
      hookTimeout: 30_000,
    },
  },
]);
