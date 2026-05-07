import { describe, expect, it } from 'vitest';
import { buildEventLoopReport } from '../src/analysis/model/event-loop-report.js';
import type { CaptureBundle } from '../src/capture/core/types.js';
import type { EventLoopHistogram, EventLoopSample } from '../src/index.js';

interface BuildOptions {
  durationMs?: number;
  eventLoopTimed?: boolean;
  samples?: EventLoopSample[];
  histogram?: EventLoopHistogram;
  resolutionMs?: number;
}

function makeInput({
  durationMs = 5000,
  eventLoopTimed = true,
  samples = [],
  histogram,
  resolutionMs = 20,
}: BuildOptions): {
  captureIntegrity: CaptureBundle['captureIntegrity'];
  durationMs: number;
  runtimeSignals: CaptureBundle['runtimeSignals'];
} {
  return {
    captureIntegrity: {
      controlChannel: true,
      controlChannelExpected: true,
      eventLoopTimed,
      gcTimed: false,
      gcObserverAvailable: true,
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
      kinds: {},
    },
    durationMs,
    runtimeSignals: {
      gcEvents: [],
      eventLoopSamples: samples,
      ...(histogram !== undefined ? { eventLoopHistogram: histogram } : {}),
      eventLoopResolutionMs: resolutionMs,
      eventLoopAvailable: samples.length > 0 || histogram !== undefined,
    },
  };
}

