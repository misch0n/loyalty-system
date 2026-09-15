/**
 * Entrypoint. The only place that reads `process.env` and opens a real socket.
 */

import { createAuthDeps } from './auth/guards';
import { createPool } from './db';
import { loadEnv } from './env';
import { PostgresStore } from './PostgresStore';
import { buildServer, dbReachability, installShutdownHandlers } from './server';

const env = loadEnv();
const db = createPool(env.databaseUrl);
const app = buildServer({
  logLevel: env.logLevel,
  isDbReachable: dbReachability(db),
  auth: createAuthDeps({
    db,
    store: new PostgresStore(db),
    cookieSecure: env.cookieSecure,
    allowedOrigins: env.allowedOrigins,
  }),
});

installShutdownHandlers(app, () => db.end());

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await db.end();
  process.exit(1);
}
