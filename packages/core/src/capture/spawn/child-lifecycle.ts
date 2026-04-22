import type { ChildProcess } from 'node:child_process';
import { attachControlChannel } from '../../runtime-signals/control-channel.js';
import type { CaptureIntegrity, EventLoopSample, RawGcEvent } from '../core/types.js';

export interface SpawnLifecycleState {
  captureIntegrity: CaptureIntegrity;
  gcEventsAbs: RawGcEvent[];
  eventLoopSamplesAbs: EventLoopSample[];
  appCompleted: boolean;
  eventLoopAvailable: boolean;
  eventLoopResolutionMs?: number;
}

export interface SpawnLifecycleHandle {
  readonly state: SpawnLifecycleState;
  armRuntimeCompletion(): void;
  markRuntimeComplete(): void;
  waitForAppCompletion(): Promise<void>;
}

export function createSpawnLifecycle(
  child: ChildProcess,
  controlStream: NodeJS.ReadableStream | null | undefined,
  captureIntegrity: CaptureIntegrity,
): SpawnLifecycleHandle {
  const state: SpawnLifecycleState = {
    captureIntegrity,
    gcEventsAbs: [],
    eventLoopSamplesAbs: [],
    appCompleted: false,
    eventLoopAvailable: false,
    eventLoopResolutionMs: undefined,
  };

  let runtimeCompletionArmed = false;
  let resolveAppCompletion = () => {};

  const appCompletionPromise = new Promise<void>((resolveDone) => {
    let settled = false;
    resolveAppCompletion = () => {
      if (settled) return;
      settled = true;
      resolveDone();
    };

    if (controlStream) {
      attachControlChannel(controlStream, {
        onEvent(event) {
          state.captureIntegrity.controlChannel = true;
          if (event.type === 'hook-ready') {
            state.eventLoopAvailable = Boolean(event.capabilities?.eventLoop);
            state.eventLoopResolutionMs = event.eventLoopResolutionMs;
            state.captureIntegrity.gcObserverAvailable = Boolean(event.capabilities?.gc);
            return;
          }
          if (event.type === 'capture-start') {
            state.eventLoopResolutionMs = event.resolutionMs ?? state.eventLoopResolutionMs;
            return;
          }
          if (event.type === 'heartbeat') {
            state.eventLoopAvailable = true;
            state.captureIntegrity.eventLoopTimed = true;
            state.eventLoopSamplesAbs.push({ atMs: event.atMs, lagMs: event.lagMs });
            return;
          }
          if (event.type === 'gc') {
            state.captureIntegrity.gcTimed = true;
            state.gcEventsAbs.push({
              atMs: event.atMs,
              kind: event.kind ?? 'other',
              durationMs: event.durationMs,
            });
            return;
          }
          if (event.type === 'app-complete') {
            state.appCompleted = true;
            resolveAppCompletion();
          }
        },
      });
    }

    child.once('exit', () => resolveAppCompletion());
  });

  return {
    state,
    armRuntimeCompletion() {
      runtimeCompletionArmed = true;
    },
    markRuntimeComplete() {
      if (!runtimeCompletionArmed || state.appCompleted) return;
      state.appCompleted = true;
      resolveAppCompletion();
    },
    async waitForAppCompletion() {
      await appCompletionPromise;
    },
  };
}
