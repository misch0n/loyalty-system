/**
 * PeerJsLink — the real PeerJS/TURN implementation of PeerLink (prototype-only).
 *
 * One device hosts (shows a pairing QR carrying its peer id) and the other joins
 * by that id. Once the underlying DataConnection opens, the link relays messages
 * both ways for the session. This is the channel the prototype uses in place of a
 * server to keep two paired devices in sync.
 */

import Peer, { type DataConnection } from 'peerjs';
import { iceServers } from '../../config/env';
import type { LinkState, PeerLink } from './PeerLink';

export class PeerJsLink implements PeerLink {
  private conn: DataConnection | null = null;
  private _state: LinkState = 'connecting';
  private readonly messageHandlers = new Set<(m: unknown) => void>();
  private readonly stateHandlers = new Set<(s: LinkState) => void>();

  private constructor(private readonly peer: Peer) {}

  get state(): LinkState {
    return this._state;
  }

  private static newPeer(): Peer {
    return new Peer(undefined as unknown as string, { config: { iceServers } });
  }

  /** Host side: resolves once our peer id is known (it goes in the pairing QR). */
  static async host(): Promise<{ link: PeerJsLink; peerId: string }> {
    const peer = PeerJsLink.newPeer();
    const link = new PeerJsLink(peer);
    const peerId = await new Promise<string>((resolve, reject) => {
      peer.on('open', (id) => resolve(id));
      peer.on('error', (err) => reject(err));
    });
    // The joiner dials us; attach the first incoming connection.
    peer.on('connection', (conn) => link.attach(conn));
    return { link, peerId };
  }

  /** Joiner side: connects to the host's peer id; resolves when the link is open. */
  static async join(remoteId: string): Promise<PeerJsLink> {
    const peer = PeerJsLink.newPeer();
    const link = new PeerJsLink(peer);
    await new Promise<void>((resolve, reject) => {
      peer.on('open', () => resolve());
      peer.on('error', (err) => reject(err));
    });
    const conn = peer.connect(remoteId, { reliable: true });
    link.attach(conn);
    await new Promise<void>((resolve, reject) => {
      if (conn.open) return resolve();
      conn.on('open', () => resolve());
      conn.on('error', (err) => reject(err));
    });
    return link;
  }

  private attach(conn: DataConnection): void {
    this.conn = conn;
    if (conn.open) this.setState('open');
    conn.on('open', () => this.setState('open'));
    conn.on('data', (data) => this.messageHandlers.forEach((h) => h(data)));
    conn.on('close', () => this.setState('closed'));
    conn.on('error', () => this.setState('closed'));
  }

  private setState(state: LinkState): void {
    if (this._state === state) return;
    this._state = state;
    this.stateHandlers.forEach((h) => h(state));
  }

  send(message: unknown): void {
    if (this.conn && this.conn.open) this.conn.send(message);
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
      this.conn?.close();
      this.peer.destroy();
    } finally {
      this.setState('closed');
    }
  }
}
