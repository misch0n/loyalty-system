/**
 * Entrypoint. The only place that reads `process.env` and opens a real socket.
 */

import { createAuthDeps } from './auth/guards';
import { createPool } from './db';
import { loadEnv } from './env';
import { createMailer, mailStartupNotice } from './mail';
import { PostgresStore } from './PostgresStore';
import { buildServer, dbReachability, installShutdownHandlers } from './server';

const env = loadEnv();
const db = createPool(env.databaseUrl);
const deps = createAuthDeps({
  db,
  store: new PostgresStore(db),
  cookieSecure: env.cookieSecure,
  allowedOrigins: env.allowedOrigins,
  appUrl: env.appUrl,
  // The sink is a closure, not the logger: `app` does not exist yet, and
  // `LogMailer` only calls it when something is actually sent.
  mailer: createMailer(env, (details, message) => app.log.warn(details, message)),
});
const app = buildServer({
  logLevel: env.logLevel,
  isDbReachable: dbReachability(db),
  auth: deps,
});

const notice = mailStartupNotice(env);
app.log[notice.level]({ kind: 'startup' }, notice.message);

// Drain before the pool closes: a recovery mail in flight when SIGTERM arrives
// should finish, not die against a closed connection.
installShutdownHandlers(app, async () => {
  await deps.background.drain();
  await db.end();
});

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await db.end();
  process.exit(1);
}
