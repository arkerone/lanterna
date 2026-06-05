import type { ProbeLifecycleContext, ProfileKind } from '../../kinds/core/types.js';
import { logger } from '../../shared/logger.js';
import { withTimeoutResult } from '../../shared/timeout.js';
import { captureDiagnosticMessage, recordCaptureDiagnostic } from '../core/session.js';
import type { CaptureDiagnosticStage, CaptureIntegrity, ConnectedSource } from '../core/types.js';
import { emitCaptureProgress } from './progress.js';

const PROBE_STOP_TIMEOUT_MS = 5000;

/** Why the capture stopped — threaded into the probe stop/dispose lifecycle. */
export type StopReason = 'exit' | 'timeout' | 'signal';

type Cdp = ConnectedSource['cdp'];
type ProbeInstance = {
  kind: ProfileKind;
  probe: ReturnType<ProfileKind['createProbe']>;
};
type TimedProbeStepResult<T> = { ok: true; value: T } | { ok: false };

/** The cross-cutting context every probe lifecycle step needs. */
export interface ProbeOrchestratorContext<TSourceOptions> {
  readonly cdp: Cdp;
  readonly mode: ProbeLifecycleContext['mode'];
  readonly captureIntegrity: CaptureIntegrity;
  readonly sourceOptions: TSourceOptions;
  readonly abortSignal?: AbortSignal;
}

/**
 * Owns the install → start → stop → dispose probe lifecycle and everything that
 * goes with it: ordering (dispose runs in `stop`'s `finally`), the per-step
 * timeouts, progress emission, and integrity diagnostics. The coordinator hands
 * it the cross-cutting context once and then drives only `install` / `start` /
 * `stop`, instead of threading `(cdp, mode, options, captureIntegrity, stopReason)`
 * through eight free functions.
 */
export class ProbeOrchestrator<TSourceOptions> {
  private readonly probeInstances: ProbeInstance[] = [];

  constructor(private readonly ctx: ProbeOrchestratorContext<TSourceOptions>) {}

  /** Install each kind's probe, recording a diagnostic for any that fail. */
  async install(kinds: readonly ProfileKind[]): Promise<void> {
    for (const kind of kinds) {
      const probe = kind.createProbe();
      try {
        await probe.install?.(this.lifecycleContext(kind.id));
        this.probeInstances.push({ kind, probe });
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind probe install failed');
        this.recordDiagnostic('probe-install', kind.id, error);
      }
    }
  }

  /** Start every installed probe. A probe that throws is left out of the stop pass. */
  async start(): Promise<void> {
    for (const { kind, probe } of this.probeInstances) {
      try {
        // Probes with a deferred post-resume step own their start progress
        // message — emitting it here would announce work that has not run yet.
        if (!probe.afterRuntimeReleased) this.emitStartProgress(probe);
        await probe.start(this.lifecycleContext(kind.id, { abortSignal: this.ctx.abortSignal }));
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind probe failed to start');
        this.recordDiagnostic('probe-start', kind.id, error);
      }
    }
  }

  /**
   * Run each probe's optional post-resume step. Called after the coordinator has
   * released the target runtime, so work that needs the isolate to actually run
   * (e.g. the start heap snapshot) no longer deadlocks against `--inspect-brk`.
   */
  async afterRuntimeReleased(): Promise<void> {
    for (const { kind, probe } of this.probeInstances) {
      if (!probe.afterRuntimeReleased) continue;
      try {
        this.emitStartProgress(probe);
        await probe.afterRuntimeReleased(
          this.lifecycleContext(kind.id, { abortSignal: this.ctx.abortSignal }),
        );
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind probe post-resume step failed');
        this.recordDiagnostic('probe-start', kind.id, error);
      }
    }
  }

  /**
   * Stop every probe and collect its data, keyed by kind id. Each probe is
   * disposed in a `finally` regardless of stop outcome.
   */
  async stop(connected: ConnectedSource, stopReason: StopReason): Promise<Record<string, unknown>> {
    const kindsData: Record<string, unknown> = {};
    for (const probeInstance of this.probeInstances) {
      const stopped = await this.stopProbe(probeInstance, connected, stopReason);
      if (stopped.ok) kindsData[probeInstance.kind.id] = stopped.value;
    }
    return kindsData;
  }

