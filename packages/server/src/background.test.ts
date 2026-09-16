import { describe, expect, it, vi } from 'vitest';
import { BackgroundWork } from './background.js';

/** A promise plus the handles to settle it from the test. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('BackgroundWork', () => {
  it('returns before the task has finished', async () => {
    // The point of the whole class: a recovery request must answer without
    // waiting on a mail server, or its response time says whether the address
    // exists.
    const gate = deferred();
    const work = new BackgroundWork();
    let finished = false;

    work.run(async () => {
      await gate.promise;
      finished = true;
    }, () => {});

    expect(finished).toBe(false);
    expect(work.size).toBe(1);

    gate.resolve();
    await work.drain();
    expect(finished).toBe(true);
    expect(work.size).toBe(0);
  });

  it('routes a failure to the handler instead of the process', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const seen: unknown[] = [];
    const work = new BackgroundWork();

    work.run(
      async () => {
        throw new Error('smtp is down');
      },
      (err) => seen.push(err),
    );
    await work.drain();
    // A macrotask turn, so an unhandled rejection would have surfaced by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);

    expect(seen).toHaveLength(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('drains work that a draining task started', async () => {
    // Otherwise `drain()` is a snapshot of one moment, and a shutdown could
    // still close the pool underneath a task that had just been queued.
    const work = new BackgroundWork();
    let inner = false;

    work.run(async () => {
      work.run(async () => {
        inner = true;
      }, () => {});
    }, () => {});

    await work.drain();
    expect(inner).toBe(true);
    expect(work.size).toBe(0);
  });

  it('drains immediately when nothing is in flight', async () => {
    await expect(new BackgroundWork().drain()).resolves.toBeUndefined();
  });
});
