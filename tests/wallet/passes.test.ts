import { describe, it, expect } from 'vitest';
import {
  PRESET_CARD_TOKENS,
  PASS_SERIALS,
  passSerialForToken,
  walletPassUrl,
} from '../../src/wallet/passes';

describe('passSerialForToken', () => {
  it('maps each preset token to its aligned pass serial', () => {
    PRESET_CARD_TOKENS.forEach((token, i) => {
      expect(passSerialForToken(token)).toBe(PASS_SERIALS[i]);
    });
  });

  it('rotates non-preset tokens to one of the three serials, stably', () => {
    const serial = passSerialForToken('some-random-token-xyz');
    expect(PASS_SERIALS).toContain(serial);
    // Same token → same serial (stable for display).
    expect(passSerialForToken('some-random-token-xyz')).toBe(serial);
  });
});

describe('walletPassUrl', () => {
  it('builds the Apple .pkpass URL with the mapped serial', () => {
    expect(walletPassUrl('apple', PRESET_CARD_TOKENS[0])).toBe(
      `https://api.walletwallet.dev/p/${PASS_SERIALS[0]}/apple.pkpass`,
    );
  });

  it('builds the Google pass URL with the mapped serial', () => {
    expect(walletPassUrl('google', PRESET_CARD_TOKENS[1])).toBe(
      `https://api.walletwallet.dev/api/passes/${PASS_SERIALS[1]}/google`,
    );
  });
});
