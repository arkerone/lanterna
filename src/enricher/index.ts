import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RawCapture } from '../collector/source.js';
import type {
  EventLoopReport,
  FrameCategory,
  GcReport,
  LanternaReport,
  MeasurementBasis,
  MeasurementConfidence,
  ReportSummary,
} from '../report/types.js';
import { enrichCpuTree, aggregateHotspots } from './hotspots.js';
import { computeHotStacks } from './hot-stacks.js';
import { enrichDeopts } from './deopts.js';
import { runFindings } from './findings/index.js';
import {
  buildGcCorrelationWindows,
  buildTimedSamples,
  correlateUserHotspots,
  type TimeWindow,
} from './correlation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface EnrichOptions {
  sampleIntervalMicros: number;
  deep: boolean;
  command: string[];
}

export function enrich(raw: RawCapture, opts: EnrichOptions): LanternaReport {
  const tree = enrichCpuTree(raw.cpuProfile, raw.target.cwd, opts.sampleIntervalMicros);
  const hotspotAnalysis = aggregateHotspots(raw.cpuProfile, tree);
  const hotspots = hotspotAnalysis.publicHotspots;
  const hotStacks = computeHotStacks(raw.cpuProfile, tree);
  const timedSamples = buildTimedSamples(raw, opts.sampleIntervalMicros);

  const summary = buildSummary(tree);
  const gc = buildGcReport(raw.gcEvents);
  const eventLoop = buildEventLoopReport(raw);
  const deopts = enrichDeopts(raw.deopts);

  const eventLoopCorrelatedHotspots = correlateUserHotspots(timedSamples, tree, eventLoop.stallIntervals);
  if (eventLoopCorrelatedHotspots.length > 0) {
    eventLoop.correlatedHotspots = eventLoopCorrelatedHotspots;
  }

  const gcCorrelatedHotspots = correlateUserHotspots(timedSamples, tree, buildGcCorrelationWindows(raw));
  if (gcCorrelatedHotspots.length > 0) {
    gc.correlatedHotspots = gcCorrelatedHotspots;
  }

  const report: LanternaReport = {
    meta: {
      nodeVersion: raw.target.nodeVersion,
      v8Version: raw.target.v8Version,
      platform: raw.target.platform,
      arch: raw.target.arch,
      pid: raw.target.pid,
      startedAt: new Date(raw.startedAtEpoch).toISOString(),
      durationMs: raw.durationMs,
      sampleIntervalMicros: opts.sampleIntervalMicros,
      totalSamples: tree.totalSamples,
      cwd: raw.target.cwd,
      command: opts.command,
      lanternaVersion: readVersion(),
      mode: 'spawn',
      deep: opts.deep,
      captureIntegrity: raw.captureIntegrity,
    },
    summary,
    hotspots,
    hotStacks,
    gc,
    eventLoop,
    deopts,
    findings: [],
  };

  report.findings = runFindings(report, {
    fullHotspots: hotspotAnalysis.fullHotspots,
    hotspotById: hotspotAnalysis.hotspotById,
    userAttributionById: hotspotAnalysis.userAttributionById,
  });
  report.summary.dominantBlockingKind = deriveDominantBlockingKind(report.findings);
  return report;
}

function buildSummary(tree: ReturnType<typeof enrichCpuTree>): ReportSummary {
  const totals: Record<FrameCategory, number> = {
    user: 0,
    node_modules: 0,
    'node:builtin': 0,
    native: 0,
    gc: 0,
    program: 0,
    idle: 0,
    unknown: 0,
  };
  for (const n of tree.nodes.values()) totals[n.category] += n.hitCount;

  const total = Math.max(1, tree.totalSamples);
  const idle = totals.idle + totals.program;
  const onCpu = total - idle;
  const onCpuDen = Math.max(1, onCpu);

  const cats: FrameCategory[] = ['user', 'node_modules', 'node:builtin', 'native', 'gc'];
  let top: FrameCategory = 'user';
  let topVal = -1;
  for (const c of cats) {
    if (totals[c] > topVal) {
      topVal = totals[c];
      top = c;
    }
  }

  return {
    totalCpuMs: onCpu * tree.sampleIntervalMs,
    onCpuRatio: onCpu / total,
    userCodeRatio: totals.user / onCpuDen,
    nodeModulesRatio: totals.node_modules / onCpuDen,
    builtinRatio: totals['node:builtin'] / onCpuDen,
    nativeRatio: totals.native / onCpuDen,
    gcRatio: totals.gc / onCpuDen,
    idleRatio: idle / total,
    topCategory: top,
    dominantBlockingKind: null,
  };
}

function buildGcReport(events: RawCapture['gcEvents']): GcReport {
  let totalPause = 0;
  let longest = 0;
  const count = { scavenge: 0, markSweep: 0, incremental: 0, other: 0 };
  const pausesOver10ms: GcReport['pausesOver10ms'] = [];
  for (const e of events) {
    totalPause += e.durationMs;
    if (e.durationMs > longest) longest = e.durationMs;
    const k = e.kind as keyof typeof count;
    if (k in count) count[k] += 1;
    else count.other += 1;
    if (e.durationMs >= 10) {
      pausesOver10ms.push({ atMs: e.atMs, kind: e.kind, durationMs: e.durationMs });
    }
  }
  return { totalPauseMs: totalPause, count, longestPauseMs: longest, pausesOver10ms };
}

