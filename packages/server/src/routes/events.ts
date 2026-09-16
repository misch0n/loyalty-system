/**
 * `GET /events` — the realtime channel (BACKEND-PLAN §3-C-15, Phase 7).
 *
 * The prototype's cross-device liveness came from the PeerJS pairing layer: a
 * till hosted its peers' `DataStore` over RPC, so a commit at the counter bumped
 * `dataVersion` on the customer's phone and the card re-read itself. Phase 6
 * deleted that layer, and with it the only reason a customer's open card ever
 * refreshed. Without a replacement the screen is simply wrong until someone
 * pulls to refresh, which is the one thing a loyalty card must not be while the
 * customer is standing at the counter watching it.
 *
 * This is the replacement, and it is deliberately the smallest thing that works:
 * a one-way Server-Sent Events stream carrying a **signal**, never data. The
 * screen hears "your card changed, because of a commit" and re-reads through
 * `GET /customers/:id/state` — a route it was already entitled to, with the
 * authorization it already had. SSE rather than WebSockets because the traffic
 * is one-way, `EventSource` reconnects by itself, and it is plain HTTP over the
 * same cookie session: no second authentication path, no second protocol for
 * nginx to proxy.
 *
 * **What a stream listens to is derived from the session**, exactly as
 * `GET /audit` derives its actor filter (`routes/activity.ts`). A customer's
 * device hears about its own card; a till hears about its own actor's activity.
 * There is no way to ask for a subject, which is what stops this becoming a
 * cross-account read with a different verb — the rule SCOPE-DECISIONS §1 spends
 * a whole route file enforcing.
 *
 * Anonymous callers are refused. `GET /auth/session` is public because "not
 * signed in" is a real answer to "am I signed in?"; here there is genuinely
 * nothing to subscribe to, and holding a socket open to say so would be worse
 * than a 401.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthDeps, AuthState } from '../auth/guards.js';
import { MAX_STREAMS_PER_SESSION, topicOf, type Subscriber, type Topic } from '../events/hub.js';
import { formatComment, formatEvent, formatRetry, RETRY_MS, SSE_HEADERS } from '../events/sse.js';

/**
 * How often a comment line goes down an idle stream.
 *
 * Under a minute, because that is the interval the things in the way reap at:
 * nginx's default `proxy_read_timeout` is 60s, and a phone's radio drops an idle
 * socket sooner. Twenty-five seconds is two beats inside that window, so one
 * lost packet does not cost the connection.
 */
const KEEPALIVE_MS = 25_000;

/**
 * Bytes a stream may have queued before it is hung up on.
 *
 * A subscriber that has stopped reading — a suspended tab, a phone in a pocket,
 * a dead TCP connection the kernel has not given up on yet — makes `write`
 * buffer in this process rather than fail. Unbounded, that is a memory leak with
 * an HTTP request as its trigger. Hanging up is safe precisely because the
 * events carry no data: the client reconnects and re-reads, and has lost
 * nothing.
 */
const MAX_BUFFERED_BYTES = 64 * 1024;

/**
 * The subjects a session may hear about — its own, and only its own.
 *
 * `null` means "nothing to listen to", which covers both an anonymous caller and
 * a staff session that has idled into `locked`. A locked terminal is showing the
 * PIN pad; it has no feed to keep fresh, and the stream would otherwise be the
 * one part of the session the idle lock did not reach.
 */
function topicsFor(auth: AuthState | null): Topic[] | null {
  if (!auth) return null;
  if (auth.record.kind === 'customer') {
    return auth.record.customerId ? [topicOf('customer', auth.record.customerId)] : null;
  }
  if (auth.state !== 'active' || !auth.actor) return null;
  return [topicOf('staff', auth.actor.id)];
}

export function registerEventRoutes(app: FastifyInstance, deps: AuthDeps): void {
  /**
   * Nothing else in the server holds a socket open, so nothing else had to think
   * about shutdown. An SSE stream would keep `app.close()` waiting forever —
   * which means a `SIGTERM` that never completes and an orchestrator escalating
   * to `SIGKILL` mid-request. `preClose` runs before Fastify stops the server, so
   * the streams are ended first and the close proceeds normally.
   */
  app.addHook('preClose', async () => {
    deps.events.closeAll();
  });

  app.get('/events', async (request, reply) => {
    const auth = request.auth;
    if (auth?.record.kind === 'staff' && auth.state === 'locked') {
      // The same distinction `requireStaff` draws: `locked` tells the SPA to
      // show the PIN pad, `unauthorized` to show the full sign-in form.
      return reply.code(401).send({ error: 'locked' });
    }
    const topics = topicsFor(auth);
    if (!auth || !topics) return reply.code(401).send({ error: 'unauthorized' });

    const raw = reply.raw;
    let unsubscribe: (() => void) | null = null;
    let keepAlive: NodeJS.Timeout | null = null;

    /** Stops listening and stops the timer, without touching the socket. */
    const stop = (): void => {
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    /** Stops listening and ends the response. Safe to call twice. */
    const finish = (): void => {
      stop();
      if (!raw.writableEnded) raw.end();
    };

    const write = (chunk: string): void => {
      if (raw.writableEnded) {
        stop();
        return;
      }
      raw.write(chunk);
      if (raw.writableLength > MAX_BUFFERED_BYTES) finish();
    };

    const subscriber: Subscriber = {
      sessionId: auth.record.id,
      topics,
      deliver: (event) => write(formatEvent('changed', event)),
      close: finish,
    };

    // Subscribed before the response is hijacked, so a refusal is still an
    // ordinary JSON reply. Nothing can interleave: this runs to the `writeHead`
    // below without awaiting, and a publish only ever happens inside another
    // handler.
    unsubscribe = deps.events.subscribe(subscriber);
    if (!unsubscribe) {
      return reply.code(429).send({ error: 'too_many_streams', limit: MAX_STREAMS_PER_SESSION });
    }

    reply.hijack();
    raw.writeHead(200, { ...SSE_HEADERS });
    raw.write(formatRetry(RETRY_MS));
    // Proof the stream is live, and a statement of what it covers. The ids are
    // the device's own and carry no PII — that is the opaque-identity design
    // working — so echoing them costs nothing and makes a dead channel
    // diagnosable from the browser's network panel.
    raw.write(formatEvent('hello', { scopes: topics }));

    keepAlive = setInterval(() => write(formatComment('keep-alive')), KEEPALIVE_MS);
    // A pending timer must never be the reason the process stays alive.
    keepAlive.unref();

    // The client going away is the ordinary end of a stream, not an error.
    request.raw.on('close', stop);
    return reply;
  });
}
