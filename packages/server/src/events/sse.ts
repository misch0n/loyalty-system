/**
 * The `text/event-stream` wire format, and nothing else.
 *
 * Twenty lines rather than a dependency, for the reason `auth/cookies.ts` is
 * hand-written: nothing here is cryptographic or subtle, and `CLAUDE.md` rules
 * out dependencies the spec did not call for. The format is three field names
 * and a blank line.
 *
 * The one rule worth stating: **a `data:` line may not contain a newline**, or
 * the parser on the other side sees two fields. Every payload goes through
 * `JSON.stringify`, which escapes newlines inside strings and emits none of its
 * own, so one line is always enough — which is why {@link formatEvent} takes a
 * value rather than a string.
 */

/**
 * The headers an SSE response needs, including the two that exist because of
 * what sits in front of it.
 *
 * `no-transform` stops a proxy gzipping the stream into a buffer that only
 * flushes when it is full, and `x-accel-buffering: no` tells **nginx** — which
 * Phase 8 puts in front of the API — not to buffer the response. Without the
 * second one every event arrives minutes late, or at shutdown, and the channel
 * looks broken rather than buffered.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

/**
 * How long a browser waits before reconnecting a dropped stream. `EventSource`
 * reconnects on its own; this only sets the delay, and three seconds is short
 * enough that a customer watching their card barely notices a dropped
 * connection and long enough that a restarting server is not stampeded.
 */
export const RETRY_MS = 3000;

/**
 * A comment line. Carries nothing, and exists to be written periodically: an
 * idle connection is what a proxy or a phone's radio reaps, and a byte every
 * half-minute is what keeps it from being idle.
 */
export function formatComment(text: string): string {
  return `: ${text}\n\n`;
}

export function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatRetry(ms: number): string {
  return `retry: ${ms}\n\n`;
}
