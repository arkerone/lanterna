/**
 * The three timeout policies Lanterna races a promise against. One module so a
 * caller picks a policy instead of re-implementing `Promise.race` + a cleared
 * timer each time:
 *
 * - {@link withTimeout} — resolve a `fallback` on timeout (and on rejection).
 * - {@link withTimeoutResult} — resolve a `{ ok }` discriminated result.
 * - {@link withTimeoutOrThrow} — reject with a timeout error, propagate the
 *   underlying rejection.
 */

/** Resolve `fallback` if `promise` rejects or does not settle within `timeoutMs`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Resolve `{ ok: true, value }` if `promise` settles first, else `{ ok: false }`. */
export async function withTimeoutResult<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false }>((resolve) => {
        timeout = setTimeout(() => resolve({ ok: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Reject with a timeout error if `promise` does not settle within `timeoutMs`;
 * otherwise pass its value or rejection straight through. The error defaults to a
 * generic message — pass `createTimeoutError` to describe the operation.
 */
export async function withTimeoutOrThrow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createTimeoutError: (timeoutMs: number) => Error = (ms) =>
    new Error(`operation timed out after ${ms}ms`),
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(createTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
