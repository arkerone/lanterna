import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCapture } from '../src/capture/coordinator.js';
import { createCaptureIntegrity } from '../src/capture/core/session.js';
import type {
  ConnectedSource,
  PreloadContribution,
  ProfileSource,
  TargetInfo,
} from '../src/capture/core/types.js';
import type { CdpClient } from '../src/inspector/client.js';
import { defineProfileKind, type ProfileKind } from '../src/kinds/core/types.js';

class FakeCdp implements CdpClient {
  readonly events: string[] = [];
  closed = false;
  failTargetInfo = false;
  hangClose = false;

  async send(method: string): Promise<unknown> {
    this.events.push(`send:${method}`);
    return {};
  }

  async evaluate(expression: string): Promise<unknown> {
    this.events.push('evaluate');
    if (expression.includes('JSON.stringify')) {
      if (this.failTargetInfo) return undefined;
      return JSON.stringify(makeTarget());
    }
    if (expression === 'performance.now()') return 0;
    if (expression.includes('__LANTERNA_EVENT_LOOP__')) return null;
    if (expression.includes('__LANTERNA_GC__')) return [];
    if (expression.includes('__LANTERNA_ATTACH_RUNTIME__')) return null;
    return undefined;
  }

  on(): () => void {
    return () => {};
  }

  onClose(): () => void {
    return () => {};
  }

  async close(): Promise<void> {
    this.closed = true;
    this.events.push('close');
    if (this.hangClose) await new Promise(() => {});
  }
}

type FakeSourceOptions = {
  onProgress?: (event: { stage: string; message: string }) => void;
};

class FakeSource implements ProfileSource<FakeSourceOptions | undefined> {
  readonly cdp: FakeCdp;
  finalizeCalls = 0;

  constructor(cdp = new FakeCdp()) {
    this.cdp = cdp;
  }

  async connect(
    _options: FakeSourceOptions | undefined,
    _preload: PreloadContribution,
  ): Promise<ConnectedSource> {
    return {
      cdp: this.cdp,
      target: makeTarget(),
      startedAtEpoch: Date.parse('2024-01-01T00:00:00.000Z'),
      initialIntegrity: createCaptureIntegrity(),
      waitForExit: async () => {},
      drainLiveSignals: () => ({
        gcEventsAbs: [],
        eventLoopSamplesAbs: [],
        eventLoopAvailable: false,
      }),
      finalize: async () => {
        this.finalizeCalls += 1;
        this.cdp.events.push('finalize');
      },
    };
  }
}

function makeTarget(): TargetInfo {
  return {
    pid: 1234,
    nodeVersion: 'v24.0.0',
    v8Version: '12.0.0',
    platform: 'linux',
    arch: 'x64',
    cwd: '/app',
  };
}

function diagnosticStages(bundle: Awaited<ReturnType<typeof runCapture>>): string[] {
  return (
    (
      bundle.captureIntegrity as {
        diagnostics?: Array<{ stage: string }>;
      }
    ).diagnostics?.map((diagnostic) => diagnostic.stage) ?? []
  );
}

function failingKind(id: string, phase: 'install' | 'start' | 'stop'): ProfileKind {
  return defineProfileKind({
    id,
    reportSectionKey: id,
    createProbe() {
      return {
        install:
          phase === 'install'
            ? async () => {
                throw new Error(`${id} install failed`);
              }
            : undefined,
        start: async () => {
          if (phase === 'start') throw new Error(`${id} start failed`);
        },
        stop: async () => {
          if (phase === 'stop') throw new Error(`${id} stop failed`);
          return { ok: true };
        },
      };
    },
    createAnalysisContributor() {
      return {
        analyze() {},
      };
    },
  });
}

function successfulKind(id: string): ProfileKind {
  return defineProfileKind({
    id,
    reportSectionKey: id,
    createProbe() {
      return {
        start: async () => {},
        stop: async () => ({ ok: true }),
      };
    },
    createAnalysisContributor() {
      return {
        analyze() {},
      };
    },
  });
}

function hangingStopKind(id: string): ProfileKind {
  return defineProfileKind({
    id,
    reportSectionKey: id,
    createProbe() {
      return {
        start: async () => {},
        stop: () => new Promise(() => {}),
      };
    },
    createAnalysisContributor() {
      return {
        analyze() {},
      };
    },
  });
}

describe('runCapture lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes CDP and finalizes the connected source when setup fails after connect', async () => {
    const cdp = new FakeCdp();
    cdp.failTargetInfo = true;
    const source = new FakeSource(cdp);

    await expect(
      runCapture({
        source,
        sourceOptions: undefined,
        kinds: [],
        probeOptions: { sampleIntervalMicros: 1000, deep: false },
      }),
    ).rejects.toThrow(/target metadata/);

    expect(cdp.closed).toBe(true);
    expect(source.finalizeCalls).toBe(1);
    expect(cdp.events.slice(-2)).toEqual(['close', 'finalize']);
  });

  it('records non-fatal probe diagnostics and continues capture where possible', async () => {
    const source = new FakeSource();

    const bundle = await runCapture({
      source,
      sourceOptions: undefined,
      kinds: [
        failingKind('install-fails', 'install'),
        failingKind('start-fails', 'start'),
        failingKind('stop-fails', 'stop'),
      ],
      probeOptions: { sampleIntervalMicros: 1000, deep: false },
    });

    expect(diagnosticStages(bundle)).toEqual(['probe-install', 'probe-start', 'probe-stop']);
    expect(bundle.kinds).toEqual({
      'start-fails': { ok: true },
    });
    expect(source.finalizeCalls).toBe(1);
  });

  it('times out a hanging probe stop and still finalizes the session', async () => {
    vi.useFakeTimers();
    const source = new FakeSource();

    const capturePromise = runCapture({
      source,
      sourceOptions: undefined,
      kinds: [hangingStopKind('stop-hangs')],
      probeOptions: { sampleIntervalMicros: 1000, deep: false },
    });
    const resultPromise = capturePromise.then(
      (bundle) => bundle,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result).not.toBeInstanceOf(Error);
    expect(diagnosticStages(result as Awaited<ReturnType<typeof runCapture>>)).toEqual([
      'probe-stop',
    ]);
    expect(source.finalizeCalls).toBe(1);
    vi.useRealTimers();
  });

  it('times out a hanging CDP close and still finalizes the session', async () => {
    vi.useFakeTimers();
    const cdp = new FakeCdp();
    cdp.hangClose = true;
    const source = new FakeSource(cdp);

    const capturePromise = runCapture({
      source,
      sourceOptions: undefined,
      kinds: [successfulKind('ok')],
      probeOptions: { sampleIntervalMicros: 1000, deep: false },
    });
    const resultPromise = capturePromise.then(
      (bundle) => bundle,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result).not.toBeInstanceOf(Error);
    expect(diagnosticStages(result as Awaited<ReturnType<typeof runCapture>>)).toEqual([
      'finalize',
    ]);
    expect(source.finalizeCalls).toBe(1);
    vi.useRealTimers();
  });

  it('reports capture start and running progress after the source is connected', async () => {
    const source = new FakeSource();
    const stages: string[] = [];

    await runCapture({
      source,
      sourceOptions: {
        onProgress(event) {
          stages.push(event.stage);
        },
      },
      kinds: [successfulKind('ok')],
      probeOptions: { sampleIntervalMicros: 1000, deep: false },
    });

    expect(stages).toEqual(['start-capture', 'capture-running']);
  });
});
