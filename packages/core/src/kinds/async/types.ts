/**
 * Coarse async-resource families surfaced in the report. The preload hook
 * normalizes Node's free-form `type` strings (TCPWRAP, FSREQCALLBACK, ...)
 * down to this small enum so detectors and consumers don't have to know the
 * full taxonomy. `other` catches anything we don't classify yet.
 */
export type AsyncOperationKind =
  | 'promise'
  | 'timer'
  | 'immediate'
  | 'tcp'
  | 'udp'
  | 'fs'
  | 'http'
  | 'http2'
  | 'tls'
  | 'dns'
  | 'pipe'
  | 'process'
  | 'tickobject'
  | 'microtask'
  | 'other';

/**
 * One async-resource lifecycle, post-aggregated in the preload hook from the
 * raw async_hooks callbacks. We deliberately drop sub-callback granularity
 * (`before`/`after` pairs are summed into `runMs`) to keep payloads compact —
 * even a busy server keeps this under a few MB at the default cap.
 */
export interface AsyncStackFrame {
  function: string;
  file: string;
  line: number;
  column: number;
}

export interface AsyncCdpAsyncStackSegment {
  description?: string;
  frames: AsyncStackFrame[];
}

export interface AsyncCdpContext {
  source:
    | 'Runtime.exceptionThrown'
    | 'Runtime.consoleAPICalled'
    | 'Debugger.paused'
    | 'Runtime.evaluate';
  proofLevel: 'cdp-debugger-async-stack';
  capturedAtMs?: number;
  frames: AsyncStackFrame[];
  asyncStack: AsyncCdpAsyncStackSegment[];
}

export type AsyncInstrumentationMode = 'off' | 'safe' | 'full';

export interface AsyncRunWindow {
  startMs: number;
  endMs: number;
}

export interface AsyncOperationRecord {
  asyncId: number;
  triggerAsyncId: number;
  kind: AsyncOperationKind;
  /** Original Node async type string (TCPWRAP, PROMISE, ...) for debugging. */
  rawType: string;
  /** ms from capture-start to init. */
  initAtMs: number;
  /** ms from capture-start to first promiseResolve / first after / destroy. */
  resolvedAtMs?: number;
  destroyedAtMs?: number;
  /** Total elapsed time the resource was alive (resolved or destroyed - init). */
  durationMs?: number;
  /** Sum of (after - before) over the resource's run windows. */
  runMs: number;
  /** Number of times the resource ran (before/after pair count). */
  runCount: number;
  /** True when init was observed but no destroy/resolve fired before flush. */
  orphan: boolean;
  /** Top JS stack frames at init (after filtering lanterna/internal frames). */
  initStack: AsyncStackFrame[];
  /** Run windows kept for CPU sample attribution. May be capped per-record. */
  runWindows: AsyncRunWindow[];
  promiseRegistrationStack?: AsyncStackFrame[];
  promiseHandlerStack?: AsyncStackFrame[];
  awaitStack?: AsyncStackFrame[];
  safeRegistrationStack?: AsyncStackFrame[];
  safeHandlerStack?: AsyncStackFrame[];
  cdpAsyncContext?: AsyncCdpContext;
  executionStack?: AsyncStackFrame[];
  executionConfidence?: 'low' | 'medium' | 'high';
  cpuAttributedSamples?: number;
  cpuAmbiguousSamples?: number;
}

export interface AsyncConcurrencySample {
  atMs: number;
  /** Resources currently between `before` and `after`. */
  active: number;
  /** Resources alive (init fired, no destroy yet). */
  inflight: number;
}

export interface AsyncIntegrityCounters {
  /** Records dropped because the ring buffer was full. */
  recordsDropped: number;
  /** Init events seen. */
  initCount: number;
  /** Destroy events seen. */
  destroyCount: number;
  /** Promise resolve events seen. */
  resolveCount: number;
  /** Records still inflight at flush time. */
  orphanCount: number;
}

export interface AsyncKindData {
  /** True when async_hooks ran (preload installed). False on attach-only. */
  available: boolean;
  /** Where the async data came from. */
  collectedVia: 'async-hooks' | 'cdp-only' | 'unavailable';
  /** Max records the hook was allowed to keep. */
  maxRecords: number;
  records: AsyncOperationRecord[];
  concurrency: AsyncConcurrencySample[];
  integrity: AsyncIntegrityCounters;
  /** Microtask types that were filtered out (kept as bare counters). */
  filteredCounts: Record<string, number>;
  instrumentationMode?: AsyncInstrumentationMode;
  attachPartialCapture?: boolean;
  clockSyncUncertaintyMs?: number;
  cdpAsyncContexts?: AsyncCdpContext[];
  transformStats?: {
    transformed: number;
    skipped: number;
    failed: number;
    partial: boolean;
    awaitCalls?: number;
  };
}

/**
 * Internal — node of the trigger tree built in the analysis contributor.
 * Exported so detectors can walk chains via the kind view.
 */
export interface AsyncChainNode {
  asyncId: number;
  kind: AsyncOperationKind;
  rawType: string;
  durationMs: number;
  runMs: number;
  initAtMs: number;
  depth: number;
  childIds: number[];
  orphan: boolean;
}
