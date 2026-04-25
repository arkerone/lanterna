import type { CaptureDiagnostic, CaptureIntegrity } from './types.js';

export type CaptureIntegrityCounters = Pick<
  CaptureIntegrity,
  'controlChannelWriteErrors' | 'gcObserverSetupFailed' | 'heartbeatDropped'
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
    kinds: {},
    ...overrides,
  };
}

export function mergeCaptureIntegrityCounters(
  captureIntegrity: CaptureIntegrity,
  counters: CaptureIntegrityCounters | undefined,
): void {
  if (!counters) return;
  captureIntegrity.controlChannelWriteErrors = counters.controlChannelWriteErrors;
  captureIntegrity.gcObserverSetupFailed = counters.gcObserverSetupFailed;
  captureIntegrity.heartbeatDropped = counters.heartbeatDropped;
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
