/**
 * The change hub — who is listening, and what just changed.
 *
 * BACKEND-PLAN §3-C-15: the prototype's PeerJS pairing layer gave a customer's
 * phone a live view of a till's writes, and Phase 6 deleted it. This is the
 * replacement's routing half: route handlers {@link EventHub.publish} what they
 * changed, and whatever streams are listening to that subject hear about it.
 * `routes/events.ts` is the wire half.
 *
 * Three rules shape it, and each one is a decision rather than an
 * implementation detail:
 *
 *   • **A subject is a topic, and a subscriber never names its own.** The
 *     `/events` handler derives the topics from the session, exactly as
 *     `GET /audit` derives its actor filter — a client that could ask to listen
 *     to `customer:<someone else>` would be a cross-account read with a
 *     different verb.
 *   • **The payload is a signal, not data.** A `changed` event says *what*
 *     changed and why; the screen then re-reads through the routes it is already
 *     entitled to. So a stream can never carry a row the subscriber could not
 *     have fetched, which keeps the authorization boundary in one place.
 *   • **In-process, single-instance**, like `AttemptLimiter` and for the same
 *     reason: the Compose bundle runs one `api` container, and a second instance
 *     would need this in Postgres (`LISTEN`/`NOTIFY`) rather than in a `Map`.
 *     Stated here so the constraint is inherited rather than rediscovered.
 *
 * Losing an event is survivable and losing the ledger is not, which is why
 * publishing is fire-and-forget and never inside a transaction: a dropped signal
 * costs a customer a stale screen until their next read, and a commit that
 * failed because nobody was listening would be indefensible.
 */

/** What kind of subject changed. The two the screens follow. */
export type ChangeScope = 'customer' | 'staff';

/**
 * Why it changed — enough for a screen to decide what to do, never enough to be
 * data in its own right.
 *
 *   • `commit`   — a counter commit moved points, minted or spent rewards.
 *   • `ledger`   — a single entry was appended (an accrual, or a reversal).
 *   • `card`     — the card's details or its token changed; a shown QR may be stale.
 *   • `deleted`  — the card is gone (SCOPE-DECISIONS §3.3). Terminal.
 *   • `activity` — this actor's own audit trail gained rows.
 */
export type ChangeReason = 'commit' | 'ledger' | 'card' | 'deleted' | 'activity';

export interface ChangeEvent {
  scope: ChangeScope;
  /** The customer id, or the staff account id. Never a token or a short code. */
  id: string;
  reason: ChangeReason;
}

/** `scope:id` — the routing key. */
export type Topic = string;

export function topicOf(scope: ChangeScope, id: string): Topic {
  return `${scope}:${id}`;
}

export interface Subscriber {
  /** The session behind the stream, so a sign-out can end it. */
  sessionId: string;
  /** Derived from that session by the route — never supplied by the client. */
  topics: readonly Topic[];
  /** Write one event out. Throwing removes the subscriber. */
  deliver(event: ChangeEvent): void;
  /** End the stream. Called by the hub; must be safe to call twice. */
  close(): void;
}

/**
 * Concurrent streams one session may hold.
 *
 * A device needs one. Three is room for a customer with the card open in two
 * tabs and a stale connection the browser has not collected yet — and a ceiling,
 * because an SSE request holds a socket for as long as the client wants it and
 * an authenticated caller opening them in a loop would otherwise pin the process
 * a file descriptor at a time.
 */
export const MAX_STREAMS_PER_SESSION = 3;

export class EventHub {
  private readonly byTopic = new Map<Topic, Set<Subscriber>>();
  private readonly bySession = new Map<string, Set<Subscriber>>();

  /**
   * Registers a subscriber and returns the function that removes it, or `null`
   * when this session already holds {@link MAX_STREAMS_PER_SESSION}. The caller
   * answers 429; nothing has been written to the socket at that point.
   *
   * The returned function is idempotent — the stream's own cleanup and a
   * hub-driven close both call it.
   */
  subscribe(subscriber: Subscriber): (() => void) | null {
    const forSession = this.bySession.get(subscriber.sessionId) ?? new Set<Subscriber>();
    if (forSession.size >= MAX_STREAMS_PER_SESSION) return null;

    forSession.add(subscriber);
    this.bySession.set(subscriber.sessionId, forSession);
    for (const topic of subscriber.topics) {
      const listeners = this.byTopic.get(topic) ?? new Set<Subscriber>();
      listeners.add(subscriber);
      this.byTopic.set(topic, listeners);
    }

    return () => this.remove(subscriber);
  }

  private remove(subscriber: Subscriber): void {
    for (const topic of subscriber.topics) {
      const listeners = this.byTopic.get(topic);
      if (!listeners) continue;
      listeners.delete(subscriber);
      if (listeners.size === 0) this.byTopic.delete(topic);
    }
    const forSession = this.bySession.get(subscriber.sessionId);
    if (!forSession) return;
    forSession.delete(subscriber);
    if (forSession.size === 0) this.bySession.delete(subscriber.sessionId);
  }

  /**
   * Delivers to everyone listening to the event's subject. Returns how many
   * streams took it, which is what the tests assert on and what a route logs
   * nothing about — a publish with no listeners is the ordinary case, not a
   * problem.
   *
   * A `deliver` that throws has a dead socket behind it; the subscriber is
   * dropped rather than allowed to fail the request that published.
   */
  publish(event: ChangeEvent): number {
    const listeners = this.byTopic.get(topicOf(event.scope, event.id));
    if (!listeners) return 0;

    let delivered = 0;
    for (const subscriber of [...listeners]) {
      try {
        subscriber.deliver(event);
        delivered += 1;
      } catch {
        this.remove(subscriber);
      }
    }
    return delivered;
  }

  private closeEach(subscribers: Iterable<Subscriber>): number {
    let closed = 0;
    for (const subscriber of [...subscribers]) {
      this.remove(subscriber);
      subscriber.close();
      closed += 1;
    }
    return closed;
  }

  /** Ends the streams behind one session — `POST /auth/logout`. */
  closeSession(sessionId: string): number {
    return this.closeEach(this.bySession.get(sessionId) ?? []);
  }

  /**
   * Ends every stream listening to one subject. Used when the subject stops
   * existing: a deleted card's device has nothing left to hear about.
   */
  closeTopic(scope: ChangeScope, id: string): number {
    return this.closeEach(this.byTopic.get(topicOf(scope, id)) ?? []);
  }

  /**
   * Ends every stream of one scope — `POST /auth/logout-all`.
   *
   * "Sign out all devices" deletes the session rows, and a stream whose session
   * no longer exists must not outlive it. It is scoped rather than total because
   * revocation is about staff terminals; a customer's card recognition is
   * deliberately untouched by it (`SessionStore.resolve`).
   */
  closeScope(scope: ChangeScope): number {
    const prefix = `${scope}:`;
    let closed = 0;
    for (const [topic, listeners] of [...this.byTopic]) {
      if (topic.startsWith(prefix)) closed += this.closeEach(listeners);
    }
    return closed;
  }

  /** Ends everything — the `preClose` hook, so `app.close()` is not held open. */
  closeAll(): number {
    let closed = 0;
    for (const listeners of [...this.byTopic.values()]) {
      closed += this.closeEach(listeners);
    }
    return closed;
  }

  /** Open streams. */
  get size(): number {
    let total = 0;
    for (const forSession of this.bySession.values()) total += forSession.size;
    return total;
  }
}
