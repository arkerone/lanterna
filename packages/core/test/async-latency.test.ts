import { describe, expect, it } from 'vitest';
import { buildEventLoopStallWindows } from '../src/analysis/model/event-loop-report.js';
import {
  buildByKindLatency,
  buildWaitWindows,
  classifyLatencyCause,
  collectDescendantRunWindows,
  deriveLatency,
  isUserEditableFile,
  resolveAttributedFrame,
} from '../src/kinds/async/latency.js';
import type {
  AsyncChainNode,
  AsyncOperationRecord,
  AsyncStackFrame,
} from '../src/kinds/async/types.js';

function rec(p: Partial<AsyncOperationRecord> & { asyncId: number }): AsyncOperationRecord {
  return {
    triggerAsyncId: 0,
    kind: 'promise',
    rawType: 'PROMISE',
    initAtMs: 0,
    runMs: 0,
    runCount: 0,
    orphan: false,
    initStack: [],
    runWindows: [],
    ...p,
  };
}

function frame(file: string, fn = 'fn', line = 1): AsyncStackFrame {
  return { function: fn, file, line, column: 1 };
}

const userFile = '/app/src/handler.js';
const depFile = '/app/node_modules/pg/lib/client.js';

describe('buildWaitWindows', () => {
  it('returns the whole lifetime when the resource never ran', () => {
    expect(buildWaitWindows(rec({ asyncId: 1, initAtMs: 0 }), 100)).toEqual([
      { startMs: 0, endMs: 100 },
    ]);
  });

  it('emits the gaps around run windows', () => {
    const r = rec({ asyncId: 1, initAtMs: 0, runWindows: [{ startMs: 20, endMs: 30 }] });
    expect(buildWaitWindows(r, 100)).toEqual([
      { startMs: 0, endMs: 20 },
      { startMs: 30, endMs: 100 },
    ]);
  });

  it('returns nothing when run windows cover the whole lifetime', () => {
    const r = rec({ asyncId: 1, initAtMs: 0, runWindows: [{ startMs: 0, endMs: 100 }] });
    expect(buildWaitWindows(r, 100)).toEqual([]);
  });

  it('clamps run windows that exceed the lifetime', () => {
    const r = rec({ asyncId: 1, initAtMs: 10, runWindows: [{ startMs: 5, endMs: 200 }] });
    expect(buildWaitWindows(r, 100)).toEqual([]);
  });
});

describe('deriveLatency', () => {
  it('computes waitMs as duration minus runMs', () => {
    expect(deriveLatency(rec({ asyncId: 1, initAtMs: 0, runMs: 30 }), 100)).toEqual({ waitMs: 70 });
  });

  it('derives scheduleDelayMs from firstRunAtMs', () => {
    const r = rec({ asyncId: 1, initAtMs: 10, firstRunAtMs: 35, runMs: 5 });
    expect(deriveLatency(r, 100)).toEqual({ waitMs: 85, scheduleDelayMs: 25 });
  });

  it('clamps waitMs at zero', () => {
    expect(deriveLatency(rec({ asyncId: 1, initAtMs: 0, runMs: 200 }), 100).waitMs).toBe(0);
  });
});

