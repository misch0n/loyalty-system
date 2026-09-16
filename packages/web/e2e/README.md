# e2e — UI regression & validation suite (Puppeteer)

Drives the **real built app** in headless Chrome and asserts on the rendered page.
Kept separate from the unit/component tests (`npm test`) so it never blocks them.

- `globalSetup.ts` — builds are produced by `npm run e2e`; this serves `dist/` via
  `vite preview` on a fixed port and exposes `E2E_URL`.
- `support.ts` — small, purpose-built helpers (fresh isolated session per test,
  text waiters, logo-gesture taps, PIN entry).
- `*.e2e.ts` — one spec per concern: `welcome`, `card`, `staff`, `prototype`,
  `regression` (the reference bug-list guards).

Run: `npm run e2e` (builds, serves, runs). Requires a Chrome download (Puppeteer
fetches one on install).
