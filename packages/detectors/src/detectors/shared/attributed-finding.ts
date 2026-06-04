import type {
  AttributionEvidence,
  BaseFinding,
  BuiltinFinding,
  EventLoopReport,
  Finding,
  FindingMeasurements,
  FindingRemediation,
  Hotspot,
  KindScopedDetector,
  StallCorrelation,
} from '@lanterna-profiler/core';
import {
  type AttributedFindingCategory,
  type AttributedFindingExtraFor,
  aggregateByPatterns,
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  findStallCorrelation,
  pickPrimaryCallerBySource,
  resolveAttribution,
  selfHotspotUserCaller,
} from './attribution.js';

/** Minimal report surface the spine needs (event-loop stall correlation). */
export interface AttributedFindingReport {
  readonly eventLoop: EventLoopReport;
}

/** Resolved attribution pieces handed to a detector's `extra` builder. */
export interface AttributedFindingExtraParts {
  /** Shared attribution evidence: proofLevel, basis, confidence, callers. */
  readonly attributionEvidence: AttributionEvidence;
  /** Event-loop stall correlation for the resolved caller, when present. */
  readonly eventLoopCorrelation: StallCorrelation | undefined;
}

export interface AssembleAttributedFindingArgs<C extends AttributedFindingCategory> {
  readonly hotspot: Hotspot;
  readonly context: CpuHotspotContext;
  readonly cwd: string;
  readonly report: AttributedFindingReport;
  readonly category: C;
  readonly id: string;
  readonly title: string;
  readonly severity: BaseFinding['severity'];
  readonly selfPct: number;
  /** Source-text pattern used to refine the caller line via `pickPrimaryCallerBySource`. */
  readonly sourcePattern: RegExp;
  /** When `'user-self'`, a user hotspot with no sampled caller falls back to itself. */
  readonly evidenceFallback?: 'user-self';
  readonly measurements: FindingMeasurements;
  readonly remediation?: FindingRemediation;
  readonly why: string;
  readonly suggestion: string;
  readonly references: string[];
  /** Builds the category-specific `evidence.extra`, given the resolved attribution pieces. */
  buildExtra(parts: AttributedFindingExtraParts): AttributedFindingExtraFor<C>;
}

/**
 * The attribution → evidence → finding "spine" shared by every attributed-hotspot
 * detector. Lifted verbatim from the per-detector `buildFinding()` preamble
 * (`resolveAttribution` → `pickPrimaryCallerBySource` → evidence-attribution fallback
 * dance → `buildAttributionEvidence` → `findStallCorrelation` → `buildAttributedFinding`)
 * so the five built-ins stay byte-identical.
 *
 * {@link defineAttributedHotspotDetector} is the usual entry point; call this
 * directly when a detector's selection is too bespoke for the factory.
 */
export function assembleAttributedFinding<C extends AttributedFindingCategory>(
  args: AssembleAttributedFindingArgs<C>,
): BuiltinFinding<C> {
  const { hotspot, context, cwd, report, evidenceFallback } = args;
  const { attribution, caller, candidateCallers } = resolveAttribution(hotspot, context);
  const sourceCaller = pickPrimaryCallerBySource(candidateCallers, cwd, args.sourcePattern);
  const userSelfFallback =
    evidenceFallback === 'user-self' && hotspot.category === 'user'
      ? selfHotspotUserCaller(hotspot)
      : undefined;
  const evidenceAttribution = sourceCaller ?? attribution ?? userSelfFallback;
  const highConfidenceCaller =
    evidenceAttribution?.confidence === 'high' ? evidenceAttribution : undefined;
  const findingCaller =
    sourceCaller ?? caller ?? (userSelfFallback ? evidenceAttribution : undefined);
  const eventLoopCorrelation = findStallCorrelation(sourceCaller ?? caller ?? attribution, report);
  const extra = args.buildExtra({
    attributionEvidence: buildAttributionEvidence(
      evidenceAttribution,
      highConfidenceCaller,
      candidateCallers,
    ),
    eventLoopCorrelation,
  });
  return buildAttributedFinding({
    id: args.id,
    category: args.category,
    severity: args.severity,
    title: args.title,
    hotspot,
    caller: findingCaller,
    selfPct: args.selfPct,
    extra,
    measurements: args.measurements,
    ...(args.remediation ? { remediation: args.remediation } : {}),
    why: args.why,
    suggestion: args.suggestion,
    references: args.references,
  }) as BuiltinFinding<C>;
}

/** Cross-hotspot context the factory computes once and hands to every hook. */
export interface AttributedHotspotMatchCtx {
  readonly context: CpuHotspotContext;
  readonly cwd: string;
  readonly report: AttributedFindingReport;
  /** Sum of `totalPct` across the configured `family` (0 when no family). */
  readonly categoryTotalPct: number;
  /** Whether `categoryTotalPct` crossed `family.threshold`. */
  readonly familyExceeded: boolean;
}

export interface AttributedHotspotExtraParts extends AttributedFindingExtraParts {
  /** Runner-up hotspots, populated only for the top finding under `select: { top }`. */
  readonly alternatives: Hotspot[];
}

export interface AttributedFindingText {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly suggestion: string;
  readonly references: string[];
  readonly remediation?: FindingRemediation;
}