describe('classifyLatencyCause', () => {
  const base = {
    waitWindows: [{ startMs: 0, endMs: 100 }],
    stallWindows: [],
    gcWindows: [],
    descendantWindows: [],
    kind: 'promise' as const,
    runMs: 0,
    durationMs: 100,
    captureDurationMs: 100_000,
    signals: { eventLoop: true, gc: true },
  };

  it('classifies a long-lived idle resource as background', () => {
    const r = classifyLatencyCause({
      ...base,
      durationMs: 95_000,
      captureDurationMs: 100_000,
      waitWindows: [{ startMs: 0, endMs: 95_000 }],
    });
    expect(r.cause).toBe('background');
  });

  it('records no-eventloop-signal when the loop could not be observed', () => {
    const blind = classifyLatencyCause({ ...base, signals: { eventLoop: false, gc: true } });
    expect(blind.cause).toBe('unknown');
    expect(blind.evidence.basis).toBe('no-eventloop-signal');
    const seen = classifyLatencyCause({ ...base, signals: { eventLoop: true, gc: true } });
    expect(seen.evidence.basis).toBe('none');
  });

  it('classifies cpu-bound when runMs dominates the duration', () => {
    const r = classifyLatencyCause({ ...base, runMs: 80 });
    expect(r.cause).toBe('cpu-bound');
  });

  it('classifies a long-lived multiplexed handle as background', () => {
    // A keep-alive connection / interval: activated many times, alive ~the whole
    // capture, low CPU. Its aggregate wait is idle gaps between activations, not a
    // blocked callback — so even a full stall overlap must not make it event-loop-blocked.
    const r = classifyLatencyCause({
      ...base,
      durationMs: 9000,
      captureDurationMs: 10_000,
      runMs: 200,
      runCount: 50,
      waitWindows: [{ startMs: 0, endMs: 9000 }],
      stallWindows: [{ startMs: 0, endMs: 9000 }],
    });
    expect(r.cause).toBe('background');
    expect(r.evidence.basis).toBe('long-lived-multiplexed');
  });

  it('does not treat a single-run long I/O as a multiplexed handle (preserves io-wait)', () => {
    // One slow I/O that spans most of the capture but ran once stays io-wait; the
    // runCount>1 discriminator protects genuine single slow operations.
    const r = classifyLatencyCause({
      ...base,
      kind: 'fs',
      durationMs: 8500,
      captureDurationMs: 10_000,
      runMs: 0,
      runCount: 1,
      waitWindows: [{ startMs: 0, endMs: 8500 }],
    });
    expect(r.cause).toBe('io-wait');
  });

  it('classifies event-loop-blocked when the wait overlaps a stall', () => {
    const r = classifyLatencyCause({ ...base, stallWindows: [{ startMs: 0, endMs: 70 }] });
    expect(r.cause).toBe('event-loop-blocked');
    expect(r.evidence.basis).toBe('event-loop-stall');
  });

  it('classifies gc-pause when the wait overlaps GC windows', () => {
    const r = classifyLatencyCause({ ...base, gcWindows: [{ startMs: 10, endMs: 80 }] });
    expect(r.cause).toBe('gc-pause');
  });

  it('classifies downstream-async when descendants ran during the wait', () => {
    const r = classifyLatencyCause({ ...base, descendantWindows: [{ startMs: 0, endMs: 90 }] });
    expect(r.cause).toBe('downstream-async');
  });

  it('prefers event-loop-blocked over a competing GC overlap', () => {
    const r = classifyLatencyCause({
      ...base,
      stallWindows: [{ startMs: 0, endMs: 80 }],
      gcWindows: [{ startMs: 0, endMs: 60 }],
    });
    expect(r.cause).toBe('event-loop-blocked');
  });

  it('classifies io-wait for I/O kinds with no signal overlap', () => {
    expect(classifyLatencyCause({ ...base, kind: 'fs' }).cause).toBe('io-wait');
  });

  it('falls back to unknown for a promise with no signal overlap', () => {
    expect(classifyLatencyCause(base).cause).toBe('unknown');
  });

  it('rejects event-loop-blocked when the stall ended well before the callback ran', () => {
    // A genuinely slow 500ms wait whose window happens to span a 260ms stall
    // (52% overlap) that finished at 310ms — long before the op ran at 500ms.
    // The block did not cause the latency, so this must not be event-loop-blocked.
    const r = classifyLatencyCause({
      ...base,
      durationMs: 500,
      waitWindows: [{ startMs: 0, endMs: 500 }],
      stallWindows: [{ startMs: 50, endMs: 310 }],
      firstRunAtMs: 500,
    });
    expect(r.cause).not.toBe('event-loop-blocked');
  });

  it('keeps event-loop-blocked when the loop was still stalled as the callback ran', () => {
    const r = classifyLatencyCause({
      ...base,
      durationMs: 360,
      waitWindows: [{ startMs: 0, endMs: 360 }],
      stallWindows: [{ startMs: 0, endMs: 350 }],
      firstRunAtMs: 360,
    });
    expect(r.cause).toBe('event-loop-blocked');
  });

  it('prefers event-loop-blocked over a larger GC overlap when the loop was blocked at run time', () => {
    const r = classifyLatencyCause({
      ...base,
      stallWindows: [{ startMs: 40, endMs: 100 }], // 60%
      gcWindows: [{ startMs: 0, endMs: 100 }], // 100% — must not win
      firstRunAtMs: 100,
    });
    expect(r.cause).toBe('event-loop-blocked');
    expect(r.evidence.basis).toBe('event-loop-stall');
  });
});

describe('buildByKindLatency', () => {
  it('buckets duration percentiles and mean wait per kind', () => {
    const records = [
      rec({ asyncId: 1, kind: 'fs', initAtMs: 0, durationMs: 100, runMs: 10 }),
      rec({ asyncId: 2, kind: 'fs', initAtMs: 0, durationMs: 300, runMs: 10 }),
      rec({ asyncId: 3, kind: 'http', initAtMs: 0, durationMs: 50, runMs: 0 }),
    ];
    const out = buildByKindLatency(records, 1000);
    expect(out.fs?.count).toBe(2);
    expect(out.fs?.maxMs).toBe(300);
    expect(out.fs?.meanWaitMs).toBe(190); // ((100-10) + (300-10)) / 2
    expect(out.http?.count).toBe(1);
  });
});

