import type { CdpClient } from '../../inspector/client.js';
import { drainEventLoopSamples } from '../../runtime-signals/readers/event-loop.js';
import { drainGcEvents } from '../../runtime-signals/readers/gc.js';
import { PERIODIC_DRAIN_INTERVAL_MS } from '../../shared/config.js';
import { withTimeoutResult } from '../../shared/timeout.js';
import { recordCaptureDiagnostic } from '../core/session.js';
import type { CaptureIntegrity, EventLoopSample, RawGcEvent } from '../core/types.js';

const DRAIN_READ_TIMEOUT_MS = 1500;

/** The slice of {@link ProbeOrchestrator} this class needs — kept minimal to avoid generic-variance friction with `ProbeOrchestrator<TSourceOptions>`. */
export interface DrainableProbes {
  drain(): Promise<void>;
}

/**
 * Periodically drains the in-target event-loop/GC buffers (and, via
 * {@link DrainableProbes.drain}, any kind probe that opted in) while a
 * capture runs in attach/in-process mode. Spawn mode already streams every
 * signal live over the control channel, so this loop is never started there.
 *
 * Without this, attach captures only read the in-target buffers once, at
 * stop — if the target exits or blocks mid-capture, everything since the
 * last (and only) read is lost. Draining every {@link PERIODIC_DRAIN_INTERVAL_MS}
 * bounds that loss to one interval and keeps the in-target caps (see
 * `hooks/framework.ts`) effectively unreachable.
 */
export class PeriodicSignalDrain {
  private readonly eventLoopSamplesAbs: EventLoopSample[] = [];
  private readonly gcEventsAbs: RawGcEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight: Promise<void> | null = null;
  private stopped = false;
  private eventLoopReadFailed = false;
  private gcReadFailed = false;

  constructor(
    private readonly cdp: CdpClient,
    private readonly probes: DrainableProbes,
    private readonly captureIntegrity: CaptureIntegrity,
    private readonly intervalMs: number = PERIODIC_DRAIN_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Stops scheduling new ticks and awaits any tick already in flight. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.tickInFlight;
  }

  accumulated(): { eventLoopSamplesAbs: EventLoopSample[]; gcEventsAbs: RawGcEvent[] } {
    return {
      eventLoopSamplesAbs: this.eventLoopSamplesAbs.slice(),
      gcEventsAbs: this.gcEventsAbs.slice(),
    };
  }

  private tick(): void {
    if (this.stopped || this.tickInFlight || this.cdp.closed) return;
    this.tickInFlight = this.runTick().finally(() => {
      this.tickInFlight = null;
    });
  }

  private async runTick(): Promise<void> {
    await Promise.all([this.drainEventLoop(), this.drainGc(), this.probes.drain()]);
  }

  private async drainEventLoop(): Promise<void> {
    if (this.cdp.closed) return;
    const result = await withTimeoutResult(drainEventLoopSamples(this.cdp), DRAIN_READ_TIMEOUT_MS);
    if (result.ok) {
      this.eventLoopSamplesAbs.push(...result.value);
      return;
    }
    if (this.eventLoopReadFailed) return;
    this.eventLoopReadFailed = true;
    recordCaptureDiagnostic(this.captureIntegrity, {
      stage: 'runtime-read',
      message: `periodic drain of event-loop samples timed out after ${DRAIN_READ_TIMEOUT_MS}ms`,
    });
  }

  private async drainGc(): Promise<void> {
    if (this.cdp.closed) return;
    const result = await withTimeoutResult(drainGcEvents(this.cdp), DRAIN_READ_TIMEOUT_MS);
    if (result.ok) {
      this.gcEventsAbs.push(...result.value);
      return;
    }
    if (this.gcReadFailed) return;
    this.gcReadFailed = true;
    recordCaptureDiagnostic(this.captureIntegrity, {
      stage: 'runtime-read',
      message: `periodic drain of GC events timed out after ${DRAIN_READ_TIMEOUT_MS}ms`,
    });
  }
}
