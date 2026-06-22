/**
 * PeerJsLink is thin PeerJS event glue (the RPC/sync protocol is covered by the
 * FakeLink round-trip tests). Here we mock `peerjs` to confirm the wiring: host
 * resolves a peer id, join connects, messages relay, and state transitions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeConn {
    open = true;
    sent: unknown[] = [];
    handlers: Record<string, Handler[]> = {};
    on(event: string, cb: Handler) {
      (this.handlers[event] ||= []).push(cb);
      // Auto-fire 'open' so awaiters resolve immediately.
      if (event === 'open') cb();
      return this;
    }
    fire(event: string, ...args: unknown[]) {
      (this.handlers[event] || []).forEach((cb) => cb(...args));
    }
    send(message: unknown) {
      this.sent.push(message);
    }
    close() {
      this.open = false;
    }
  }

  class FakePeer {
    static instances: FakePeer[] = [];
    static nextConn: FakeConn | null = null;
    id = 'peer-self';
    handlers: Record<string, Handler[]> = {};
    constructor() {
      FakePeer.instances.push(this);
    }
    on(event: string, cb: Handler) {
      (this.handlers[event] ||= []).push(cb);
      if (event === 'open') cb(this.id); // peer comes online immediately
      return this;
    }
    fire(event: string, ...args: unknown[]) {
      (this.handlers[event] || []).forEach((cb) => cb(...args));
    }
    connect() {
      return (FakePeer.nextConn ??= new FakeConn());
    }
    destroy() {}
  }

  return { FakeConn, FakePeer };
});

vi.mock('peerjs', () => ({ default: fake.FakePeer }));

import { PeerJsLink } from '../../../src/adapters/sync/PeerJsLink';

beforeEach(() => {
  fake.FakePeer.instances = [];
  fake.FakePeer.nextConn = null;
});

describe('host', () => {
  it('resolves a peer id and goes open when a customer connects', async () => {
    const { link, peerId } = await PeerJsLink.host();
    expect(peerId).toBe('peer-self');
    expect(link.state).toBe('connecting');

    const states: string[] = [];
    link.onState((s) => states.push(s));
    const received: unknown[] = [];
    link.onMessage((m) => received.push(m));

    const conn = new fake.FakeConn();
    fake.FakePeer.instances[0].fire('connection', conn); // attach() sees conn.open → 'open'
    expect(link.state).toBe('open');
    expect(states).toContain('open');

    conn.fire('data', { hello: 1 });
    expect(received).toEqual([{ hello: 1 }]);
  });
});

describe('join', () => {
  it('connects, relays sends, and closes', async () => {
    const conn = new fake.FakeConn();
    fake.FakePeer.nextConn = conn;
    const link = await PeerJsLink.join('remote-1');
    expect(link.state).toBe('open');

    link.send({ ping: true });
    expect(conn.sent).toContainEqual({ ping: true });

    link.close();
    expect(link.state).toBe('closed');
  });
});
