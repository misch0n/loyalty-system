/**
 * PeerJsLink — the real PeerJS/TURN implementation of PeerLink (prototype-only).
 *
 * One device hosts (shows a pairing QR carrying its peer id); customer devices
 * join by that id. The host accepts MANY clients: each accepted DataConnection
 * becomes its own `ConnLink`, so the StoreServer stack runs once per client and
 * change notifications fan out to every paired device. This is the channel the
 * prototype uses in place of a server to keep paired devices in sync.
 *
 * Three exports:
 *  - `ConnLink`   — a PeerLink over a single DataConnection.
 *  - `joinHost`   — client side: dial a host's peer id, resolve an open link.
 *  - `PeerJsHost` — host side: one peer, many accepted client links.
 */

import Peer, { type DataConnection } from 'peerjs';
import { iceServers } from '../../config/env';
import type { LinkState, PeerLink } from './PeerLink';

/** Give ICE/TURN negotiation time, but never hang "Connecting…" forever. */
const CONNECT_TIMEOUT_MS = 25_000;

/** A fresh, anonymous PeerJS peer wired with our ICE/TURN config. */
function newPeer(): Peer {
  return new Peer(undefined as unknown as string, { config: { iceServers } });
}

/**
 * A PeerLink over a SINGLE DataConnection. The conn may already be open or open
 * shortly. When the link reaches `'closed'`, `onClosed` (if given) fires once —
 * the host uses this to prune the connection from its active set.
 */
export class ConnLink implements PeerLink {
  private _state: LinkState;
  private onClosedFired = false;
  private readonly messageHandlers = new Set<(m: unknown) => void>();
  private readonly stateHandlers = new Set<(s: LinkState) => void>();

  constructor(
    private readonly conn: DataConnection,
    private readonly onClosed?: () => void,
  ) {
    this._state = conn.open ? 'open' : 'connecting';
    conn.on('open', () => this.setState('open'));
    conn.on('data', (data) => this.messageHandlers.forEach((h) => h(data)));
    conn.on('close', () => this.setState('closed'));
    conn.on('error', () => this.setState('closed'));
  }

  get state(): LinkState {
    return this._state;
  }

  private setState(state: LinkState): void {
    if (this._state === state) return;
    this._state = state;
    this.stateHandlers.forEach((h) => h(state));
    if (state === 'closed' && !this.onClosedFired) {
      this.onClosedFired = true;
      this.onClosed?.();
    }
  }

  send(message: unknown): void {
    if (this.conn.open) this.conn.send(message);
  }

  onMessage(handler: (message: unknown) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onState(handler: (state: LinkState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  close(): void {
    try {
      this.conn.close();
    } finally {
      this.setState('closed');
    }
  }
}

/**
 * Client side: connect to a host's peer id and resolve an open PeerLink.
 *
 * A missing/stale host id surfaces as a PEER error ('peer-unavailable'), NOT a
 * connection error — we reject on both (and a timeout) or the join hangs.
 * Closing the returned link also destroys this client's peer.
 */
export async function joinHost(remoteId: string): Promise<PeerLink> {
  const peer = newPeer();

  // The public PeerJS broker drops idle peers; reconnect to stay reachable.
  peer.on('disconnected', () => {
    try {
      peer.reconnect();
    } catch {
      /* already reconnecting or destroyed */
    }
  });

  await new Promise<void>((resolve, reject) => {
    peer.on('open', () => resolve());
    peer.on('error', (err) => reject(err));
  });

  const conn = peer.connect(remoteId, { reliable: true });

  await new Promise<void>((resolve, reject) => {
    if (conn.open) return resolve();
    const timer = setTimeout(
      () => reject(new Error('Timed out connecting to the till.')),
      CONNECT_TIMEOUT_MS,
    );
    const settle = (run: () => void) => {
      clearTimeout(timer);
      run();
    };
    conn.on('open', () => settle(resolve));
    conn.on('error', (err) => settle(() => reject(err)));
    peer.on('error', (err) => settle(() => reject(err)));
  });

  return new ConnLink(conn, () => peer.destroy());
}

/**
 * Host side: one PeerJS peer that accepts many client connections. Each opened
 * connection becomes a ConnLink handed to `onClient` subscribers; the active set
 * drives `count`/`onCountChange`. `unpairAll` signals + closes every client but
 * keeps the peer alive so it can accept again.
 */
export class PeerJsHost {
  private readonly links = new Set<PeerLink>();
  private readonly clientHandlers = new Set<(link: PeerLink) => void>();
  private readonly countHandlers = new Set<(count: number) => void>();

  private constructor(private readonly peer: Peer) {
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      try {
        peer.reconnect();
      } catch {
        /* already reconnecting or destroyed */
      }
    });
  }

  /** Create the host peer; resolves once our peer id is known (it goes in the QR). */
  static async create(): Promise<{ host: PeerJsHost; peerId: string }> {
    const peer = newPeer();
    const peerId = await new Promise<string>((resolve, reject) => {
      peer.on('open', (id) => resolve(id));
      peer.on('error', (err) => reject(err));
    });
    return { host: new PeerJsHost(peer), peerId };
  }

  private accept(conn: DataConnection): void {
    const link: PeerLink = new ConnLink(conn, () => {
      if (this.links.delete(link)) this.emitCount();
    });
    const register = () => {
      if (this.links.has(link)) return;
      this.links.add(link);
      this.emitCount();
      this.clientHandlers.forEach((cb) => cb(link));
    };
    if (conn.open) register();
    else conn.on('open', register);
  }

  private emitCount(): void {
    const count = this.links.size;
    this.countHandlers.forEach((cb) => cb(count));
  }

  /** Subscribe to newly connected+opened client links. Returns an unsubscribe fn. */
  onClient(cb: (link: PeerLink) => void): () => void {
    this.clientHandlers.add(cb);
    return () => this.clientHandlers.delete(cb);
  }

  /** Subscribe to active-client-count changes. Returns an unsubscribe fn. */
  onCountChange(cb: (count: number) => void): () => void {
    this.countHandlers.add(cb);
    return () => this.countHandlers.delete(cb);
  }

  get count(): number {
    return this.links.size;
  }

  /**
   * Tell every paired client to unpair and close its link, but keep the host
   * peer alive so it can accept fresh connections. Each ConnLink's onClosed
   * prunes the set and emits the count change.
   */
  unpairAll(): void {
    for (const link of [...this.links]) {
      link.send({ t: 'unpair' });
      link.close();
    }
  }

  /** Unpair all clients, then tear the host peer down for good. */
  close(): void {
    this.unpairAll();
    this.peer.destroy();
  }
}
