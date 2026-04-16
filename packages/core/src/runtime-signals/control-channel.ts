import { controlEventSchema, type ControlEvent } from './schemas.js';

export function attachControlChannel(
  stream: NodeJS.ReadableStream,
  handlers: { onEvent: (event: ControlEvent) => void },
): void {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) break;

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      try {
        const value = JSON.parse(line) as unknown;
        const parsed = controlEventSchema.safeParse(value);
        if (parsed.success) {
          handlers.onEvent(parsed.data);
        }
      } catch {
        // Control events are best-effort. Invalid lines are ignored.
      }
    }
  });
}