export interface AttributedHotspotDetectorConfig<C extends AttributedFindingCategory, M> {
  readonly id: string;
  readonly order?: number;
  readonly category: C;
  /**
   * Drives `categoryTotalPct` + `familyExceeded` (the "death by a thousand cuts"
   * aggregate). Omit for detectors that don't aggregate a family.
   */
  readonly family?: {
    readonly patterns: ReadonlyArray<{ re: RegExp; api: string }>;
    readonly normalize?: (name: string) => string;
    /** Extra family total not covered by `patterns` (e.g. zlib processChunkSync). */
    readonly extraTotal?: (context: CpuHotspotContext, cwd: string) => number;
    readonly threshold: number;
  };
  /**
   * The only per-hotspot logic: owns category check, pattern match, and threshold
   * gate. Returns the match info (consumed by the other hooks) or `undefined`.
   */
  match(hotspot: Hotspot, ctx: AttributedHotspotMatchCtx): M | undefined;
  /** `'each'` emits one finding per match; `{ top }` keeps the highest, rest become alternatives. */
  readonly select?: 'each' | { readonly top: number; readonly alternatives?: number };
  /** Skip a match whose `describe().id` was already emitted (json's two-pass dedup). */
  readonly dedupeById?: boolean;
  readonly evidenceFallback?: 'user-self';
  severity(match: M, hotspot: Hotspot, ctx: AttributedHotspotMatchCtx): BaseFinding['severity'];
  selfPct(match: M, hotspot: Hotspot): number;
  sourcePattern(match: M, hotspot: Hotspot): RegExp;
  describe(match: M, hotspot: Hotspot, ctx: AttributedHotspotMatchCtx): AttributedFindingText;
  measurements(match: M, hotspot: Hotspot, ctx: AttributedHotspotMatchCtx): FindingMeasurements;
  extra(
    match: M,
    hotspot: Hotspot,
    parts: AttributedHotspotExtraParts,
    ctx: AttributedHotspotMatchCtx,
  ): AttributedFindingExtraFor<C>;
}

/**
 * Builds a {@link KindScopedDetector} for the "hotspot with user attribution"
 * shape. The factory owns the invariant scaffolding — family aggregate, iteration,
 * emit strategy, dedup, and the spine ({@link assembleAttributedFinding}) — while
 * the config supplies only what genuinely varies: a per-hotspot `match`, plus
 * small pure functions for severity / text / measurements / extra.
 */
export function defineAttributedHotspotDetector<C extends AttributedFindingCategory, M>(
  config: AttributedHotspotDetectorConfig<C, M>,
): KindScopedDetector<'cpu'> {
  return {
    id: config.id,
    kindIds: ['cpu'],
    ...(config.order !== undefined ? { order: config.order } : {}),
    detect({ cpu }): Finding[] {
      const context: CpuHotspotContext = cpu.view.hotspotAnalysis;
      const cwd = cpu.view.bundle.target.cwd;
      const report: AttributedFindingReport = cpu.report;

      let categoryTotalPct = 0;
      if (config.family) {
        const aggregate = aggregateByPatterns(context.fullHotspots, config.family.patterns, {
          ...(config.family.normalize ? { normalize: config.family.normalize } : {}),
        });
        categoryTotalPct =
          aggregate.categoryTotalPct + (config.family.extraTotal?.(context, cwd) ?? 0);
      }
      const familyExceeded = config.family ? categoryTotalPct >= config.family.threshold : false;
      const ctx: AttributedHotspotMatchCtx = {
        context,
        cwd,
        report,
        categoryTotalPct,
        familyExceeded,
      };

      const matched: Array<{ hotspot: Hotspot; match: M }> = [];
      for (const hotspot of context.fullHotspots) {
        const match = config.match(hotspot, ctx);
        if (match === undefined) continue;
        matched.push({ hotspot, match });
      }

      const select = config.select ?? 'each';
      let emitted: Array<{ hotspot: Hotspot; match: M; alternatives: Hotspot[] }>;
      if (select === 'each') {
        emitted = matched.map((entry) => ({ ...entry, alternatives: [] }));
      } else {
        const sorted = [...matched].sort((left, right) => {
          const totalDelta = right.hotspot.totalPct - left.hotspot.totalPct;
          return totalDelta !== 0 ? totalDelta : right.hotspot.selfPct - left.hotspot.selfPct;
        });
        const alternatives = sorted
          .slice(select.top, select.top + (select.alternatives ?? 0))
          .map((entry) => entry.hotspot);
        emitted = sorted
          .slice(0, select.top)
          .map((entry, index) => ({ ...entry, alternatives: index === 0 ? alternatives : [] }));
      }

      const findings: Finding[] = [];
      const seen = new Set<string>();
      for (const { hotspot, match, alternatives } of emitted) {
        const text = config.describe(match, hotspot, ctx);
        if (config.dedupeById) {
          if (seen.has(text.id)) continue;
          seen.add(text.id);
        }
        findings.push(
          assembleAttributedFinding<C>({
            hotspot,
            context,
            cwd,
            report,
            category: config.category,
            id: text.id,
            title: text.title,
            severity: config.severity(match, hotspot, ctx),
            selfPct: config.selfPct(match, hotspot),
            sourcePattern: config.sourcePattern(match, hotspot),
            ...(config.evidenceFallback ? { evidenceFallback: config.evidenceFallback } : {}),
            measurements: config.measurements(match, hotspot, ctx),
            ...(text.remediation ? { remediation: text.remediation } : {}),
            why: text.why,
            suggestion: text.suggestion,
            references: text.references,
            buildExtra: (parts) => config.extra(match, hotspot, { ...parts, alternatives }, ctx),
          }),
        );
      }
      return findings;
    },
  };
}
