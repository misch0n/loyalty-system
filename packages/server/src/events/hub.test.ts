import { describe, expect, it } from 'vitest';
import { EventHub, MAX_STREAMS_PER_SESSION, topicOf, type ChangeEvent, type Subscriber } from './hub.js';

interface Recorder extends Subscriber {
  received: ChangeEvent[];
  closed: number;
}

function recorder(sessionId: string, topics: string[]): Recorder {
  const self: Recorder = {
    sessionId,
    topics,
    received: [],
    closed: 0,
    deliver: (event) => {
      self.received.push(event);
    },
    close: () => {
      self.closed += 1;
    },
  };
  return self;
}

const CARD_A: ChangeEvent = { scope: 'customer', id: 'cus-a', reason: 'commit' };
const CARD_B: ChangeEvent = { scope: 'customer', id: 'cus-b', reason: 'commit' };

describe('EventHub routing', () => {
  it('delivers to the subscribers of the event’s subject', () => {
    const hub = new EventHub();
    const listener = recorder('s1', [topicOf('customer', 'cus-a')]);
    hub.subscribe(listener);

    expect(hub.publish(CARD_A)).toBe(1);
    expect(listener.received).toEqual([CARD_A]);
  });

  it('delivers nothing to a subscriber of another subject', () => {
    // The whole authorization argument in one assertion: a stream's topics come
    // from its session, so "only your own subject" is the same statement as
    // "only your own rows" on `GET /audit`.
    const hub = new EventHub();
    const mine = recorder('s1', [topicOf('customer', 'cus-a')]);
    const theirs = recorder('s2', [topicOf('customer', 'cus-b')]);
    hub.subscribe(mine);
    hub.subscribe(theirs);

    hub.publish(CARD_A);
    expect(mine.received).toEqual([CARD_A]);
    expect(theirs.received).toEqual([]);
  });

  it('is a no-op when nobody is listening', () => {
    // The ordinary case — a commit for a customer whose phone is in a pocket.
    expect(new EventHub().publish(CARD_B)).toBe(0);
  });

  it('delivers to every stream on the same subject', () => {
    const hub = new EventHub();
    const phone = recorder('s1', [topicOf('customer', 'cus-a')]);
    const tab = recorder('s2', [topicOf('customer', 'cus-a')]);
    hub.subscribe(phone);
    hub.subscribe(tab);

    expect(hub.publish(CARD_A)).toBe(2);
  });

  it('stops delivering once unsubscribed', () => {
    const hub = new EventHub();
    const listener = recorder('s1', [topicOf('customer', 'cus-a')]);
    const unsubscribe = hub.subscribe(listener);
    unsubscribe?.();

    expect(hub.publish(CARD_A)).toBe(0);
    expect(hub.size).toBe(0);
  });

  it('survives unsubscribing twice', () => {
    // The stream's own cleanup and a hub-driven close both call it.
    const hub = new EventHub();
    const unsubscribe = hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]));
    unsubscribe?.();
    expect(() => unsubscribe?.()).not.toThrow();
    expect(hub.size).toBe(0);
  });

  it('drops a subscriber whose delivery throws', () => {
    // A dead socket must not fail the request that published.
    const hub = new EventHub();
    const broken = recorder('s1', [topicOf('customer', 'cus-a')]);
    broken.deliver = () => {
      throw new Error('socket gone');
    };
    hub.subscribe(broken);

    expect(hub.publish(CARD_A)).toBe(0);
    expect(hub.size).toBe(0);
  });
});

describe('EventHub limits', () => {
  it(`refuses a session's ${MAX_STREAMS_PER_SESSION + 1}th stream`, () => {
    const hub = new EventHub();
    for (let i = 0; i < MAX_STREAMS_PER_SESSION; i += 1) {
      expect(hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]))).not.toBeNull();
    }
    expect(hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]))).toBeNull();
    expect(hub.size).toBe(MAX_STREAMS_PER_SESSION);
  });

  it('counts the cap per session, not globally', () => {
    const hub = new EventHub();
    for (let i = 0; i < MAX_STREAMS_PER_SESSION; i += 1) {
      hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]));
    }
    expect(hub.subscribe(recorder('s2', [topicOf('customer', 'cus-a')]))).not.toBeNull();
  });

  it('frees a slot when a stream ends', () => {
    const hub = new EventHub();
    const first = hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]));
    for (let i = 1; i < MAX_STREAMS_PER_SESSION; i += 1) {
      hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]));
    }
    first?.();
    expect(hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]))).not.toBeNull();
  });
});

describe('EventHub closing', () => {
  it('closes only the named session’s streams', () => {
    const hub = new EventHub();
    const mine = recorder('s1', [topicOf('staff', 'st-1')]);
    const theirs = recorder('s2', [topicOf('staff', 'st-1')]);
    hub.subscribe(mine);
    hub.subscribe(theirs);

    expect(hub.closeSession('s1')).toBe(1);
    expect(mine.closed).toBe(1);
    expect(theirs.closed).toBe(0);
    expect(hub.size).toBe(1);
  });

  it('closes every stream on one subject', () => {
    const hub = new EventHub();
    const phone = recorder('s1', [topicOf('customer', 'cus-a')]);
    const other = recorder('s2', [topicOf('customer', 'cus-b')]);
    hub.subscribe(phone);
    hub.subscribe(other);

    expect(hub.closeTopic('customer', 'cus-a')).toBe(1);
    expect(phone.closed).toBe(1);
    expect(other.closed).toBe(0);
  });

  it('closes a whole scope and leaves the other alone', () => {
    // "Sign out all devices" is about terminals. A customer's card recognition
    // is deliberately outside it, in `SessionStore.resolve` and here.
    const hub = new EventHub();
    const till = recorder('s1', [topicOf('staff', 'st-1')]);
    const otherTill = recorder('s2', [topicOf('staff', 'st-2')]);
    const phone = recorder('s3', [topicOf('customer', 'cus-a')]);
    hub.subscribe(till);
    hub.subscribe(otherTill);
    hub.subscribe(phone);

    expect(hub.closeScope('staff')).toBe(2);
    expect(phone.closed).toBe(0);
    expect(hub.size).toBe(1);
  });

  it('closes everything for shutdown', () => {
    const hub = new EventHub();
    hub.subscribe(recorder('s1', [topicOf('staff', 'st-1')]));
    hub.subscribe(recorder('s2', [topicOf('customer', 'cus-a')]));

    expect(hub.closeAll()).toBe(2);
    expect(hub.size).toBe(0);
  });

  it('leaves nothing behind after a close, so the cap is not leaked', () => {
    const hub = new EventHub();
    hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]));
    hub.closeAll();
    expect(hub.publish(CARD_A)).toBe(0);
    for (let i = 0; i < MAX_STREAMS_PER_SESSION; i += 1) {
      expect(hub.subscribe(recorder('s1', [topicOf('customer', 'cus-a')]))).not.toBeNull();
    }
  });
});
