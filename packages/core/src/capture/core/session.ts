import type { CaptureDiagnostic, CaptureIntegrity } from './types.js';

export type CaptureIntegrityCounters = Pick<
  CaptureIntegrity,
  | 'controlChannelWriteErrors'
  | 'gcObserverSetupFailed'
  | 'heartbeatDropped'
  | 'eventLoopSamplesDropped'
  | 'gcEventsDropped'
  | 'memoryUsageSamplesDropped'
>;

export function createCaptureIntegrity(
  overrides: Partial<CaptureIntegrity> = {},
): CaptureIntegrity {
  return {
    controlChannel: false,
    controlChannelExpected: false,
    eventLoopTimed: false,
    gcTimed: false,
    gcObserverAvailable: false,
    controlChannelWriteErrors: 0,
    gcObserverSetupFailed: 0,
    heartbeatDropped: 0,
    eventLoopSamplesDropped: 0,
    gcEventsDropped: 0,
    memoryUsageSamplesDropped: 0,
    kinds: {},
    ...overrides,
  };
}

/**
 * Merges counters from a channel (live control-channel or CDP read) into the
 * running integrity totals. Uses `Math.max` per counter rather than
 * overwriting: counters are monotonic in-target, so whichever channel
 * observed the freshest (highest) value wins even if it isn't the last one
 * merged.
 */
export function mergeCaptureIntegrityCounters(
  captureIntegrity: CaptureIntegrity,
  counters: CaptureIntegrityCounters | undefined,
): void {
  if (!counters) return;
  captureIntegrity.controlChannelWriteErrors = Math.max(
    captureIntegrity.controlChannelWriteErrors,
    counters.controlChannelWriteErrors,
  );
  captureIntegrity.gcObserverSetupFailed = Math.max(
    captureIntegrity.gcObserverSetupFailed,
    counters.gcObserverSetupFailed,
  );
  captureIntegrity.heartbeatDropped = Math.max(
    captureIntegrity.heartbeatDropped,
    counters.heartbeatDropped,
  );
  captureIntegrity.eventLoopSamplesDropped = Math.max(
    captureIntegrity.eventLoopSamplesDropped ?? 0,
    counters.eventLoopSamplesDropped ?? 0,
  );
  captureIntegrity.gcEventsDropped = Math.max(
    captureIntegrity.gcEventsDropped ?? 0,
    counters.gcEventsDropped ?? 0,
  );
  captureIntegrity.memoryUsageSamplesDropped = Math.max(
    captureIntegrity.memoryUsageSamplesDropped ?? 0,
    counters.memoryUsageSamplesDropped ?? 0,
  );
}

export function recordCaptureDiagnostic(
  captureIntegrity: CaptureIntegrity,
  diagnostic: CaptureDiagnostic,
): void {
  captureIntegrity.diagnostics ??= [];
  captureIntegrity.diagnostics.push(diagnostic);
}

export function captureDiagnosticMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
