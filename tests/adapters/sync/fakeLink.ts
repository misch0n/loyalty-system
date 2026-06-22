/**
 * In-memory PeerLink pair for sync tests. A message sent on one end is delivered
 * asynchronously (microtask) to the other end's onMessage handlers. State is
 * permanently 'open' until close(). No networking, no PeerJS.
 */

import type { PeerLink, LinkState } from '../../../src/adapters/sync/PeerLink';

class FakeLink implements PeerLink {
  state: LinkState = 'open';
  peer!: FakeLink;
  private messageHandlers = new Set<(m: unknown) => void>();
  private stateHandlers = new Set<(s: LinkState) => void>();

  send(message: unknown): void {
    if (this.state !== 'open') return;
    // Deliver to the peer asynchronously, mirroring a real transport hop.
    queueMicrotask(() => {
      if (this.peer.state !== 'open') return;
      for (const h of [...this.peer.messageHandlers]) h(message);
    });
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
    this.state = 'closed';
    for (const h of [...this.stateHandlers]) h('closed');
  }
}

/** Returns two linked PeerLinks (host, client). */
export function makeLinkPair(): { host: PeerLink; client: PeerLink } {
  const a = new FakeLink();
  const b = new FakeLink();
  a.peer = b;
  b.peer = a;
  return { host: a, client: b };
}
