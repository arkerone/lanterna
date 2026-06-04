import { describe, expect, it } from 'vitest';
import { withTimeout, withTimeoutOrThrow, withTimeoutResult } from '../src/shared/timeout.js';

const never = () => new Promise<number>(() => {});
const rejecting = () => Promise.reject(new Error('boom'));

describe('withTimeout (fallback policy)', () => {
  it('resolves the value when the promise settles first', async () => {
    expect(await withTimeout(Promise.resolve(7), 1000, -1)).toBe(7);
  });

  it('resolves the fallback on timeout', async () => {
    expect(await withTimeout(never(), 5, -1)).toBe(-1);
  });

  it('resolves the fallback when the promise rejects', async () => {
    expect(await withTimeout(rejecting(), 1000, -1)).toBe(-1);
  });
});

describe('withTimeoutResult (result policy)', () => {
  it('returns ok with the value when it settles first', async () => {
    expect(await withTimeoutResult(Promise.resolve(7), 1000)).toEqual({ ok: true, value: 7 });
  });

  it('returns not-ok on timeout', async () => {
    expect(await withTimeoutResult(never(), 5)).toEqual({ ok: false });
  });
});

describe('withTimeoutOrThrow (throw policy)', () => {
  it('passes the value through when it settles first', async () => {
    expect(await withTimeoutOrThrow(Promise.resolve(7), 1000)).toBe(7);
  });

  it('rejects with the default error on timeout', async () => {
    await expect(withTimeoutOrThrow(never(), 5)).rejects.toThrow('operation timed out after 5ms');
  });

  it('rejects with a caller-supplied error on timeout', async () => {
    await expect(withTimeoutOrThrow(never(), 5, () => new Error('custom'))).rejects.toThrow(
      'custom',
    );
  });

  it('propagates the underlying rejection unchanged', async () => {
    await expect(withTimeoutOrThrow(rejecting(), 1000)).rejects.toThrow('boom');
  });
});
