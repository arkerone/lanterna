import { LANTERNA_REPORT_SCHEMA_VERSION } from '../../report/meta.js';
import type { Finding, FindingPriority } from '../../report/types.js';
import { logger } from '../../shared/logger.js';
import {
  buildGcCorrelationWindows,
  correlateUserHotspotsWithCoverage,
} from '../model/correlations.js';
import { enrichDeopts } from '../model/deopts.js';
import { buildEventLoopReport } from '../model/event-loop-report.js';
import { buildGcReport } from '../model/gc-report.js';
import { clusterHotStacksByUserAnchor, computeHotStacks } from '../model/hot-stacks.js';
import {
  buildSummary,
  deriveDominantBlockingKind,
  deriveTopUserHotspot,
} from '../model/summary.js';
import { createAnalysisContext } from './context.js';
import type {
  AnalysisContext,
  AnalysisOptions,
  AnalysisResult,
  AnalysisSnapshot,
  FindingAnalyzer,
  SectionAnalyzer,
} from './types.js';

export interface CreateAnalysisPipelineOptions {
  sectionAnalyzers?: SectionAnalyzer[];
  findingAnalyzers?: FindingAnalyzer[];
}

/**
 * Runs a series of registered analyzers over a {@link RawCapture} to produce
 * an {@link AnalysisResult}.
 *
 * Two analyzer kinds are supported:
 * - **FindingAnalyzer** — emits {@link Finding} objects (performance issues).
 * - **SectionAnalyzer** — computes a typed value stored under a namespace key
 *   in `result.extensions`, enabling custom report sections.
 *
 * Analyzers are executed in `order` (ascending, default 0). Duplicate IDs or
 * namespaces are rejected at registration time.
 *
 * @example
 * ```ts
 * const pipeline = createAnalysisPipeline();
 * pipeline.register(myFindingAnalyzer);
 * pipeline.register(mySectionAnalyzer);
 * const result = pipeline.run(rawCapture, options);
 * ```
 */
export class AnalysisPipeline {
  private readonly sectionAnalyzers: SectionAnalyzer[];
  private readonly findingAnalyzers: FindingAnalyzer[];

  constructor({
    sectionAnalyzers = [],
    findingAnalyzers = [],
  }: CreateAnalysisPipelineOptions = {}) {
    this.sectionAnalyzers = [...sectionAnalyzers];
    this.findingAnalyzers = [...findingAnalyzers];
  }

  registerSection<TSection>(analyzer: SectionAnalyzer<TSection>): this {
    this.assertAnalyzerCanRegister(analyzer);
    this.sectionAnalyzers.push(analyzer);
    return this;
  }

  registerFinding(analyzer: FindingAnalyzer): this {
    this.assertAnalyzerCanRegister(analyzer);
    this.findingAnalyzers.push(analyzer);
    return this;
  }

  register<TSection>(analyzer: SectionAnalyzer<TSection> | FindingAnalyzer): this {
    if (analyzer.kind === 'section') {
      return this.registerSection(analyzer);
    }
    return this.registerFinding(analyzer);
  }

  run(rawCapture: AnalysisContext['rawCapture'], options: AnalysisOptions): AnalysisResult {
    const context = createAnalysisContext(rawCapture, options);
    const snapshot = createBaseAnalysisSnapshot(context);

    for (const analyzer of sortAnalyzers(this.sectionAnalyzers)) {
      snapshot.extensions[analyzer.namespace] = analyzer.run(context, snapshot);
    }

    const findings: Finding[] = [];
    for (const analyzer of sortAnalyzers(this.findingAnalyzers)) {
      try {
        findings.push(...analyzer.run(context, snapshot));
      } catch (error) {
        logger.warn({ analyzerId: analyzer.id, err: error }, 'analysis finding analyzer failed');
      }
    }

    snapshot.findings = sortFindings(findings, context.rawCapture.durationMs);
    snapshot.summary.dominantBlockingKind = deriveDominantBlockingKind(snapshot.findings);
    snapshot.summary.topUserHotspot = deriveTopUserHotspot(
      context.getHotspotAnalysis().fullHotspots,
      snapshot.eventLoop.correlatedHotspots,
      snapshot.findings,
    );

    if (Object.keys(snapshot.extensions).length === 0) {
      const { meta: _meta, extensions: _extensions, ...result } = snapshot;
      return result;
    }

    const { meta: _meta, ...result } = snapshot;
    return result;
  }

