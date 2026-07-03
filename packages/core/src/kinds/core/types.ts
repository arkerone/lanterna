import type { ZodType } from 'zod';
import type { FindingAnalyzer, SectionAnalyzer } from '../../analysis/core/types.js';
import type { LiveSourceSignals } from '../../capture/core/types.js';
import type { CdpClient } from '../../inspector/client.js';
import type { HookInstaller } from '../../runtime-signals/hooks/framework.js';

/**
 * Map of kind id -> raw capture data shape. Extended by each kind package
 * via module augmentation.
 *
 * @example
 * ```ts
 * declare module '@lanterna-profiler/core' {
 *   interface CaptureKindDataMap {
 *     memory: MemoryKindData;
 *   }
 * }
 * ```
 */
export interface CaptureKindDataMap {
  [kindId: string]: unknown;
}

/**
 * Map of report section key -> report section shape. Augmented per-kind.
 * Controls what appears under `report.profiles[reportSectionKey]`.
 */
export interface ProfileSectionMap {
  [kindId: string]: unknown;
}

/**
 * Map of kind id -> typed context view exposed to analyzers via
 * `context.forKind(id)`. Augmented per-kind.
 */
export interface KindViews {
  [kindId: string]: unknown;
}

export interface ProbeLifecycleContext {
  cdp: CdpClient;
  mode: 'spawn' | 'attach' | 'in-process';
  kindId: string;
  liveSourceSignals?: () => LiveSourceSignals;
}

export type ProbeStopReason = 'exit' | 'timeout' | 'signal';

export interface CaptureProbe<TData> {
  /**
   * Optional timeout for probe stop/finalization work. Defaults to the coordinator
   * timeout; use false only when the probe has a protocol-level completion signal.
   */
  stopTimeoutMs?: number | false;
  /**
   * Optional timeout for best-effort probe cleanup. Defaults to the coordinator
   * timeout; use false only when cleanup has its own completion signal.
   */
  disposeTimeoutMs?: number | false;
  progressMessages?: {
    start?: string;
    stop?: string;
    dispose?: string;
  };
  install?(ctx: ProbeLifecycleContext): Promise<void>;
  start(ctx: ProbeLifecycleContext & { abortSignal?: AbortSignal }): Promise<void>;
  /**
   * Optional step that runs once the target runtime has been resumed (spawn mode
   * releases `--inspect-brk` here; in attach mode the target was never suspended).
   * Use it for start-of-capture work that needs the V8 isolate to actually run —
   * e.g. `HeapProfiler.takeHeapSnapshot`, which never completes while the isolate
   * is parked at the inspector breakpoint. Runs after {@link start} and before the
   * workload/readiness wait, so it still observes a clean start-of-capture baseline.
   */
  afterRuntimeReleased?(ctx: ProbeLifecycleContext & { abortSignal?: AbortSignal }): Promise<void>;
  /**
   * Optional periodic mid-capture drain (attach/in-process modes only —
   * spawn already streams data live over the control channel). The
   * coordinator calls this on a fixed interval while the capture runs and
   * again right before stop, so a probe that accumulates in-target state can
   * pull and clear it incrementally instead of losing everything if the
   * target exits or blocks between the start and the final `stop()` read.
   * Best-effort: a probe without this hook is simply never drained early.
   */
  drain?(ctx: ProbeLifecycleContext): Promise<void>;
  stop(
    ctx: ProbeLifecycleContext & {
      abortSignal?: AbortSignal;
      stopReason?: ProbeStopReason;
    },
  ): Promise<TData>;
  dispose?(
    ctx: ProbeLifecycleContext & {
      abortSignal?: AbortSignal;
      stopReason?: ProbeStopReason;
      stopSucceeded: boolean;
    },
  ): Promise<void>;
}

/**
 * Passed to {@link KindAnalysisContributor.analyze}. Gives a kind everything
 * it needs to populate its report section + expose a typed analysis view.
 */
export interface KindAnalysisContext<TData> {
  readonly data: TData;
  readonly bundle: import('../../capture/core/types.js').CaptureBundle;
  readonly analysis: import('../../analysis/core/types.js').AnalysisContext;
  readonly options: import('../../analysis/core/types.js').AnalysisOptions;
  readonly sectionKey: string;
  /** Publishes the kind's report section under `report.profiles[sectionKey]`. */
  writeSection<T>(section: T): void;
  /** Publishes the typed view retrievable via `context.forKind(kindId)`. */
  setContextView<V>(view: V): void;
}

export interface KindAnalysisContributor<TData> {
  analyze(ctx: KindAnalysisContext<TData>): void;
}

/**
 * Back-compat alias — ProfileKind now exposes `finalize` directly as a method
 * (bivariant method syntax) so `ProfileKind<Cpu>` stays assignable to
 * `ProfileKind<unknown>` in a heterogeneous registry.
 */
export type KindFinalizeHook<TData> = (args: {
  data: TData;
  snapshot: {
    profiles: Partial<ProfileSectionMap>;
    findings: import('../../report/types.js').Finding[];
  };
}) => void;

export interface ProfileKind<TData = unknown> {
  /** Stable identifier used on the CLI (`--kind cpu`) and in `meta.profileKinds` when captured. */
  id: string;
  /** Human-readable label for logs and help. */
  label?: string;
  /** Key under `report.profiles.*`. Usually equal to `id`. */
  reportSectionKey: string;
  /** Zod schema validating the kind's report section under `profiles[sectionKey]`. */
  reportSchema: ZodType;
  /** Optional preload-hook fragment contributed by this kind. */
  hookInstaller?: HookInstaller;
  /** Optional message emitted immediately when the user manually stops this kind. */
  manualStopMessage?: string;
  /**
   * Builds the capture probe. The kind closes over its own options at
   * construction time — there are no global probe options anymore (each kind
   * decides its own sampling interval, depth, etc.).
   */
  createProbe(): CaptureProbe<TData>;
  createAnalysisContributor(): KindAnalysisContributor<TData>;
  /** Contribution merged under `meta.kinds[id]`. */
  contributeMeta?(data: TData): Record<string, unknown>;
  /** Contribution merged under `meta.captureIntegrity.kinds[id]`. */
  contributeIntegrity?(data: TData): Record<string, unknown>;
  /** Analyzers the kind wants to run by default. User `extraAnalyzers` are appended. */
  builtInAnalyzers?: ReadonlyArray<FindingAnalyzer | SectionAnalyzer>;
  /**
   * Optional post-findings mutator. Declared as a method (not a property of
   * function type) so TData stays assignable across `ProfileKind<A>` vs
   * `ProfileKind<B>` in heterogeneous kind collections.
   */
  finalize?(args: {
    data: TData;
    snapshot: {
      profiles: Partial<ProfileSectionMap>;
      findings: import('../../report/types.js').Finding[];
    };
  }): void;
}

/**
 * Identity helper that preserves generics for IDE autocompletion.
 */
export function defineProfileKind<TData>(kind: ProfileKind<TData>): ProfileKind<TData> {
  return kind;
}
