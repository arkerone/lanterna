import { Session } from 'node:inspector';
import { logger } from '../shared/logger.js';
import {
  type CdpClient,
  extractEvaluateValue,
  type RuntimeEvaluateResult,
  trackDebuggerDomain,
} from './client.js';

type EventHandler = (params: unknown) => void;
type CloseHandler = () => void;

/**
 * A {@link CdpClient} backed by an in-process `node:inspector` `Session` instead
 * of a remote WebSocket. The Session speaks the same Chrome DevTools Protocol
 * (Runtime / Profiler / HeapProfiler) against the *current* V8 isolate, so the
 * entire capture pipeline works unchanged — only the transport differs.
 *
 * Differences from the remote client: the inspector back-end delivers protocol
 * events as `{ method, params }` messages (we unwrap `params` to match the remote
 * client's contract), and the session has no "disconnect" notification — close
 * handlers fire when {@link close} is called.
 */
export async function connectInProcessCdp(): Promise<CdpClient> {
  const session = new Session();
  session.connect();
  const closeHandlers = new Set<CloseHandler>();
  const debuggerDomain = { enabled: false };
  let closed = false;

  const post = <TResponse = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TResponse> => {
    if (closed) {
      return Promise.reject(new Error('CDP connection closed'));
    }
    return new Promise<TResponse>((resolve, reject) => {
      const callback = (err: Error | null, result?: unknown) => {
        if (err) reject(err);
        else resolve(result as TResponse);
      };
      if (params === undefined) {
        session.post(method, callback);
      } else {
        session.post(method, params, callback);
      }
    });
  };

  return {
    get closed() {
      return closed;
    },
    get debuggerDomainEnabled() {
      return debuggerDomain.enabled;
    },
    async send<TResponse = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<TResponse> {
      const response = await post<TResponse>(method, params);
      trackDebuggerDomain(method, debuggerDomain);
      return response;
    },
    async evaluate(expression: string, opts: { awaitPromise?: boolean } = {}): Promise<unknown> {
      const result = await post<RuntimeEvaluateResult>('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: opts.awaitPromise,
      });
      return extractEvaluateValue(result);
    },
    on(event: string, handler: EventHandler): () => void {
      // node:inspector emits protocol notifications as `{ method, params }`.
      const wrapped = (message: unknown) => {
        try {
          handler((message as { params?: unknown })?.params);
        } catch (err) {
          // Event handlers must not tear down the session.
          logger.debug({ event, err }, 'in-process CDP event handler threw');
        }
      };
      session.on(event, wrapped as (...args: unknown[]) => void);
      return () => {
        session.removeListener(event, wrapped as (...args: unknown[]) => void);
      };
    },
    onClose(handler: CloseHandler): () => void {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const handler of closeHandlers) {
        try {
          handler();
        } catch {
          // Close handlers are best-effort.
        }
      }
      try {
        session.disconnect();
      } catch {
        // Disconnecting an already-torn-down session is harmless.
      }
    },
  };
}