describe('buildEventLoopReport', () => {
  it('returns an unavailable report when no signal is present', () => {
    const report = buildEventLoopReport(makeInput({ eventLoopTimed: false }));
    expect(report.available).toBe(false);
    expect(report.measurementBasis).toBe('none');
    expect(report.confidence).toBe('none');
    expect(report.maxLagMs).toBe(0);
    expect(report.stallIntervals).toEqual([]);
    expect(report.histogram).toBeUndefined();
  });

  it('uses the histogram when no timed heartbeats are available', () => {
    const histogram: EventLoopHistogram = {
      maxMs: 250,
      p99Ms: 200,
      p50Ms: 5,
      meanMs: 12,
    };
    const report = buildEventLoopReport(makeInput({ eventLoopTimed: false, histogram }));
    expect(report.available).toBe(true);
    expect(report.measurementBasis).toBe('histogram');
    expect(report.confidence).toBe('low');
    expect(report.maxLagMs).toBe(250);
    expect(report.p99LagMs).toBe(200);
    expect(report.p50LagMs).toBe(5);
    expect(report.meanLagMs).toBe(12);
    // No timed heartbeats → no stall intervals reconstructed.
    expect(report.stallIntervals).toEqual([]);
  });

  it('summarizes from heartbeats when only samples are available', () => {
    const samples: EventLoopSample[] = [
      { atMs: 100, lagMs: 5 },
      { atMs: 200, lagMs: 10 },
      { atMs: 300, lagMs: 50 },
    ];
    const report = buildEventLoopReport(makeInput({ samples, durationMs: 320 }));
    expect(report.available).toBe(true);
    expect(report.measurementBasis).toBe('heartbeats');
    expect(report.confidence).toBe('high');
    expect(report.maxLagMs).toBe(50);
    expect(report.p50LagMs).toBe(10);
    expect(report.sampleCount).toBe(3);
    expect(report.histogram).toBeUndefined();
  });

  it('prefers histogram metrics when both heartbeats and histogram are present (basis: both)', () => {
    const samples: EventLoopSample[] = [
      { atMs: 50, lagMs: 5 },
      { atMs: 150, lagMs: 8 },
    ];
    const histogram: EventLoopHistogram = {
      maxMs: 999,
      p99Ms: 750,
      p50Ms: 7,
      meanMs: 30,
    };
    const report = buildEventLoopReport(makeInput({ samples, histogram, durationMs: 200 }));
    expect(report.measurementBasis).toBe('both');
    expect(report.confidence).toBe('high');
    expect(report.maxLagMs).toBe(999);
    expect(report.p99LagMs).toBe(750);
    expect(report.histogram).toEqual({
      maxLagMs: 999,
      p99LagMs: 750,
      p50LagMs: 7,
      meanLagMs: 30,
    });
  });

  it('emits stall intervals for samples whose lag exceeds the 200ms threshold', () => {
    const samples: EventLoopSample[] = [
      { atMs: 100, lagMs: 5 }, // ignored (below threshold)
      { atMs: 500, lagMs: 250 }, // stall — threshold is 200ms
      { atMs: 1500, lagMs: 800 }, // stall
    ];
    // durationMs == last sample atMs + resolution → no trailing stall
    const report = buildEventLoopReport(makeInput({ samples, durationMs: 1520 }));
    expect(report.stallIntervals).toHaveLength(2);
    expect(report.stallIntervals[0]).toEqual({
      startMs: 250, // 500 - 250
      endMs: 500,
      maxLagMs: 250,
    });
    expect(report.stallIntervals[1]).toEqual({
      startMs: 700, // 1500 - 800
      endMs: 1500,
      maxLagMs: 800,
    });
  });

  it('clamps stall start to 0 when the lag predates the capture origin', () => {
    const samples: EventLoopSample[] = [{ atMs: 50, lagMs: 250 }];
    // last atMs + resolution = 70 → no trailing
    const report = buildEventLoopReport(makeInput({ samples, durationMs: 70 }));
    expect(report.stallIntervals).toHaveLength(1);
    expect(report.stallIntervals[0]?.startMs).toBe(0);
    expect(report.stallIntervals[0]?.endMs).toBe(50);
  });

  it('detects a trailing stall between the last heartbeat and the capture end', () => {
    const samples: EventLoopSample[] = [{ atMs: 200, lagMs: 5 }];
    // trailing = durationMs - lastSampleAtMs - resolutionMs = 1000 - 200 - 20 = 780ms (>= 200ms threshold)
    const report = buildEventLoopReport(makeInput({ samples, durationMs: 1000, resolutionMs: 20 }));
    expect(report.stallIntervals).toHaveLength(1);
    const trailing = report.stallIntervals[0];
    expect(trailing?.startMs).toBe(220); // last + resolution
    expect(trailing?.endMs).toBe(1000);
    expect(trailing?.maxLagMs).toBe(780);
  });

  it('does not emit a trailing stall when the gap is below the 200ms threshold', () => {
    const samples: EventLoopSample[] = [{ atMs: 980, lagMs: 5 }];
    // trailing = 1000 - 980 - 20 = 0ms
    const report = buildEventLoopReport(makeInput({ samples, durationMs: 1000, resolutionMs: 20 }));
    expect(report.stallIntervals).toEqual([]);
  });

  it('merges overlapping stall intervals', () => {
    const samples: EventLoopSample[] = [
      { atMs: 500, lagMs: 250 }, // stall [250..500]
      { atMs: 600, lagMs: 350 }, // stall [250..600] — overlaps previous
      { atMs: 1500, lagMs: 250 }, // stall [1250..1500] — disjoint
    ];
    // durationMs avoids trailing stall (1500 + 20 = 1520)
    const report = buildEventLoopReport(makeInput({ samples, durationMs: 1520 }));
    expect(report.stallIntervals).toHaveLength(2);
    expect(report.stallIntervals[0]).toEqual({
      startMs: 250, // min(500-250, 600-350) = min(250, 250) = 250
      endMs: 600,
      maxLagMs: 350,
    });
    expect(report.stallIntervals[1]).toEqual({
      startMs: 1250,
      endMs: 1500,
      maxLagMs: 250,
    });
  });

  it('returns zero metrics with no samples and no histogram (basis: none)', () => {
    const report = buildEventLoopReport(makeInput({ eventLoopTimed: true, samples: [] }));
    // eventLoopTimed=true but samples.length=0 → hasTimedHeartbeats=false → basis=none
    expect(report.measurementBasis).toBe('none');
    expect(report.available).toBe(false);
  });

  it('uses the resolution from the runtime signals when computing trailing lag', () => {
    const samples: EventLoopSample[] = [{ atMs: 200, lagMs: 5 }];
    // durationMs - lastSampleAtMs - resolutionMs = 1000 - 200 - 100 = 700ms (still over threshold)
    const reportLargerResolution = buildEventLoopReport(
      makeInput({ samples, durationMs: 1000, resolutionMs: 100 }),
    );
    expect(reportLargerResolution.stallIntervals[0]?.startMs).toBe(300); // 200 + 100
    expect(reportLargerResolution.stallIntervals[0]?.maxLagMs).toBe(700);
  });
});
