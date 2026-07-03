import { describe, expect, it } from 'vitest';
import {
  createCaptureIntegrity,
  mergeCaptureIntegrityCounters,
} from '../src/capture/core/session.js';

describe('mergeCaptureIntegrityCounters', () => {
  it('takes the max per counter across successive merges', () => {
    const integrity = createCaptureIntegrity();

    mergeCaptureIntegrityCounters(integrity, {
      controlChannelWriteErrors: 2,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 5,
      eventLoopSamplesDropped: 1000,
      gcEventsDropped: 0,
      memoryUsageSamplesDropped: 0,
    });

    // A later, staler read reports lower counts than what was already
    // observed live — the running totals must not regress.
    mergeCaptureIntegrityCounters(integrity, {
      controlChannelWriteErrors: 1,
      gcObserverSetupFailed: 3,
      heartbeatDropped: 5,
      eventLoopSamplesDropped: 500,
      gcEventsDropped: 200,
      memoryUsageSamplesDropped: 0,
    });

    expect(integrity.controlChannelWriteErrors).toBe(2);
    expect(integrity.gcObserverSetupFailed).toBe(3);
    expect(integrity.heartbeatDropped).toBe(5);
    expect(integrity.eventLoopSamplesDropped).toBe(1000);
    expect(integrity.gcEventsDropped).toBe(200);
    expect(integrity.memoryUsageSamplesDropped).toBe(0);
  });

  it('is a no-op when counters are undefined', () => {
    const integrity = createCaptureIntegrity({ heartbeatDropped: 4 });
    mergeCaptureIntegrityCounters(integrity, undefined);
    expect(integrity.heartbeatDropped).toBe(4);
  });

  it('treats missing optional drop counters as zero', () => {
    const integrity = createCaptureIntegrity();
    mergeCaptureIntegrityCounters(integrity, {
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
    });
    expect(integrity.eventLoopSamplesDropped).toBe(0);
    expect(integrity.gcEventsDropped).toBe(0);
    expect(integrity.memoryUsageSamplesDropped).toBe(0);
  });
});

describe('createCaptureIntegrity', () => {
  it('defaults new drop counters to zero', () => {
    const integrity = createCaptureIntegrity();
    expect(integrity.eventLoopSamplesDropped).toBe(0);
    expect(integrity.gcEventsDropped).toBe(0);
    expect(integrity.memoryUsageSamplesDropped).toBe(0);
  });
});