  private async stopProbe(
    { kind, probe }: ProbeInstance,
    connected: ConnectedSource,
    stopReason: StopReason,
  ): Promise<TimedProbeStepResult<unknown>> {
    let stopSucceeded = false;
    try {
      const stopTimeoutMs = probe.stopTimeoutMs ?? PROBE_STOP_TIMEOUT_MS;
      this.emitStopProgress(probe, stopReason);
      const ctx = this.lifecycleContext(kind.id, {
        abortSignal: this.ctx.abortSignal,
        stopReason,
        ...(connected.drainLiveSignals
          ? { liveSourceSignals: connected.drainLiveSignals.bind(connected) }
          : {}),
      });
      const stopResult = await runProbeStepWithTimeout(() => probe.stop(ctx), stopTimeoutMs);

      if (stopResult.ok) {
        stopSucceeded = true;
        return stopResult;
      }

      this.recordTimeout('probe-stop', kind.id, `stopping ${kind.id} probe`, stopTimeoutMs);
    } catch (error) {
      logger.warn({ kindId: kind.id, err: error }, 'kind probe failed to stop');
      this.recordDiagnostic('probe-stop', kind.id, error);
      return { ok: false };
    } finally {
      await this.disposeProbe({ kind, probe }, stopReason, stopSucceeded);
    }
    return { ok: false };
  }

  private async disposeProbe(
    { kind, probe }: ProbeInstance,
    stopReason: StopReason,
    stopSucceeded: boolean,
  ): Promise<void> {
    if (!probe.dispose) return;
    const dispose = probe.dispose;
    try {
      this.emitDisposeProgress(probe);
      const disposeTimeoutMs = probe.disposeTimeoutMs ?? PROBE_STOP_TIMEOUT_MS;
      const ctx = this.lifecycleContext(kind.id, {
        abortSignal: this.ctx.abortSignal,
        stopReason,
        stopSucceeded,
      });
      const disposeResult = await runProbeStepWithTimeout(() => dispose(ctx), disposeTimeoutMs);
      if (disposeResult.ok) return;
      this.recordTimeout('probe-dispose', kind.id, `disposing ${kind.id} probe`, disposeTimeoutMs);
    } catch (error) {
      logger.warn({ kindId: kind.id, err: error }, 'kind probe failed to dispose');
      this.recordDiagnostic('probe-dispose', kind.id, error);
    }
  }

  private lifecycleContext<TExtra extends Record<string, unknown> = Record<string, never>>(
    kindId: string,
    extra = {} as TExtra,
  ): ProbeLifecycleContext & TExtra {
    return { cdp: this.ctx.cdp, mode: this.ctx.mode, kindId, ...extra };
  }

  private emitStartProgress(probe: ProbeInstance['probe']): void {
    if (!probe.progressMessages?.start) return;
    emitCaptureProgress(this.ctx.sourceOptions, {
      stage: 'start-capture',
      message: probe.progressMessages.start,
    });
  }

  private emitStopProgress(probe: ProbeInstance['probe'], stopReason: StopReason): void {
    if (!probe.progressMessages?.stop || stopReason === 'signal') return;
    emitCaptureProgress(this.ctx.sourceOptions, {
      stage: 'finalize-capture',
      message: probe.progressMessages.stop,
    });
  }

  private emitDisposeProgress(probe: ProbeInstance['probe']): void {
    if (!probe.progressMessages?.dispose) return;
    emitCaptureProgress(this.ctx.sourceOptions, {
      stage: 'finalize-capture',
      message: probe.progressMessages.dispose,
    });
  }

  private recordDiagnostic(stage: CaptureDiagnosticStage, kindId: string, error: unknown): void {
    recordCaptureDiagnostic(this.ctx.captureIntegrity, {
      stage,
      kindId,
      message: captureDiagnosticMessage(error),
    });
  }

  private recordTimeout(
    stage: CaptureDiagnosticStage,
    kindId: string,
    what: string,
    timeoutMs: number | false,
  ): void {
    recordCaptureDiagnostic(this.ctx.captureIntegrity, {
      stage,
      kindId,
      message: `timed out ${what} after ${timeoutMs}ms`,
    });
  }
}

async function runProbeStepWithTimeout<T>(
  step: () => Promise<T>,
  timeoutMs: number | false,
): Promise<TimedProbeStepResult<T>> {
  if (timeoutMs === false) {
    return { ok: true, value: await step() };
  }
  return withTimeoutResult(step(), timeoutMs);
}
