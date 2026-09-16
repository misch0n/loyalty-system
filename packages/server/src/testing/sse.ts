/**
 * An `EventSource`-shaped client for the `/events` tests.
 *
 * `app.inject()` cannot test this the way it tests every other route. A stream
 * has no end, and the assertions that matter are about *when* something arrives
 * and whether the socket is still open — properties a simulated request does not
 * have. So these tests do what every phase's smoke check does and use a real
 * listening socket, with a real HTTP client that parses the wire format.
 *
 * Test scaffolding only: nothing outside `src/testing/` may import it, and
 * `tsconfig.build.json` keeps the whole directory out of `dist/`.
 */

import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

/** One parsed `event:`/`data:` pair. Comment lines are counted, not queued. */
export interface SseMessage {
  event: string;
  data: Record<string, unknown>;
}

export interface SseOptions {
  /** Cookies to present, as a `Cookie` header value. */
  cookie?: string;
}

/**
 * Starts the app on a kernel-chosen port and returns its origin, so suites can
 * run side by side without agreeing on a number.
 */
export async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

export class SseClient {
  /** Everything received, before framing is stripped — for a refused response. */
  private raw = '';
  private pending = '';
  private readonly queue: SseMessage[] = [];
  private waiting: ((message: SseMessage) => void) | null = null;
  private ended = false;
  private readonly finished: Promise<void>;
  /** Keep-alive lines seen. Nothing asserts on it; it is here for diagnosis. */
  comments = 0;

  constructor(
    readonly statusCode: number,
    readonly headers: Record<string, string | string[] | undefined>,
    private readonly response: IncomingMessage,
  ) {
    response.setEncoding('utf8');
    this.finished = new Promise<void>((resolve) => {
      const done = (): void => {
        this.ended = true;
        resolve();
      };
      response.on('end', done);
      response.on('close', done);
    });
    response.on('data', (chunk: string) => this.consume(chunk));
  }

  /** True once the server has ended the stream. */
  get closed(): boolean {
    return this.ended;
  }

  private consume(chunk: string): void {
    this.raw += chunk;
    this.pending += chunk;
    let split = this.pending.indexOf('\n\n');
    while (split !== -1) {
      this.push(this.pending.slice(0, split));
      this.pending = this.pending.slice(split + 2);
      split = this.pending.indexOf('\n\n');
    }
  }

  private push(block: string): void {
    if (block.startsWith(':')) {
      this.comments += 1;
      return;
    }
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    // A `retry:`-only block is framing, not a message.
    if (!data) return;

    const message: SseMessage = { event, data: JSON.parse(data) as Record<string, unknown> };
    const resolve = this.waiting;
    if (resolve) {
      this.waiting = null;
      resolve(message);
      return;
    }
    this.queue.push(message);
  }

  /**
   * The next message, waiting for it if it has not arrived. Rejects on timeout
   * rather than hanging, so a channel that silently stopped working fails the
   * test it broke instead of the whole run.
   */
  next(timeoutMs = 3000): Promise<SseMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error(`No SSE message within ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiting = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
  }

  /**
   * Asserts the opposite: that *nothing* arrives in the window. The proof that a
   * stream hears only its own subject has to be a silence, and a silence can only
   * be established by waiting through one.
   */
  async silentFor(ms: number): Promise<void> {
    const seen = await this.next(ms).catch(() => null);
    if (seen) throw new Error(`Expected silence, got ${seen.event}: ${JSON.stringify(seen.data)}`);
  }

  /** Waits for the server to end the stream. */
  async ending(timeoutMs = 3000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Stream still open after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      await Promise.race([this.finished, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The whole body of a refused (non-streaming) response. */
  async body(): Promise<string> {
    await this.finished;
    return this.raw;
  }

  close(): void {
    this.ended = true;
    this.response.destroy();
  }
}

/** Opens a stream and resolves once the response headers are in. */
export async function openSse(
  origin: string,
  path: string,
  options: SseOptions = {},
): Promise<SseClient> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (response) => {
        resolve(new SseClient(response.statusCode ?? 0, response.headers, response));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
