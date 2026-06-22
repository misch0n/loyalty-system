/**
 * ServerTransport — production seam placeholder.
 *
 * In production the cross-device registration handoff is server-mediated: the
 * customer's browser hits a real server URL rather than a P2P peer. That backend
 * is out of scope for the prototype, so every method throws — exactly like
 * ApiStore. This exists only so the composition root can name a production
 * transport without pulling PeerJS into the production bundle.
 */

import type {
  CustomerJoinedHandler,
  CustomerSubmittedHandler,
  RegistrationDetails,
  RegistrationSession,
  Transport,
} from '../../ports/Transport';

const NOT_IMPLEMENTED =
  'ServerTransport is a production placeholder — wire the server-mediated registration backend.';

export class ServerTransport implements Transport {
  createRegistrationSession(): Promise<RegistrationSession> {
    throw new Error(NOT_IMPLEMENTED);
  }
  onCustomerJoined(_cb: CustomerJoinedHandler): void {
    throw new Error(NOT_IMPLEMENTED);
  }
  sendToCustomer(_sessionId: string, _data: unknown): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
  onCustomerSubmitted(_cb: CustomerSubmittedHandler): void {
    throw new Error(NOT_IMPLEMENTED);
  }
  close(_sessionId: string): void {
    throw new Error(NOT_IMPLEMENTED);
  }
  joinSession(_sessionId: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
  submitRegistration(_sessionId: string, _details: RegistrationDetails): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
  onStaffMessage(_sessionId: string, _cb: (data: unknown) => void): void {
    throw new Error(NOT_IMPLEMENTED);
  }
}