describe('resolveAttributedFrame', () => {
  it('uses the op own stack when it has a user frame', () => {
    const r = rec({ asyncId: 1, initStack: [frame(userFile)] });
    const map = new Map([[1, r]]);
    expect(resolveAttributedFrame(r, map)).toMatchObject({ origin: 'self' });
  });

  it('inherits the nearest user frame from the trigger ancestry', () => {
    const parent = rec({ asyncId: 1, initStack: [frame(userFile, 'parent')] });
    const child = rec({ asyncId: 2, triggerAsyncId: 1, initStack: [frame(depFile)] });
    const map = new Map([
      [1, parent],
      [2, child],
    ]);
    const out = resolveAttributedFrame(child, map);
    expect(out.origin).toBe('inherited-trigger');
    expect(out.frame?.function).toBe('parent');
  });

  it('falls back to the CPU execution frame', () => {
    const r = rec({
      asyncId: 1,
      initStack: [frame(depFile)],
      executionStack: [frame(userFile, 'hot')],
    });
    expect(resolveAttributedFrame(r, new Map([[1, r]]))).toMatchObject({ origin: 'cpu-window' });
  });

  it('returns no origin when nothing user-editable exists', () => {
    const r = rec({ asyncId: 1, initStack: [frame(depFile)] });
    expect(resolveAttributedFrame(r, new Map([[1, r]])).origin).toBeUndefined();
  });

  it('does not loop on a cyclic trigger chain', () => {
    const a = rec({ asyncId: 1, triggerAsyncId: 2, initStack: [frame(depFile)] });
    const b = rec({ asyncId: 2, triggerAsyncId: 1, initStack: [frame(depFile)] });
    const map = new Map([
      [1, a],
      [2, b],
    ]);
    expect(resolveAttributedFrame(a, map).origin).toBeUndefined();
  });
});

describe('collectDescendantRunWindows', () => {
  it('gathers run windows across the trigger subtree, guarding cycles', () => {
    const nodes = new Map<number, AsyncChainNode>([
      [1, node(1, [2])],
      [2, node(2, [3])],
      [3, node(3, [1])], // cycle back to root
    ]);
    const records = new Map<number, AsyncOperationRecord>([
      [1, rec({ asyncId: 1 })],
      [2, rec({ asyncId: 2, runWindows: [{ startMs: 10, endMs: 20 }] })],
      [3, rec({ asyncId: 3, runWindows: [{ startMs: 30, endMs: 40 }] })],
    ]);
    const windows = collectDescendantRunWindows(1, nodes, records);
    expect(windows).toEqual([
      { startMs: 10, endMs: 20 },
      { startMs: 30, endMs: 40 },
    ]);
  });
});

describe('isUserEditableFile', () => {
  it('accepts user paths and rejects deps/builtins', () => {
    expect(isUserEditableFile(userFile)).toBe(true);
    expect(isUserEditableFile(depFile)).toBe(false);
    expect(isUserEditableFile('node:internal/timers')).toBe(false);
    expect(isUserEditableFile('')).toBe(false);
  });
});

describe('buildEventLoopStallWindows', () => {
  it('emits [atMs - lagMs, atMs] for samples crossing the threshold', () => {
    // durationMs == last sample atMs so no trailing-lag window is added.
    const windows = buildEventLoopStallWindows([{ atMs: 500, lagMs: 400 }], 500, 20);
    expect(windows).toEqual([{ startMs: 100, endMs: 500, maxLagMs: 400 }]);
  });

  it('ignores samples below the stall threshold', () => {
    expect(buildEventLoopStallWindows([{ atMs: 500, lagMs: 50 }], 510, 20)).toEqual([]);
  });

  it('adds a trailing stall window when the loop was still blocked at capture end', () => {
    const windows = buildEventLoopStallWindows([{ atMs: 100, lagMs: 10 }], 1000, 20);
    expect(windows).toEqual([{ startMs: 120, endMs: 1000, maxLagMs: 880 }]);
  });
});

function node(asyncId: number, childIds: number[]): AsyncChainNode {
  return {
    asyncId,
    kind: 'promise',
    rawType: 'PROMISE',
    durationMs: 0,
    runMs: 0,
    initAtMs: 0,
    depth: 0,
    childIds,
    orphan: false,
  };
}
