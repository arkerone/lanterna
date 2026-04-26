import { captureDiagnosticMessage, recordCaptureDiagnostic } from '../../capture/core/session.js';
import type { CaptureBundle } from '../../capture/core/types.js';
import type {
  CaptureKindDataMap,
  KindAnalysisContext as KindCtx,
  KindViews,
  ProfileKind,
} from '../../kinds/core/types.js';
import { LANTERNA_REPORT_SCHEMA_VERSION } from '../../report/meta.js';
import type { Finding, FindingPriority } from '../../report/types.js';
import { logger } from '../../shared/logger.js';
import { createAnalysisContext } from './context.js';
import type {
  AnalysisOptions,
  AnalysisResult,
  AnalysisSnapshot,
  FindingAnalyzer,
  SectionAnalyzer,
} from './types.js';

export interface CreateAnalysisPipelineOptions {
  sectionAnalyzers?: SectionAnalyzer[];
  findingAnalyzers?: FindingAnalyzer[];
  /**
   * Profile kinds whose {@link KindAnalysisContributor} will run before any
   * section/finding analyzer. Contributors populate `profiles.<key>` and
   * register typed views on the context.
   */
  kinds?: ProfileKind[];
}

/**
 * Runs kind contributors → section analyzers → finding analyzers over a
 * {@link CaptureBundle} and produces an {@link AnalysisResult}.
 */
export class AnalysisPipeline {
  private readonly sectionAnalyzers: SectionAnalyzer[] = [];
  private readonly findingAnalyzers: FindingAnalyzer[] = [];
  private readonly kinds: ProfileKind[] = [];

  constructor(options: CreateAnalysisPipelineOptions = {}) {
    for (const analyzer of options.sectionAnalyzers ?? []) this.registerSection(analyzer);
    for (const analyzer of options.findingAnalyzers ?? []) this.registerFinding(analyzer);
    for (const kind of options.kinds ?? []) this.registerKind(kind);
  }

  registerSection<TSection>(analyzer: SectionAnalyzer<TSection>): this {
    if (this.sectionAnalyzers.some((entry) => entry.namespace === analyzer.namespace)) {
      throw new Error(`duplicate section namespace: ${analyzer.namespace}`);
    }
    this.sectionAnalyzers.push(analyzer);
    return this;
  }

  registerFinding(analyzer: FindingAnalyzer): this {
    if (this.findingAnalyzers.some((entry) => entry.id === analyzer.id)) {
      throw new Error(`duplicate finding analyzer id: ${analyzer.id}`);
    }
    this.findingAnalyzers.push(analyzer);
    return this;
  }

  registerKind(kind: ProfileKind): this {
    if (this.kinds.some((entry) => entry.id === kind.id)) {
      throw new Error(`duplicate profile kind id: ${kind.id}`);
    }
    const existingKind = this.kinds.find(
      (entry) => entry.reportSectionKey === kind.reportSectionKey,
    );
    if (existingKind) {
      throw new Error(
        `duplicate profile kind report section key: ${kind.reportSectionKey} (${existingKind.id}, ${kind.id})`,
      );
    }
    this.kinds.push(kind);
    return this;
  }

  register<TSection>(analyzer: SectionAnalyzer<TSection> | FindingAnalyzer): this {
    if (analyzer.kind === 'section') return this.registerSection(analyzer);
    return this.registerFinding(analyzer);
  }

