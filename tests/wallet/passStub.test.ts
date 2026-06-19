import { describe, it, expect } from 'vitest';
import { addToWallet } from '../../src/wallet/passStub';

describe('addToWallet (prototype stub)', () => {
  it('simulates an Apple Wallet add and explains the backend is needed', async () => {
    const result = await addToWallet('apple', 'token-abc');
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('apple');
    expect(result.message).toContain('Apple Wallet');
    expect(result.message).toContain('backend');
  });

  it('simulates a Google Wallet add', async () => {
    const result = await addToWallet('google', 'token-abc');
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('google');
    expect(result.message).toContain('Google Wallet');
  });

  it('never leaks the token into the user-facing message', async () => {
    const result = await addToWallet('apple', 'super-secret-token');
    expect(result.message).not.toContain('super-secret-token');
  });
});
