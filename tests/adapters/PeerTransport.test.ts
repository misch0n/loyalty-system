/**
 * PeerTransport is the prototype's real cross-device transport; its
 * message-routing logic deserves regression cover. We mock `peerjs` with an
 * in-memory fake peer/connection so the routing, session payloads, broadcast and
 * teardown can be driven without any real WebRTC networking.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeConn {
    open = true;
    sent: unknown[] = [];
    private handlers: Record<string, Handler[]> = {};
    on(event: string, cb: Handler) {
      (this.handlers[event] ||= []).push(cb);
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
    static initialId: string | null = 'peer-self';
    static nextConn: FakeConn | null = null;

    id: string | null;
    connectedTo: string | null = null;
    private handlers: Record<string, Handler[]> = {};

    constructor() {
      this.id = FakePeer.initialId;
      FakePeer.instances.push(this);
    }
    on(event: string, cb: Handler) {
      (this.handlers[event] ||= []).push(cb);
      return this;
    }
    fire(event: string, ...args: unknown[]) {
      (this.handlers[event] || []).forEach((cb) => cb(...args));
    }
    connect(remoteId: string) {
      this.connectedTo = remoteId;
      return FakePeer.nextConn ?? new FakeConn();
    }
  }

  return { FakeConn, FakePeer };
});

vi.mock('peerjs', () => ({ default: fake.FakePeer }));

import { PeerTransport } from '../../src/adapters/transport/PeerTransport';

beforeEach(() => {
  fake.FakePeer.instances = [];
  fake.FakePeer.initialId = 'peer-self';
  fake.FakePeer.nextConn = null;
});

describe('createRegistrationSession', () => {
  it('resolves with the peer id once available', async () => {
    const transport = new PeerTransport();
    const session = await transport.createRegistrationSession();
    expect(session).toEqual({ sessionId: 'peer-self', joinPayload: 'peer:peer-self' });
  });

  it('waits for the peer "open" event when the id is not ready yet', async () => {
    fake.FakePeer.initialId = null;
    const transport = new PeerTransport();
    const pending = transport.createRegistrationSession();
    fake.FakePeer.instances[0].fire('open', 'peer-late');
    expect(await pending).toEqual({ sessionId: 'peer-late', joinPayload: 'peer:peer-late' });
  });
});

describe('incoming message routing', () => {
  it('routes joined / submitted / staffMessage data to the right handlers', async () => {
    const transport = new PeerTransport();
    await transport.createRegistrationSession();

    const joined: string[] = [];
    const submitted: Array<{ id: string; details: unknown }> = [];
    const staffMessages: unknown[] = [];
    transport.onCustomerJoined((id) => joined.push(id));
    transport.onCustomerSubmitted((id, details) => submitted.push({ id, details }));
    transport.onStaffMessage('s1', (data) => staffMessages.push(data));

    const conn = new fake.FakeConn();
    fake.FakePeer.instances[0].fire('connection', conn);
    conn.fire('data', { kind: 'joined', sessionId: 's1' });
    conn.fire('data', { kind: 'submitted', sessionId: 's1', details: { consent: true } });
    conn.fire('data', { kind: 'staffMessage', sessionId: 's1', data: { hi: 1 } });

    expect(joined).toEqual(['s1']);
    expect(submitted).toEqual([{ id: 's1', details: { consent: true } }]);
    expect(staffMessages).toEqual([{ hi: 1 }]);
  });
});

describe('outgoing broadcast', () => {
  it('sends staff messages and submissions over open connections', async () => {
    const transport = new PeerTransport();
    await transport.createRegistrationSession();
    const conn = new fake.FakeConn();
    fake.FakePeer.instances[0].fire('connection', conn);

    await transport.sendToCustomer('s1', { ping: true });
    await transport.submitRegistration('s1', { consent: true });

    expect(conn.sent).toContainEqual({ kind: 'staffMessage', sessionId: 's1', data: { ping: true } });
    expect(conn.sent).toContainEqual({ kind: 'submitted', sessionId: 's1', details: { consent: true } });
  });
});

describe('joinSession', () => {
  it('connects to the remote peer, sends a joined message and registers the connection', async () => {
    const conn = new fake.FakeConn();
    fake.FakePeer.nextConn = conn;
    const transport = new PeerTransport();

    const pending = transport.joinSession('peer:remote-1');
    conn.fire('open');
    await pending;

    expect(fake.FakePeer.instances[0].connectedTo).toBe('remote-1');
    expect(conn.sent).toContainEqual({ kind: 'joined', sessionId: 'peer:remote-1' });
  });
});

describe('close', () => {
  it('closes connections and stops broadcasting to them', async () => {
    const transport = new PeerTransport();
    await transport.createRegistrationSession();
    const conn = new fake.FakeConn();
    fake.FakePeer.instances[0].fire('connection', conn);

    transport.close('s1');
    expect(conn.open).toBe(false);

    await transport.sendToCustomer('s1', { late: true });
    expect(conn.sent).toEqual([]);
  });
});
