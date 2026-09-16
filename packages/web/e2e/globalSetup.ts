/**
 * Vitest global setup for the e2e suite: serve the production build with
 * `vite preview` on a fixed port, expose its URL via `E2E_URL`, and tear it down
 * after the run. `npm run e2e` builds first, so `dist/` exists here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4317;
const BASE = `http://localhost:${PORT}/loyalty-system/`;

export default async function setup(): Promise<() => Promise<void>> {
  const server: ChildProcess = spawn(
    'npm',
    ['run', 'preview', '--', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', env: process.env },
  );
  process.env.E2E_URL = BASE;

  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      const res = await fetch(BASE);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      server.kill('SIGTERM');
      throw new Error(`preview server did not start at ${BASE}`);
    }
    await sleep(300);
  }

  return async () => {
    server.kill('SIGTERM');
  };
}
