/**
 * PeerJsLink is thin PeerJS event glue (the RPC/sync protocol is covered by the
 * FakeLink round-trip tests). Here we mock `peerjs` to confirm the wiring:
 * joinHost dials a host and relays/closes; PeerJsHost accepts many clients,
 * tracks a count, fires onClient, and unpairs everyone.
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
      // Auto-fire 'open' so awaiters resolve immediately (conn starts open).
      if (event === 'open' && this.open) cb();
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
      this.fire('close');
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
    reconnect() {}
    destroy() {}
  }

  return { FakeConn, FakePeer };
});

vi.mock('peerjs', () => ({ default: fake.FakePeer }));

import { joinHost, PeerJsHost } from '../../../src/adapters/sync/PeerJsLink';

beforeEach(() => {
  fake.FakePeer.instances = [];
  fake.FakePeer.nextConn = null;
});

describe('joinHost', () => {
  it('connects, relays sends, and closes when the host closes', async () => {
    const conn = new fake.FakeConn();
    fake.FakePeer.nextConn = conn;
    const link = await joinHost('remote-1');
    expect(link.state).toBe('open');

    link.send({ ping: true });
    expect(conn.sent).toContainEqual({ ping: true });

    // Remote close drives the link to 'closed'.
    const states: string[] = [];
    link.onState((s) => states.push(s));
    conn.fire('close');
    expect(link.state).toBe('closed');
    expect(states).toContain('closed');
  });
});

describe('PeerJsHost', () => {
  it('returns a peer id and accepts many clients', async () => {
    const { host, peerId } = await PeerJsHost.create();
    expect(peerId).toBe('peer-self');
    expect(host.count).toBe(0);

    const peer = fake.FakePeer.instances[0];
    const clients: unknown[] = [];
    host.onClient((link) => clients.push(link));
    const counts: number[] = [];
    host.onCountChange((c) => counts.push(c));

    const connA = new fake.FakeConn();
    const connB = new fake.FakeConn();
    peer.fire('connection', connA); // opens immediately → registered
    peer.fire('connection', connB);

    expect(host.count).toBe(2);
    expect(clients).toHaveLength(2);
    expect(counts).toEqual([1, 2]);

    // Closing one client prunes the set and emits the new count.
    connA.fire('close');
    expect(host.count).toBe(1);
    expect(counts).toEqual([1, 2, 1]);
  });

  it('unpairAll signals and closes every client but keeps the peer alive', async () => {
    const destroy = vi.fn();
    const { host } = await PeerJsHost.create();
    const peer = fake.FakePeer.instances[0];
    peer.destroy = destroy;

    const connA = new fake.FakeConn();
    const connB = new fake.FakeConn();
    peer.fire('connection', connA);
    peer.fire('connection', connB);
    expect(host.count).toBe(2);

    host.unpairAll();

    expect(connA.sent).toContainEqual({ t: 'unpair' });
    expect(connB.sent).toContainEqual({ t: 'unpair' });
    expect(connA.open).toBe(false);
    expect(connB.open).toBe(false);
    expect(host.count).toBe(0); // onClosed pruned both
    expect(destroy).not.toHaveBeenCalled(); // peer stays alive

    host.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
