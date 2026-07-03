import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { attachControlChannel } from '../src/runtime-signals/control-channel.js';
import type { ControlEvent } from '../src/runtime-signals/schemas.js';

function collectEvents(stream: PassThrough): ControlEvent[] {
  const events: ControlEvent[] = [];
  attachControlChannel(stream, { onEvent: (event) => events.push(event) });
  return events;
}

describe('attachControlChannel', () => {
  it('parses a heartbeat line', () => {
    const stream = new PassThrough();
    const events = collectEvents(stream);
    stream.write(`${JSON.stringify({ type: 'heartbeat', atMs: 1, lagMs: 2 })}\n`);
    expect(events).toEqual([{ type: 'heartbeat', atMs: 1, lagMs: 2 }]);
  });

  it('delivers crash events instead of dropping them', () => {
    // Regression test: `crash` events emitted by the hook (framework.ts,
    // uncaughtExceptionMonitor) used to be absent from controlEventSchema,
    // so safeParse silently rejected them and onEvent never fired.
    const stream = new PassThrough();
    const events = collectEvents(stream);
    stream.write(
      `${JSON.stringify({
        type: 'crash',
        atMs: 42,
        kind: 'uncaughtException',
        message: 'boom',
      })}\n`,
    );
    expect(events).toEqual([
      { type: 'crash', atMs: 42, kind: 'uncaughtException', message: 'boom' },
    ]);
  });

  it('ignores malformed lines without throwing', () => {
    const stream = new PassThrough();
    const events = collectEvents(stream);
    stream.write('not json\n');
    stream.write(`${JSON.stringify({ type: 'unknown-type' })}\n`);
    stream.write(`${JSON.stringify({ type: 'heartbeat', atMs: 1, lagMs: 0 })}\n`);
    expect(events).toEqual([{ type: 'heartbeat', atMs: 1, lagMs: 0 }]);
  });
});
