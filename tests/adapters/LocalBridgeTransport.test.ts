/**
 * Tests the default in-browser registration transport. Both the staff and
 * customer sides live on one instance here (the same-context role-switcher path),
 * so we drive the handoff end to end without any networking.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalBridgeTransport } from '../../src/adapters/transport/LocalBridgeTransport';
import type { RegistrationDetails } from '../../src/ports/Transport';

let transport: LocalBridgeTransport;

beforeEach(() => {
  transport = new LocalBridgeTransport();
});

describe('createRegistrationSession', () => {
  it('returns a session id and an in-app join route', async () => {
    const session = await transport.createRegistrationSession();
    expect(session.sessionId).toBeTruthy();
    expect(session.joinPayload).toBe(`register/${session.sessionId}`);
  });
});

describe('handoff', () => {
  it('notifies the staff side when the customer joins', async () => {
    const joined: string[] = [];
    transport.onCustomerJoined((id) => joined.push(id));
    const { sessionId } = await transport.createRegistrationSession();
    await transport.joinSession(sessionId);
    expect(joined).toEqual([sessionId]);
  });

  it('delivers submitted registration details to the staff side', async () => {
    const received: Array<{ id: string; details: RegistrationDetails }> = [];
    transport.onCustomerSubmitted((id, details) => received.push({ id, details }));
    const { sessionId } = await transport.createRegistrationSession();

    const details: RegistrationDetails = { displayName: 'Maria', consent: true };
    await transport.submitRegistration(sessionId, details);
    expect(received).toEqual([{ id: sessionId, details }]);
  });

  it('pushes staff messages to a customer listening on that session', async () => {
    const { sessionId } = await transport.createRegistrationSession();
    const seen: unknown[] = [];
    transport.onStaffMessage(sessionId, (data) => seen.push(data));
    await transport.sendToCustomer(sessionId, { step: 'ready' });
    expect(seen).toEqual([{ step: 'ready' }]);
  });

  it('scopes staff messages to their session id', async () => {
    const seen: unknown[] = [];
    transport.onStaffMessage('session-A', (data) => seen.push(data));
    await transport.sendToCustomer('session-B', { nope: true });
    expect(seen).toEqual([]);
  });

  it('stops delivering staff messages after close', async () => {
    const seen: unknown[] = [];
    transport.onStaffMessage('s1', (data) => seen.push(data));
    transport.close('s1');
    await transport.sendToCustomer('s1', { late: true });
    expect(seen).toEqual([]);
  });
});
