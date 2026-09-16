/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

/**
 * Separate config for the Puppeteer e2e suite so it never runs under `npm test`.
 * Node environment (Puppeteer drives a real headless Chrome), serial, generous
 * timeouts. The app under test is served by `e2e/globalSetup.ts`.
 */
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    globalSetup: ['e2e/globalSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 45000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
