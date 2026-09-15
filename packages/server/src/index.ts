/**
 * Entrypoint. The only place that reads `process.env` and opens a real socket.
 */

import { createPool } from './db';
import { loadEnv } from './env';
import { buildServer, dbReachability, installShutdownHandlers } from './server';

const env = loadEnv();
const db = createPool(env.databaseUrl);
const app = buildServer({
  logLevel: env.logLevel,
  isDbReachable: dbReachability(db),
});

installShutdownHandlers(app, () => db.end());

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await db.end();
  process.exit(1);
}
