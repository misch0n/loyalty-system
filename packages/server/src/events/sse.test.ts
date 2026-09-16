import { describe, expect, it } from 'vitest';
import { formatComment, formatEvent, formatRetry, RETRY_MS, SSE_HEADERS } from './sse.js';

describe('the SSE wire format', () => {
  it('frames an event as name, data and a blank line', () => {
    expect(formatEvent('changed', { scope: 'customer', id: 'cus-1', reason: 'commit' })).toBe(
      'event: changed\ndata: {"scope":"customer","id":"cus-1","reason":"commit"}\n\n',
    );
  });

  it('keeps a payload on one line however it is written', () => {
    // The format's one real rule: a newline inside `data:` would be read as a
    // second field. `JSON.stringify` escapes them, which is why the formatter
    // takes a value rather than a pre-rendered string.
    const framed = formatEvent('changed', { note: 'two\nlines' });
    expect(framed.split('\n').filter((line) => line.startsWith('data:'))).toHaveLength(1);
    expect(framed).toContain('two\\nlines');
    expect(framed.endsWith('\n\n')).toBe(true);
  });

  it('frames a comment as a line carrying nothing', () => {
    expect(formatComment('keep-alive')).toBe(': keep-alive\n\n');
  });

  it('frames the reconnect delay', () => {
    expect(formatRetry(RETRY_MS)).toBe(`retry: ${RETRY_MS}\n\n`);
  });

  it('tells nginx not to buffer', () => {
    // Without this Phase 8's reverse proxy holds every event until its buffer
    // fills, which looks exactly like a channel that does not work.
    expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
    expect(SSE_HEADERS['cache-control']).toContain('no-transform');
    expect(SSE_HEADERS['content-type']).toContain('text/event-stream');
  });
});
