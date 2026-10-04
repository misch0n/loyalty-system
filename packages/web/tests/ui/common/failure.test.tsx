import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from '../../../src/services/errors';
import {
  DEFAULT_WAIT_SEC,
  failureMessage,
  isConnectivityFailure,
  isSessionFailure,
  retryAfterOf,
} from '../../../src/ui/common/failure';
import { formatWait, useRetryCountdown, type RetryCountdown } from '../../../src/ui/common/useRetryCountdown';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FALLBACK = 'Couldn’t save that.';

describe('failureMessage', () => {
  it('tells an unreachable server apart from a failing one', () => {
    const offline = failureMessage(new ApiError({ kind: 'offline' }), FALLBACK);
    const server = failureMessage(new ApiError({ kind: 'server', status: 502 }), FALLBACK);
    expect(offline).toMatch(/internet connection/);
    expect(server).toMatch(/server had a problem/);
    expect(server).not.toMatch(/connection/);
  });

  it('names the remedy for the 403s that have one, and falls back for the rest', () => {
    expect(failureMessage(new ApiError({ kind: 'forbidden', code: 'csrf_failed' }), FALLBACK)).toMatch(/Reload/);
    expect(failureMessage(new ApiError({ kind: 'forbidden', code: 'staff_device' }), FALLBACK)).toMatch(/till/);
    expect(failureMessage(new ApiError({ kind: 'forbidden', code: 'forbidden' }), FALLBACK)).toBe(FALLBACK);
  });

  it('never freezes a figure into rate-limit copy', () => {
    const text = failureMessage(new ApiError({ kind: 'rate_limited', retryAfterSec: 42 }), FALLBACK);
    expect(text).not.toMatch(/42/);
  });

  it('lets a screen override a kind', () => {
    const err = new ApiError({ kind: 'offline' });
    expect(failureMessage(err, FALLBACK, { offline: 'Mine.' })).toBe('Mine.');
  });

  it('gives the fallback for refusals and for anything that is not an ApiError', () => {
    expect(failureMessage(new ApiError({ kind: 'rejected', code: 'x' }), FALLBACK)).toBe(FALLBACK);
    expect(failureMessage(new TypeError('cannot read x of undefined'), FALLBACK)).toBe(FALLBACK);
  });
});

describe('retryAfterOf / isConnectivityFailure / isSessionFailure', () => {
  it('reads the wait from a rate limit only', () => {
    expect(retryAfterOf(new ApiError({ kind: 'rate_limited', retryAfterSec: 9 }))).toBe(9);
    expect(retryAfterOf(new ApiError({ kind: 'rate_limited', retryAfterSec: null }))).toBe(DEFAULT_WAIT_SEC);
    expect(retryAfterOf(new ApiError({ kind: 'offline' }))).toBeNull();
    expect(retryAfterOf(new Error('x'))).toBeNull();
  });

  it('counts offline and server as connectivity, nothing else', () => {
    expect(isConnectivityFailure(new ApiError({ kind: 'offline' }))).toBe(true);
    expect(isConnectivityFailure(new ApiError({ kind: 'server', status: 500 }))).toBe(true);
    expect(isConnectivityFailure(new ApiError({ kind: 'conflict', code: 'x' }))).toBe(false);
    expect(isConnectivityFailure(new Error('x'))).toBe(false);
  });

  it('counts only signed_out as a session failure', () => {
    expect(isSessionFailure(new ApiError({ kind: 'signed_out' }))).toBe(true);
    expect(isSessionFailure(new ApiError({ kind: 'offline' }))).toBe(false);
    expect(isSessionFailure(new Error('x'))).toBe(false);
  });
});

describe('useRetryCountdown', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down to zero and stops waiting', () => {
    vi.useFakeTimers();
    let latest: RetryCountdown | null = null;
    function Probe() {
      latest = useRetryCountdown();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
    expect(latest!.waiting).toBe(false);

    act(() => latest!.start(3));
    expect(latest!.secondsLeft).toBe(3);
    expect(latest!.waiting).toBe(true);

    act(() => vi.advanceTimersByTime(1000));
    expect(latest!.secondsLeft).toBe(2);

    act(() => vi.advanceTimersByTime(2000));
    expect(latest!.secondsLeft).toBe(0);
    expect(latest!.waiting).toBe(false);
    act(() => root.unmount());
  });

  it('formats short and long waits for a button', () => {
    expect(formatWait(45)).toBe('45 s');
    expect(formatWait(125)).toBe('2:05');
  });
});