function buildEventLoopReport(raw: RawCapture): EventLoopReport {
  const hasHeartbeats = raw.captureIntegrity.eventLoopTimed && raw.eventLoopSamples.length > 0;
  const histogram = raw.eventLoopHistogram ? {
    maxLagMs: raw.eventLoopHistogram.maxMs,
    p99LagMs: raw.eventLoopHistogram.p99Ms,
    p50LagMs: raw.eventLoopHistogram.p50Ms,
    meanLagMs: raw.eventLoopHistogram.meanMs,
  } : undefined;
  const measurementBasis = deriveMeasurementBasis(hasHeartbeats, Boolean(histogram));
  const confidence = deriveMeasurementConfidence(measurementBasis);

  if (measurementBasis === 'none') {
    return {
      maxLagMs: 0,
      p99LagMs: 0,
      p50LagMs: 0,
      meanLagMs: 0,
      sampleCount: 0,
      stallIntervals: [],
      available: false,
      measurementBasis,
      confidence,
    };
  }
  const heartbeatSummary = hasHeartbeats ? summarizeHeartbeatLag(raw) : undefined;
  const metrics = histogram ?? heartbeatSummary ?? {
    maxLagMs: 0,
    p99LagMs: 0,
    p50LagMs: 0,
    meanLagMs: 0,
  };
  return {
    maxLagMs: metrics.maxLagMs,
    p99LagMs: metrics.p99LagMs,
    p50LagMs: metrics.p50LagMs,
    meanLagMs: metrics.meanLagMs,
    sampleCount: raw.eventLoopSamples.length,
    stallIntervals: hasHeartbeats ? deriveStallIntervals(raw, raw.eventLoopResolutionMs ?? 20) : [],
    available: true,
    measurementBasis,
    confidence,
    histogram,
  };
}

function deriveStallIntervals(raw: RawCapture, resolutionMs: number): EventLoopReport['stallIntervals'] {
  const rawIntervals: EventLoopReport['stallIntervals'] = [];

  for (const sample of raw.eventLoopSamples) {
    if (sample.lagMs < 200) continue;
    rawIntervals.push({
      startMs: Math.max(0, sample.atMs - sample.lagMs),
      endMs: sample.atMs,
      maxLagMs: sample.lagMs,
    });
  }

  const trailingLagMs = inferTrailingLag(raw);
  if (trailingLagMs >= 200) {
    const lastSampleAtMs = raw.eventLoopSamples[raw.eventLoopSamples.length - 1]?.atMs ?? 0;
    rawIntervals.push({
      startMs: Math.max(0, lastSampleAtMs + resolutionMs),
      endMs: raw.durationMs,
      maxLagMs: trailingLagMs,
    });
  }

  return mergeIntervals(rawIntervals);
}

function inferTrailingLag(raw: RawCapture): number {
  const lastSampleAtMs = raw.eventLoopSamples[raw.eventLoopSamples.length - 1]?.atMs;
  const resolutionMs = raw.eventLoopResolutionMs ?? 20;
  if (lastSampleAtMs === undefined) return 0;
  return Math.max(0, raw.durationMs - lastSampleAtMs - resolutionMs);
}

function mergeIntervals(intervals: EventLoopReport['stallIntervals']): EventLoopReport['stallIntervals'] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: EventLoopReport['stallIntervals'] = [];

  for (const interval of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || interval.startMs > prev.endMs + 1) {
      merged.push({ ...interval });
      continue;
    }
    prev.endMs = Math.max(prev.endMs, interval.endMs);
    prev.maxLagMs = Math.max(prev.maxLagMs, interval.maxLagMs);
  }

  return merged;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const idx = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * q) - 1));
  return values[idx] ?? 0;
}

function summarizeHeartbeatLag(raw: RawCapture): {
  maxLagMs: number;
  p99LagMs: number;
  p50LagMs: number;
  meanLagMs: number;
} | undefined {
  const inferredFinalLagMs = inferTrailingLag(raw);
  const lagValues = raw.eventLoopSamples.map((sample) => sample.lagMs);
  if (inferredFinalLagMs > 0) lagValues.push(inferredFinalLagMs);
  lagValues.sort((a, b) => a - b);
  if (lagValues.length === 0) return undefined;
  return {
    maxLagMs: lagValues[lagValues.length - 1] ?? 0,
    p99LagMs: percentile(lagValues, 0.99),
    p50LagMs: percentile(lagValues, 0.5),
    meanLagMs: lagValues.reduce((sum, value) => sum + value, 0) / lagValues.length,
  };
}

function deriveMeasurementBasis(
  hasHeartbeats: boolean,
  hasHistogram: boolean,
): MeasurementBasis {
  if (hasHeartbeats && hasHistogram) return 'both';
  if (hasHeartbeats) return 'heartbeats';
  if (hasHistogram) return 'histogram';
  return 'none';
}

function deriveMeasurementConfidence(basis: MeasurementBasis): MeasurementConfidence {
  if (basis === 'none') return 'none';
  if (basis === 'histogram') return 'low';
  return 'high';
}

function deriveDominantBlockingKind(
  findings: LanternaReport['findings'],
): ReportSummary['dominantBlockingKind'] {
  if (findings.some((finding) => finding.category === 'sync-crypto')) return 'sync-crypto';
  if (findings.some((finding) => finding.category === 'blocking-io')) return 'blocking-io';
  return null;
}

let cachedVersion: string | null = null;
function readVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
    cachedVersion = pkg.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion!;
}
