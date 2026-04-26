import type { ZodType } from 'zod';
import type { FindingAnalyzer, SectionAnalyzer } from '../../analysis/core/types.js';
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
 * Map of kind id -> report section shape. Augmented per-kind. Controls what
 * appears under `report.profiles[kindId]`.
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

export interface CaptureProbe<TData> {
  /**
   * Optional timeout for probe stop/finalization work. Defaults to the coordinator
   * timeout; use false only when the probe has a protocol-level completion signal.
   */
  stopTimeoutMs?: number | false;
  progressMessages?: {
    start?: string;
    stop?: string;
  };
  install?(cdp: CdpClient): Promise<void>;
  start(cdp: CdpClient, options?: { abortSignal?: AbortSignal }): Promise<void>;
  stop(
    cdp: CdpClient,
    options?: { abortSignal?: AbortSignal; stopReason?: 'exit' | 'timeout' | 'signal' },
  ): Promise<TData>;
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
