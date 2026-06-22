/**
 * PeerLink — a persistent 1:1 message channel between two paired devices.
 *
 * PROTOTYPE-ONLY. This is the prototype's stand-in for the production server: in
 * production both devices talk to a server, so state changes propagate centrally.
 * With no server, two devices PAIR over PeerJS and this link carries the same
 * traffic — remote DataStore calls (RPC) and change notifications — so a workflow
 * on one device reflects on the other.
 *
 * The link is transport-agnostic on purpose: `PeerJsLink` implements it over
 * PeerJS/TURN; tests drive a pair of in-memory fake links with no networking.
 */

export type LinkState = 'connecting' | 'open' | 'closed';

export interface PeerLink {
  /** Send a structured-cloneable message to the peer. No-op if not open. */
  send(message: unknown): void;
  /** Subscribe to inbound messages. Returns an unsubscribe fn. */
  onMessage(handler: (message: unknown) => void): () => void;
  /** Subscribe to connection-state changes. Returns an unsubscribe fn. */
  onState(handler: (state: LinkState) => void): () => void;
  /** Current connection state. */
  readonly state: LinkState;
  /** Tear down the channel. */
  close(): void;
}

/**
 * Envelopes carried over a PeerLink between the store host (staff device) and
 * the store client (paired customer device).
 *  - `rpc-req` / `rpc-res`: the client proxies DataStore method calls to the host.
 *  - `changed`: the host tells the client its data mutated, so the client refetches.
 */
export type SyncMessage =
  | { t: 'rpc-req'; id: string; method: string; args: unknown[] }
  | { t: 'rpc-res'; id: string; ok: true; result: unknown }
  | { t: 'rpc-res'; id: string; ok: false; error: string }
  | { t: 'changed' }
  | { t: 'unpair' };
