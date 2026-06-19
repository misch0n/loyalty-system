/**
 * DEVELOPMENT-ONLY transport stub — not for production.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This adapter exists ONLY for live two-device demos: a real customer phone and
 * a real staff device talking over PeerJS / WebRTC. It is:
 *   • selected ONLY when `import.meta.env.VITE_DEV_TRANSPORT === 'peer'`
 *     (and never in a production build — see config/env.ts + the composition root),
 *   • lazy-imported so it tree-shakes out of the default bundle,
 *   • a demo scaffold, NOT a shipping transport.
 *
 * Production replaces this seam entirely with the real server-mediated
 * registration flow. Do not build production features on top of it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Peer, { type DataConnection } from 'peerjs';
import type {
  CustomerJoinedHandler,
  CustomerSubmittedHandler,
  RegistrationDetails,
  RegistrationSession,
  Transport,
} from '../../../ports/Transport';

type PeerMessage =
  | { kind: 'joined'; sessionId: string }
  | { kind: 'submitted'; sessionId: string; details: RegistrationDetails }
  | { kind: 'staffMessage'; sessionId: string; data: unknown };

export class PeerTransport implements Transport {
  private peer: Peer | null = null;
  private connections: DataConnection[] = [];

  private joinedHandlers: CustomerJoinedHandler[] = [];
  private submittedHandlers: CustomerSubmittedHandler[] = [];
  private staffMessageHandlers = new Map<string, ((data: unknown) => void)[]>();

  private ensurePeer(): Peer {
    if (!this.peer) {
      // Public PeerJS broker; a TURN server would be configured here for relay
      // in a real two-device demo behind NAT.
      this.peer = new Peer();
      this.peer.on('connection', (conn) => this.registerConnection(conn));
    }
    return this.peer;
  }

  private registerConnection(conn: DataConnection): void {
    this.connections.push(conn);
    conn.on('data', (raw) => this.handleMessage(raw as PeerMessage));
  }

  private handleMessage(message: PeerMessage): void {
    switch (message.kind) {
      case 'joined':
        this.joinedHandlers.forEach((cb) => cb(message.sessionId));
        break;
      case 'submitted':
        this.submittedHandlers.forEach((cb) => cb(message.sessionId, message.details));
        break;
      case 'staffMessage':
        this.staffMessageHandlers.get(message.sessionId)?.forEach((cb) => cb(message.data));
        break;
    }
  }

  private broadcast(message: PeerMessage): void {
    this.connections.forEach((conn) => conn.open && conn.send(message));
  }

  // ── staff side ──────────────────────────────────────────────────────────────

  createRegistrationSession(): Promise<RegistrationSession> {
    const peer = this.ensurePeer();
    return new Promise((resolve) => {
      const finish = (id: string) =>
        // The customer device dials this peer id; sessionId scopes the exchange.
        resolve({ sessionId: id, joinPayload: `peer:${id}` });
      if (peer.id) finish(peer.id);
      else peer.on('open', finish);
    });
  }

  onCustomerJoined(cb: CustomerJoinedHandler): void {
    this.joinedHandlers.push(cb);
  }

  async sendToCustomer(sessionId: string, data: unknown): Promise<void> {
    this.broadcast({ kind: 'staffMessage', sessionId, data });
  }

  onCustomerSubmitted(cb: CustomerSubmittedHandler): void {
    this.submittedHandlers.push(cb);
  }

  close(_sessionId: string): void {
    this.connections.forEach((conn) => conn.close());
    this.connections = [];
  }

  // ── customer side ─────────────────────────────────────────────────────────────

  async joinSession(sessionId: string): Promise<void> {
    const peer = this.ensurePeer();
    const remoteId = sessionId.replace(/^peer:/, '');
    await new Promise<void>((resolve, reject) => {
      const conn = peer.connect(remoteId);
      conn.on('open', () => {
        this.registerConnection(conn);
        conn.send({ kind: 'joined', sessionId });
        resolve();
      });
      conn.on('error', reject);
    });
  }

  async submitRegistration(sessionId: string, details: RegistrationDetails): Promise<void> {
    this.broadcast({ kind: 'submitted', sessionId, details });
  }

  onStaffMessage(sessionId: string, cb: (data: unknown) => void): void {
    const list = this.staffMessageHandlers.get(sessionId) ?? [];
    list.push(cb);
    this.staffMessageHandlers.set(sessionId, list);
  }
}
