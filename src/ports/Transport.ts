/**
 * `Transport` — the cross-device registration seam.
 *
 * Models the handoff between the customer's device and the staff device during
 * card creation. The prototype implements it for real over PeerJS + TURN (two
 * separate devices); production replaces this seam entirely with the
 * server-mediated flow. Same interface either way.
 */

/** Optional details the customer fills in on their device, sent back to staff. */
export interface RegistrationDetails {
  displayName?: string;
  email?: string;
  phone?: string;
  consent: boolean;
}

export interface RegistrationSession {
  sessionId: string;
  /**
   * What the staff device renders as a QR for the customer to scan/open. With
   * PeerJS it carries the peer id (`peer:<id>`); `registrationPayload` wraps it
   * into the full page URL the customer's phone opens.
   */
  joinPayload: string;
}

export type CustomerJoinedHandler = (sessionId: string) => void;
export type CustomerSubmittedHandler = (
  sessionId: string,
  details: RegistrationDetails,
) => void;

export interface Transport {
  /** Staff side opens a session; returns the payload the customer joins with. */
  createRegistrationSession(): Promise<RegistrationSession>;
  /** Notified when the customer device joins the session. */
  onCustomerJoined(cb: CustomerJoinedHandler): void;
  /** Push data (e.g. live status) to the customer device. */
  sendToCustomer(sessionId: string, data: unknown): Promise<void>;
  /** Notified when the customer submits their completed registration details. */
  onCustomerSubmitted(cb: CustomerSubmittedHandler): void;
  /** Tear down a session. */
  close(sessionId: string): void;

  // ── customer-device side ────────────────────────────────────────────────────
  // One Transport interface exposes both sides; each physical device uses the
  // half it needs (staff device the staff calls, customer phone the customer
  // calls). Production splits these across two real clients over the server.

  /** Customer device announces it has joined the session. */
  joinSession(sessionId: string): Promise<void>;
  /** Customer device submits completed registration details back to staff. */
  submitRegistration(sessionId: string, details: RegistrationDetails): Promise<void>;
  /** Customer device listens for pushes from staff. */
  onStaffMessage(sessionId: string, cb: (data: unknown) => void): void;
}