  run(bundle: CaptureBundle, options: AnalysisOptions): AnalysisResult {
    const context = createAnalysisContext(bundle, options, this.kinds);
    const snapshot: AnalysisSnapshot = {
      meta: buildStubMeta(bundle, options, this.kinds),
      profiles: {},
      findings: [],
      extensions: {},
    };

    // Phase 1 — kind contributors populate `profiles.<kindKey>` and views.
    for (const kind of this.kinds) {
      const dataKey = kind.id as keyof CaptureKindDataMap;
      const data = bundle.kinds?.[dataKey];
      if (data === undefined) continue;
      try {
        const contributor = kind.createAnalysisContributor();
        const kindCtx: KindCtx<unknown> = {
          data,
          bundle,
          analysis: context,
          options,
          sectionKey: kind.reportSectionKey,
          writeSection: (section) => {
            (snapshot.profiles as Record<string, unknown>)[kind.reportSectionKey] = section;
          },
          setContextView: (view) => {
            context.setView(kind.id as keyof KindViews, view as KindViews[keyof KindViews]);
          },
        };
        contributor.analyze(kindCtx);
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind analysis contributor failed');
        recordCaptureDiagnostic(bundle.captureIntegrity, {
          stage: 'analysis-contributor',
          kindId: kind.id,
          message: captureDiagnosticMessage(error),
        });
      }
    }

    // Phase 2 — free-form section analyzers write under `snapshot.extensions`.
    for (const analyzer of sortAnalyzers(this.sectionAnalyzers)) {
      try {
        snapshot.extensions[analyzer.namespace] = analyzer.run(context, snapshot);
      } catch (error) {
        logger.warn({ analyzerId: analyzer.id, err: error }, 'analysis section analyzer failed');
        recordCaptureDiagnostic(bundle.captureIntegrity, {
          stage: 'section-analyzer',
          analyzerId: analyzer.id,
          message: captureDiagnosticMessage(error),
        });
      }
    }

    // Phase 3 — finding analyzers.
    const findings: Finding[] = [];
    for (const analyzer of sortAnalyzers(this.findingAnalyzers)) {
      try {
        findings.push(...analyzer.run(context, snapshot));
      } catch (error) {
        logger.warn({ analyzerId: analyzer.id, err: error }, 'analysis finding analyzer failed');
        recordCaptureDiagnostic(bundle.captureIntegrity, {
          stage: 'finding-analyzer',
          analyzerId: analyzer.id,
          message: captureDiagnosticMessage(error),
        });
      }
    }

    snapshot.findings = sortFindings(findings, bundle.durationMs);

    // Phase 4 — let each kind finalize based on findings.
    for (const kind of this.kinds) {
      if (!kind.finalize) continue;
      const dataKey = kind.id as keyof CaptureKindDataMap;
      const data = bundle.kinds?.[dataKey];
      if (data === undefined) continue;
      try {
        kind.finalize({
          data,
          snapshot: { profiles: snapshot.profiles, findings: snapshot.findings },
        });
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind finalize hook failed');
        recordCaptureDiagnostic(bundle.captureIntegrity, {
          stage: 'finalize',
          kindId: kind.id,
          message: captureDiagnosticMessage(error),
        });
      }
    }

    const result: AnalysisResult = {
      profiles: snapshot.profiles,
      findings: snapshot.findings,
    };
    if (Object.keys(snapshot.extensions).length > 0) {
      result.extensions = snapshot.extensions;
    }
    return result;
  }
}

export function createAnalysisPipeline(
  options: CreateAnalysisPipelineOptions = {},
): AnalysisPipeline {
  return new AnalysisPipeline(options);
}

export function defineSectionAnalyzer<TSection>(
  analyzer: SectionAnalyzer<TSection>,
): SectionAnalyzer<TSection> {
  return analyzer;
}

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
    ['slopeMBPerSec', 'warnMBPerSec'],
    ['ratio', 'warnRatio'],
    ['externalMeanMB', 'minExternalMeanMB'],
    ['allocTotalPct', 'minAllocTotalPct'],
    ['combinedPct', 'criticalCombinedPct'],
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

function buildStubMeta(
  bundle: CaptureBundle,
  options: AnalysisOptions,
  kinds: ReadonlyArray<ProfileKind>,
): AnalysisSnapshot['meta'] {
  const kindsMeta: Record<string, unknown> = {};
  const kindsIntegrity: Record<string, unknown> = { ...bundle.captureIntegrity.kinds };
  const capturedKinds: string[] = [];
  for (const kind of kinds) {
    const data = bundle.kinds?.[kind.id as keyof CaptureKindDataMap];
    if (data === undefined) continue;
    capturedKinds.push(kind.id);
    if (kind.contributeMeta) kindsMeta[kind.id] = kind.contributeMeta(data);
    if (kind.contributeIntegrity) kindsIntegrity[kind.id] = kind.contributeIntegrity(data);
  }
  return {
    schemaVersion: LANTERNA_REPORT_SCHEMA_VERSION,
    nodeVersion: '',
    v8Version: '',
    platform: '',
    arch: '',
    pid: 0,
    startedAt: '',
    durationMs: bundle.durationMs,
    cwd: '',
    command: options.command,
    lanternaVersion: '',
    mode: options.mode ?? 'spawn',
    profileKinds: capturedKinds,
    kinds: kindsMeta,
    captureIntegrity: { ...bundle.captureIntegrity, kinds: kindsIntegrity },
  };
}

function sortAnalyzers<TAnalyzer extends { order?: number }>(analyzers: TAnalyzer[]): TAnalyzer[] {
  return [...analyzers].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}
