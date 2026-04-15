type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type EventHandler = (params: unknown) => void;
type CloseHandler = () => void;

export interface CdpClient {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: EventHandler): () => void;
  onClose(handler: CloseHandler): () => void;
  close(): Promise<void>;
  readonly closed: boolean;
}

export async function connectCdp(url: string): Promise<CdpClient> {
  const ws = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      resolve();
    };
    const onError = (ev: Event) => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      reject(new Error(`CDP connection failed: ${(ev as ErrorEvent).message || 'unknown'}`));
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });

  let nextId = 1;
  const pending = new Map<number, Pending>();
  const handlers = new Map<string, Set<EventHandler>>();
  const closeHandlers = new Set<CloseHandler>();
  let closed = false;

  ws.addEventListener('message', (ev: MessageEvent) => {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP error on ${p.method}: ${msg.error.message ?? 'unknown'}`));
      else p.resolve(msg.result);
    } else if (typeof msg.method === 'string') {
      const set = handlers.get(msg.method);
      if (!set) return;
      for (const h of set) {
        try {
          h(msg.params);
        } catch {
          // swallow handler errors to avoid breaking the socket
        }
      }
    }
  });

  ws.addEventListener('close', () => {
    closed = true;
    for (const p of pending.values()) p.reject(new Error('CDP connection closed'));
    pending.clear();
    for (const handler of closeHandlers) {
      try {
        handler();
      } catch {
        // Ignore close handler failures.
      }
    }
  });

  ws.addEventListener('error', () => {
    // Avoid uncaught; actual failures surface via close or per-call rejection.
  });

  return {
    get closed() {
      return closed;
    },
    send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (closed) return Promise.reject(new Error('CDP connection closed'));
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(event: string, handler: EventHandler): () => void {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    onClose(handler: CloseHandler): () => void {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      ws.close();
    },
  };
}
