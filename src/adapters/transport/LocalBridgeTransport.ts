/**
 * LocalBridgeTransport — the DEFAULT registration transport.
 *
 * Runs both the staff panel and the customer view inside one browser (role
 * switcher or a second tab), bridging them with an in-memory bus plus a
 * BroadcastChannel for cross-tab delivery. Zero networking — best for UI/UX
 * testing and most demos.
 */

import type {
  CustomerJoinedHandler,
  CustomerSubmittedHandler,
  RegistrationDetails,
  RegistrationSession,
  Transport,
} from '../../ports/Transport';
import { generateId } from '../../domain/tokens';

type BridgeMessage =
  | { kind: 'joined'; sessionId: string }
  | { kind: 'submitted'; sessionId: string; details: RegistrationDetails }
  | { kind: 'staffMessage'; sessionId: string; data: unknown };

const CHANNEL_NAME = 'cafe-loyalty-transport';

export class LocalBridgeTransport implements Transport {
  private channel: BroadcastChannel | null = null;
  private readonly local = new EventTarget();

  private joinedHandlers: CustomerJoinedHandler[] = [];
  private submittedHandlers: CustomerSubmittedHandler[] = [];
  private staffMessageHandlers = new Map<string, ((data: unknown) => void)[]>();

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (ev: MessageEvent<BridgeMessage>) => this.dispatch(ev.data);
    }
  }

  private emit(message: BridgeMessage): void {
    // Deliver to handlers in THIS context (same-tab role switcher)…
    this.dispatch(message);
    // …and to other tabs. BroadcastChannel does not echo to the sender, so no
    // double delivery.
    this.channel?.postMessage(message);
  }

  private dispatch(message: BridgeMessage): void {
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
    void this.local; // reserved for future same-context fan-out needs
  }

  // ── staff side ──────────────────────────────────────────────────────────────

  async createRegistrationSession(): Promise<RegistrationSession> {
    const sessionId = generateId();
    // joinPayload is the in-app customer route; the staff QR encodes it.
    return { sessionId, joinPayload: `register/${sessionId}` };
  }

  onCustomerJoined(cb: CustomerJoinedHandler): void {
    this.joinedHandlers.push(cb);
  }

  async sendToCustomer(sessionId: string, data: unknown): Promise<void> {
    this.emit({ kind: 'staffMessage', sessionId, data });
  }

  onCustomerSubmitted(cb: CustomerSubmittedHandler): void {
    this.submittedHandlers.push(cb);
  }

  close(sessionId: string): void {
    this.staffMessageHandlers.delete(sessionId);
  }

  // ── customer side ─────────────────────────────────────────────────────────────

  async joinSession(sessionId: string): Promise<void> {
    this.emit({ kind: 'joined', sessionId });
  }

  async submitRegistration(sessionId: string, details: RegistrationDetails): Promise<void> {
    this.emit({ kind: 'submitted', sessionId, details });
  }

  onStaffMessage(sessionId: string, cb: (data: unknown) => void): void {
    const list = this.staffMessageHandlers.get(sessionId) ?? [];
    list.push(cb);
    this.staffMessageHandlers.set(sessionId, list);
  }
}
