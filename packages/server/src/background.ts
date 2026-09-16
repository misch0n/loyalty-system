/**
 * Work a request starts but does not wait for.
 *
 * Exactly one thing uses this, and it needs to: **sending a recovery mail**
 * (SCOPE-DECISIONS §2.3). The route must answer identically whether or not the
 * address belongs to a card, and "identically" includes *how long it takes* — a
 * known address that waits on an SMTP round-trip while an unknown one returns
 * immediately is an enumeration oracle readable with a stopwatch, the same one
 * `routes/auth.ts` spends an argon2 verify to close on sign-in. Answering before
 * the work starts removes the difference instead of paying to hide it. It is
 * also simply better behaviour: a slow mail server should not hold up the page
 * telling the customer to go and check their inbox.
 *
 * What it must not become is a job queue. Tasks are in-process and are lost if
 * the process dies — acceptable for a mail the customer can ask for again, and
 * not acceptable for anything that writes the ledger.
 *
 * Tracking the promises buys two things a bare `void promise` does not: a
 * shutdown that lets in-flight sends finish before the pool closes, and tests
 * that can await the work instead of sleeping and hoping.
 */

export type BackgroundErrorHandler = (err: unknown) => void;

export class BackgroundWork {
  private readonly inFlight = new Set<Promise<void>>();

  /**
   * Starts `task` and returns immediately. A rejection reaches `onError` and
   * never becomes an unhandled rejection — a failed mail must not take the
   * process down.
   */
  run(task: () => Promise<void>, onError: BackgroundErrorHandler): void {
    const promise = (async () => {
      try {
        await task();
      } catch (err) {
        onError(err);
      }
    })();
    this.inFlight.add(promise);
    void promise.finally(() => this.inFlight.delete(promise));
  }

  /** Tasks still running. */
  get size(): number {
    return this.inFlight.size;
  }

  /**
   * Waits for everything in flight, including work a draining task itself
   * started — so a caller that drains gets a genuinely quiet system rather than
   * a snapshot of one moment.
   */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }
}
