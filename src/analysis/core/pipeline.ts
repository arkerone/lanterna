import type { Finding } from '../../report/types.js';
import { buildGcCorrelationWindows, correlateUserHotspots } from '../model/correlations.js';
import { enrichDeopts } from '../model/deopts.js';
import { buildEventLoopReport } from '../model/event-loop-report.js';
import { buildGcReport } from '../model/gc-report.js';
import { computeHotStacks } from '../model/hot-stacks.js';
import { buildSummary, deriveDominantBlockingKind } from '../model/summary.js';
import { logger } from '../../shared/logger.js';
import { createAnalysisContext } from './context.js';
import { createBuiltInFindingAnalyzers } from '../detectors/index.js';
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

export class AnalysisPipeline {
  private readonly sectionAnalyzers: SectionAnalyzer[];
  private readonly findingAnalyzers: FindingAnalyzer[];

  constructor({
    sectionAnalyzers = [],
    findingAnalyzers = createBuiltInFindingAnalyzers(),
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

    snapshot.findings = sortFindings(findings);
    snapshot.summary.dominantBlockingKind = deriveDominantBlockingKind(snapshot.findings);

    if (Object.keys(snapshot.extensions).length === 0) {
      const { meta: _meta, extensions: _extensions, ...result } = snapshot;
      return result;
    }

    const { meta: _meta, ...result } = snapshot;
    return result;
  }

  private assertAnalyzerCanRegister(
    analyzer: SectionAnalyzer | FindingAnalyzer,
  ): void {
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

export function createAnalysisPipeline(
  options: CreateAnalysisPipelineOptions = {},
): AnalysisPipeline {
  return new AnalysisPipeline(options);
}

export function createDefaultAnalysisPipeline(): AnalysisPipeline {
  return createAnalysisPipeline();
}

export function defineSectionAnalyzer<TSection>(
  analyzer: SectionAnalyzer<TSection>,
): SectionAnalyzer<TSection> {
  return analyzer;
}

export function defineFindingAnalyzer(
  analyzer: FindingAnalyzer,
): FindingAnalyzer {
  return analyzer;
}

export function sortFindings(findings: Finding[]): Finding[] {
  const severityWeight = { critical: 3, warning: 2, info: 1 } as const;
  return [...findings].sort((left, right) => {
    const severityDelta = severityWeight[right.severity] - severityWeight[left.severity];
    if (severityDelta !== 0) return severityDelta;
    return right.evidence.selfPct - left.evidence.selfPct;
  });
}

function createBaseAnalysisSnapshot(context: AnalysisContext): AnalysisSnapshot {
  const gc = buildGcReport(context.rawCapture.gcEvents);
  const gcCorrelatedHotspots = correlateUserHotspots(
    context.getTimedSamples(),
    context.getTree(),
    buildGcCorrelationWindows(context.rawCapture),
  );
  if (gcCorrelatedHotspots.length > 0) {
    gc.correlatedHotspots = gcCorrelatedHotspots;
  }

  const eventLoop = buildEventLoopReport(context.rawCapture);
  const eventLoopCorrelatedHotspots = correlateUserHotspots(
    context.getTimedSamples(),
    context.getTree(),
    eventLoop.stallIntervals,
  );
  if (eventLoopCorrelatedHotspots.length > 0) {
    eventLoop.correlatedHotspots = eventLoopCorrelatedHotspots;
  }

  return {
    meta: {
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
    summary: buildSummary(context.getTree()),
    hotspots: context.getHotspotAnalysis().publicHotspots,
    hotStacks: computeHotStacks(context.rawCapture.cpuProfile, context.getTree()),
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