  private assertAnalyzerCanRegister(analyzer: SectionAnalyzer | FindingAnalyzer): void {
    if (analyzer.kind === 'section') {
      if (this.sectionAnalyzers.some((entry) => entry.namespace === analyzer.namespace)) {
        throw new Error(`duplicate section namespace: ${analyzer.namespace}`);
      }
      return;
    }
    if (this.findingAnalyzers.some((entry) => entry.id === analyzer.id)) {
      throw new Error(`duplicate finding analyzer id: ${analyzer.id}`);
    }
  }
}

/**
 * Creates a new {@link AnalysisPipeline} with optional pre-registered analyzers.
 *
 * Prefer this factory over `new AnalysisPipeline()` — it keeps calling code
 * independent of the class constructor signature.
 */
export function createAnalysisPipeline(
  options: CreateAnalysisPipelineOptions = {},
): AnalysisPipeline {
  return new AnalysisPipeline(options);
}

/**
 * Identity helper that returns the analyzer as-is.
 * Useful for getting TypeScript to infer the `TSection` type from a literal
 * object without needing an explicit type annotation.
 */
export function defineSectionAnalyzer<TSection>(
  analyzer: SectionAnalyzer<TSection>,
): SectionAnalyzer<TSection> {
  return analyzer;
}

/**
 * Identity helper that returns the analyzer as-is.
 * Provides a typed entry point for authoring {@link FindingAnalyzer} objects
 * with full IDE autocompletion.
 */
export function defineFindingAnalyzer(analyzer: FindingAnalyzer): FindingAnalyzer {
  return analyzer;
}

