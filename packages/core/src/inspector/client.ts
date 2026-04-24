import CDP from 'chrome-remote-interface';
import { logger } from '../shared/logger.js';

type EventHandler = (params: unknown) => void;
type CloseHandler = () => void;
type ChromeRemoteInterfaceClient = CDP.Client & {
  _ws?: {
    readyState: number;
    terminate?: () => void;
  };
  removeListener(
    event: string,
    listener: (params: unknown, sessionId?: string) => void,
  ): CDP.Client;
  send(command: string, parameters?: Record<string, unknown>): Promise<unknown>;
};

const CDP_GRACEFUL_CLOSE_TIMEOUT_MS = 1000;

export interface CdpClient {
  send<TResponse = unknown>(method: string, params?: Record<string, unknown>): Promise<TResponse>;
  evaluate(expression: string, opts?: { awaitPromise?: boolean }): Promise<unknown>;
  on(event: string, handler: EventHandler): () => void;
  onClose(handler: CloseHandler): () => void;
  close(): Promise<void>;
  readonly closed: boolean;
}

interface RuntimeEvaluateResult {
  result?: {
    value?: unknown;
  };
}

export async function connectCdp(webSocketDebuggerUrl: string): Promise<CdpClient> {
  const client = (await CDP({ target: webSocketDebuggerUrl })) as ChromeRemoteInterfaceClient;
  const closeHandlers = new Set<CloseHandler>();
  let closed = false;

  const handleDisconnect = () => {
    if (closed) return;
    closed = true;
    for (const handler of closeHandlers) {
      try {
        handler();
      } catch {
        // Disconnect handlers are best-effort.
      }
    }
  };

  client.on('disconnect', handleDisconnect);

  return {
    get closed() {
      return closed;
    },
    async send<TResponse = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<TResponse> {
      if (closed) {
        throw new Error('CDP connection closed');
      }
      return (await client.send(method, params)) as TResponse;
    },
    async evaluate(expression: string, opts: { awaitPromise?: boolean } = {}): Promise<unknown> {
      const result = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: opts.awaitPromise,
      });
      return (result as RuntimeEvaluateResult).result?.value;
    },
    on(event: string, handler: EventHandler): () => void {
      const wrapped = (params: unknown) => {
        try {
          handler(params);
        } catch (err) {
          // Event handlers must not tear down the socket.
          logger.debug({ event, err }, 'CDP event handler threw');
        }
      };
      client.on(event, wrapped);
      return () => {
        client.removeListener(event, wrapped);
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
      const result = await closeChromeClient(client, CDP_GRACEFUL_CLOSE_TIMEOUT_MS);
      if (!result.closedGracefully) {
        logger.debug('force-terminated CDP websocket after graceful close timeout');
      }
    },
  };
}

async function closeChromeClient(
  client: ChromeRemoteInterfaceClient,
  timeoutMs: number,
): Promise<{ closedGracefully: boolean }> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      client.close().then(() => ({ closedGracefully: true })),
      new Promise<{ closedGracefully: boolean }>((resolve) => {
        timeout = setTimeout(() => {
          client._ws?.terminate?.();
          resolve({ closedGracefully: false });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
