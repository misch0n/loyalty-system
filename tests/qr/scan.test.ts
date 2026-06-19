/**
 * The scanner is a thin wrapper over html5-qrcode. We mock the library so we can
 * assert the wrapper wires the camera config and callbacks correctly and that
 * the returned handle stops + clears the camera (swallowing teardown errors).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  ctor: vi.fn(),
}));

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor(elementId: string) {
      mocks.ctor(elementId);
    }
    start = mocks.start;
    stop = mocks.stop;
    clear = mocks.clear;
  },
}));

import { startScanner } from '../../src/qr/scan';

type SuccessCb = (text: string) => void;
type ErrorCb = (message: string) => void;
let capturedSuccess: SuccessCb;
let capturedError: ErrorCb;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.mockImplementation(
    (_camera: unknown, _config: unknown, onSuccess: SuccessCb, onError: ErrorCb) => {
      capturedSuccess = onSuccess;
      capturedError = onError;
      return Promise.resolve();
    },
  );
  mocks.stop.mockResolvedValue(undefined);
});

describe('startScanner', () => {
  it('starts the rear camera with the expected scan box and target element', async () => {
    await startScanner('reader', () => {});
    expect(mocks.ctor).toHaveBeenCalledWith('reader');
    expect(mocks.start).toHaveBeenCalledWith(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('forwards decoded results and errors to the supplied callbacks', async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    await startScanner('reader', onResult, onError);
    capturedSuccess('TOKEN-123');
    capturedError('not found');
    expect(onResult).toHaveBeenCalledWith('TOKEN-123');
    expect(onError).toHaveBeenCalledWith('not found');
  });

  it('stop() stops and clears the camera', async () => {
    const handle = await startScanner('reader', () => {});
    await handle.stop();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it('stop() swallows teardown errors (camera already stopped)', async () => {
    mocks.stop.mockRejectedValueOnce(new Error('already stopped'));
    const handle = await startScanner('reader', () => {});
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