export function sortFindings(findings: Finding[], durationMs?: number): Finding[] {
  const severityWeight = { critical: 3, warning: 2, info: 1 } as const;
  return findings
    .map((finding) => ensureFindingPriority(finding, durationMs))
    .sort((left, right) => {
      const priorityDelta = (right.priority?.score ?? 0) - (left.priority?.score ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      const severityDelta = severityWeight[right.severity] - severityWeight[left.severity];
      if (severityDelta !== 0) return severityDelta;
      return right.evidence.selfPct - left.evidence.selfPct;
    });
}

function ensureFindingPriority(finding: Finding, durationMs?: number): Finding {
  if (finding.priority) return finding;
  return { ...finding, priority: computeFindingPriority(finding, durationMs) } as Finding;
}

function computeFindingPriority(finding: Finding, durationMs?: number): FindingPriority {
  const score = Math.round(computeMeasurementRatio(finding) * 100 * confidenceWeight(finding));
  const impactEstimateMs = computeImpactEstimateMs(finding, durationMs);
  return {
    score,
    ...(impactEstimateMs !== undefined ? { impactEstimateMs } : {}),
    actionConfidence: deriveActionConfidence(finding),
  };
}

function computeMeasurementRatio(finding: Finding): number {
  const measurements = finding.measurements;
  if (!measurements) return Math.max(1, finding.evidence.selfPct);

  const pairs: Array<[string, string]> = [
    ['categoryTotalPct', 'categoryTotalPct'],
    ['totalPct', 'minTotalPct'],
    ['totalPct', 'warningTotalPct'],
    ['totalPct', 'criticalTotalPct'],
    ['selfPct', 'minSelfPct'],
    ['selfPct', 'warningSelfPct'],
    ['p99LagMs', 'p99'],
    ['p99LagMs', 'p99LowConfidence'],
    ['maxLagMs', 'max'],
    ['maxLagMs', 'maxLowConfidence'],
    ['longestPauseMs', 'longestPauseTrigger'],
    ['gcRatio', 'ratioTrigger'],
    ['count', 'minCount'],
    ['correlationOverlapPct', 'strongCorrelationOverlapPct'],
  ];

  let bestRatio = 0;
  for (const [observedKey, thresholdKey] of pairs) {
    const observed = measurements.observed[observedKey];
    const threshold = measurements.thresholds[thresholdKey];
    if (observed === undefined || threshold === undefined || threshold <= 0) continue;
    bestRatio = Math.max(bestRatio, observed / threshold);
  }

  if (bestRatio > 0) return bestRatio;
  const observedValues = Object.values(measurements.observed).filter((value) => value > 0);
  return Math.max(1, ...observedValues);
}

function confidenceWeight(finding: Finding): number {
  const extra = finding.evidence.extra as Record<string, unknown> | undefined;
  const correlation = extra?.eventLoopCorrelation as { overlapPct?: number } | undefined;
  const correlationWeight =
    correlation?.overlapPct !== undefined ? Math.max(0.25, correlation.overlapPct / 100) : 1;

  if (extra?.attributionConfidence === 'high') return 1.2 * correlationWeight;
  if (extra?.attributionConfidence === 'low') return 0.85 * correlationWeight;
  if (extra?.confidence === 'high') return 1.2 * correlationWeight;
  if (extra?.confidence === 'low') return 0.85 * correlationWeight;
  return correlationWeight;
}

function deriveActionConfidence(finding: Finding): FindingPriority['actionConfidence'] {
  const extra = finding.evidence.extra as Record<string, unknown> | undefined;
  if (extra?.attributionConfidence === 'high') return 'high';
  if (extra?.confidence === 'high') return 'high';
  if (extra?.measurementBasis === 'histogram') return 'low';
  if (extra?.proofLevel === 'deopt-trace-only') return 'medium';
  if (finding.measurements) return 'medium';
  return 'low';
}

function computeImpactEstimateMs(
  finding: Finding,
  durationMs: number | undefined,
): number | undefined {
  if (durationMs === undefined) return undefined;
  const observed = finding.measurements?.observed;
  if (!observed) return undefined;
  const pct = observed.categoryTotalPct ?? observed.totalPct ?? observed.selfPct;
  if (pct === undefined) return undefined;
  return Math.round((durationMs * pct) / 100);
}

function createBaseAnalysisSnapshot(context: AnalysisContext): AnalysisSnapshot {
  const gc = buildGcReport(context.rawCapture.gcEvents);
  const gcCorrelation = correlateUserHotspotsWithCoverage(
    context.getTimedSamples(),
    context.getTree(),
    buildGcCorrelationWindows(context.rawCapture),
  );
  if (gcCorrelation.hotspots.length > 0) {
    gc.correlatedHotspots = gcCorrelation.hotspots;
  }
  if (gcCorrelation.coverage.windowCount > 0) {
    gc.correlationCoverage = gcCorrelation.coverage;
  }

  const hotStacks = computeHotStacks(context.rawCapture.cpuProfile, context.getTree());
  const hotStackClusters = clusterHotStacksByUserAnchor(hotStacks);

  const eventLoop = buildEventLoopReport(context.rawCapture);
  const eventLoopCorrelation = correlateUserHotspotsWithCoverage(
    context.getTimedSamples(),
    context.getTree(),
    eventLoop.stallIntervals,
  );
  if (eventLoopCorrelation.hotspots.length > 0) {
    eventLoop.correlatedHotspots = eventLoopCorrelation.hotspots;
  }
  if (eventLoopCorrelation.coverage.windowCount > 0) {
    eventLoop.correlationCoverage = eventLoopCorrelation.coverage;
  }
  const summary = buildSummary(context.getTree());

  return {
    meta: {
      schemaVersion: LANTERNA_REPORT_SCHEMA_VERSION,
      nodeVersion: '',
      v8Version: '',
      platform: '',
      arch: '',
      pid: 0,
      startedAt: '',
      durationMs: context.rawCapture.durationMs,
      sampleIntervalMicros: context.options.sampleIntervalMicros,
      totalSamples: context.getTree().totalSamples,
      cwd: '',
      command: context.options.command,
      lanternaVersion: '',
      mode: context.options.mode ?? 'spawn',
      deep: context.options.deep,
      captureIntegrity: context.rawCapture.captureIntegrity,
    },
    summary,
    hotspots: context.getHotspotAnalysis().publicHotspots,
    hotStacks,
    hotStackClusters: hotStackClusters.length > 0 ? hotStackClusters : undefined,
    gc,
    eventLoop,
    deopts: enrichDeopts(context.rawCapture.deopts),
    findings: [],
    extensions: {},
  };
}

function sortAnalyzers<TAnalyzer extends { order?: number }>(analyzers: TAnalyzer[]): TAnalyzer[] {
  return [...analyzers].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}
