/**
 * The Fastify instance.
 *
 * Built by a factory taking its dependencies explicitly, so tests can inject a
 * stub database check and never need a listening socket (`app.inject()`).
 * Routes land in Phase 4; Phase 0 is the health surface plus the cross-cutting
 * concerns every later route inherits — redacting logs and graceful shutdown.
 */

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { installSessionHooks, type AuthDeps } from './auth/guards';
import { checkDb, type Queryable } from './db';
import { loggerOptions, safeUrl } from './logging';
import { registerAuthRoutes } from './routes/auth';

export interface ServerOptions {
  logLevel: string;
  /**
   * Auth dependencies (Phase 3). Absent in the health-only tests, which need no
   * database — so the session hooks and the auth routes are installed only when
   * there is something for them to talk to.
   */
  auth?: AuthDeps;
  /**
   * Reports database reachability for `/readyz`. Injected rather than reached
   * for so a test can drive both the ready and the not-ready branch.
   */
  isDbReachable?: () => Promise<boolean>;
  /**
   * Where log lines go. Defaults to stdout; a test passes a collector so it can
   * assert on what was actually written.
   */
  loggerDestination?: { write: (line: string) => void };
}

/** Wires {@link checkDb} to a real pool, for the production entrypoint. */
export function dbReachability(db: Queryable): () => Promise<boolean> {
  return () => checkDb(db);
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      ...loggerOptions(options.logLevel),
      ...(options.loggerDestination ? { stream: options.loggerDestination } : {}),
    },
    // Cloudflare sits in front in production; without this every client address
    // in the logs and every rate-limit bucket in Phase 4 would be the proxy's.
    trustProxy: true,
  });

  /**
   * Replaces Fastify's default 404, which logs the **raw** request URL as a
   * plain message — straight past the request serializer, and straight into the
   * access log if that URL carried an email or a token. Ours logs the sanitized
   * path and answers with a fixed body that echoes nothing back.
   */
  app.setNotFoundHandler((request, reply) => {
    request.log.info({ path: safeUrl(request.url) }, 'route not found');
    return reply.code(404).send({ error: 'not_found' });
  });

  /**
   * One error shape for every failure, echoing nothing back.
   *
   * Fastify's default tells the caller which field failed validation and what it
   * failed on; an error thrown out of a handler is returned verbatim. Either can
   * carry a value the request supplied — BACKEND-PLAN §3-B-11 rules PII out of
   * error payloads as firmly as out of logs. The real error still reaches the
   * log, where the serializer scrubs it.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      return reply.code(status).send({ error: 'internal_error' });
    }
    request.log.info({ err: error }, 'request rejected');
    return reply.code(status).send({ error: error.validation ? 'invalid_request' : 'bad_request' });
  });

  if (options.auth) {
    installSessionHooks(app, options.auth);
    registerAuthRoutes(app, options.auth);
  }

  /**
   * Liveness. Answers as long as the process is up — deliberately does NOT touch
   * the database, so a database blip never has the orchestrator kill a healthy
   * API process.
   */
  app.get('/healthz', async () => ({ status: 'ok' }));

  /**
   * Readiness. Answers only when the server can actually serve, which means the
   * database is reachable. Returns 503 otherwise so a load balancer drains this
   * instance instead of sending it traffic it cannot fulfil.
   */
  app.get('/readyz', async (_request, reply) => {
    const reachable = options.isDbReachable ? await options.isDbReachable() : true;
    if (!reachable) {
      return reply.code(503).send({ status: 'unavailable', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok' };
  });

  return app;
}

/**
 * Closes the server on `SIGTERM`/`SIGINT` so in-flight requests finish before
 * the container goes away. `onClose` disposes anything the caller owns (the
 * pool). A second signal while draining exits immediately — an operator pressing
 * Ctrl-C twice means it.
 */
export function installShutdownHandlers(
  app: FastifyInstance,
  onClose: () => Promise<void> = async () => {},
): void {
  let closing = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) {
      app.log.warn({ signal }, 'second signal during shutdown — exiting now');
      process.exit(1);
    }
    closing = true;
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(onClose)
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
