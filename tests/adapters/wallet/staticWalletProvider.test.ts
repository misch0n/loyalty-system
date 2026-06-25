import { describe, it, expect, beforeEach } from 'vitest';
import { freshServices } from '../../helpers/freshStore';
import { StaticWalletProvider } from '../../../src/adapters/wallet/StaticWalletProvider';
import { ServerWalletProvider } from '../../../src/adapters/wallet/ServerWalletProvider';
import {
  PRESET_CARD_TOKENS,
  PASS_SERIALS,
  walletPassUrl,
} from '../../../src/wallet/passes';
import type { DataStore } from '../../../src/ports/DataStore';

let store: DataStore;
let wallet: StaticWalletProvider;

beforeEach(() => {
  store = freshServices().store;
  wallet = new StaticWalletProvider(store);
});

describe('StaticWalletProvider.ensurePass', () => {
  it('maps a preset-token card to its aligned pass serial + URLs', async () => {
    const customer = await store.createCustomer({ token: PRESET_CARD_TOKENS[0] });
    const pass = await wallet.ensurePass(customer.id);
    expect(pass.serial).toBe(PASS_SERIALS[0]);
    expect(pass.appleUrl).toBe(walletPassUrl('apple', PRESET_CARD_TOKENS[0]));
    expect(pass.googleUrl).toBe(walletPassUrl('google', PRESET_CARD_TOKENS[0]));
  });

  it('resolves a non-preset card to a stable rotated serial', async () => {
    const customer = await store.createCustomer({ token: 'some-other-token-1234' });
    const pass = await wallet.ensurePass(customer.id);
    expect(PASS_SERIALS).toContain(pass.serial);
    // Stable across calls (no minting / mutation).
    const again = await wallet.ensurePass(customer.id);
    expect(again.serial).toBe(pass.serial);
  });

  it('rejects an unknown customer id', async () => {
    await expect(wallet.ensurePass('does-not-exist')).rejects.toThrow();
  });
});

describe('StaticWalletProvider.pushUpdate', () => {
  it('is a no-op that never throws (Free tier = static snapshot)', async () => {
    const customer = await store.createCustomer({ token: PRESET_CARD_TOKENS[1] });
    await expect(
      wallet.pushUpdate(customer.id, { balance: 5, rewardCount: 0 }),
    ).resolves.toBeUndefined();
    // Even an unknown id is tolerated — the web card is the source of truth.
    await expect(
      wallet.pushUpdate('nope', { balance: 0, rewardCount: 0 }),
    ).resolves.toBeUndefined();
  });
});

describe('ServerWalletProvider (production stub)', () => {
  it('throws on every method', async () => {
    const prod = new ServerWalletProvider();
    await expect(prod.ensurePass('x')).rejects.toThrow();
    await expect(
      prod.pushUpdate('x', { balance: 0, rewardCount: 0 }),
    ).rejects.toThrow();
  });
});
