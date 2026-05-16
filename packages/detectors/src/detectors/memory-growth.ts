import type {
  BaseFinding,
  Finding,
  KindScopedDetector,
  MemoryHotAllocator,
  MemorySeriesStats,
  MemorySummary,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import { correlatedAllocatorFromMemory } from './memory-evidence.js';

const BYTES_PER_MB = 1024 * 1024;

/**
 * Fires when RSS or heapUsed shows sustained linear growth across the capture
 * window — a classic memory-leak signature. Uses the linear regression slope
 * already computed by the memory analysis contributor.
 */
export const memoryGrowthDetector: KindScopedDetector<'memory'> = {
  id: 'memory-growth',
  kindIds: ['memory'],
  detect({ memory }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.memoryGrowth;
    const sampleCount = memory.view.data.memoryUsage.samples.length;
    if (sampleCount < thresholds.minSamples) return [];
    const durationMs = memory.view.bundle.durationMs;
    if (durationMs < thresholds.minDurationMs) return [];

    const findings: Finding[] = [];
    const rss = memory.view.series.rss;
    const heapUsed = memory.view.series.heapUsed;

    if (rss) {
      const finding = hasRssRetentionCorroboration(memory.view.series)
        ? buildGrowthFinding(
            'rss',
            rss,
            durationMs,
            sampleCount,
            memory.report.summary,
            memory.report.hotAllocators,
          )
        : null;
      if (finding) findings.push(finding);
    }
    if (heapUsed) {
      const finding = buildGrowthFinding(
        'heapUsed',
        heapUsed,
        durationMs,
        sampleCount,
        memory.report.summary,
        memory.report.hotAllocators,
      );
      if (finding) findings.push(finding);
    }
    return findings;
  },
};

function hasRssRetentionCorroboration(series: {
  rss?: MemorySeriesStats;
  heapUsed?: MemorySeriesStats;
  external?: MemorySeriesStats;
  arrayBuffers?: MemorySeriesStats;
}): boolean {
  const thresholds = DETECTOR_THRESHOLDS.memoryGrowth;
  return (
    toMBPerSec(series.heapUsed) >= thresholds.heapGrowthWarnMBPerSec ||
    toMBPerSec(series.external) >= thresholds.rssGrowthWarnMBPerSec ||
    toMBPerSec(series.arrayBuffers) >= thresholds.rssGrowthWarnMBPerSec
  );
}

function buildGrowthFinding(
  metric: 'rss' | 'heapUsed',
  stats: MemorySeriesStats,
  durationMs: number,
  sampleCount: number,
  summary: MemorySummary,
  hotAllocators: readonly MemoryHotAllocator[],
): BaseFinding<string, Record<string, unknown>> | null {
  const slopeMBPerSec = toMBPerSec(stats);
  const thresholds = DETECTOR_THRESHOLDS.memoryGrowth;
  const warn =
    metric === 'rss' ? thresholds.rssGrowthWarnMBPerSec : thresholds.heapGrowthWarnMBPerSec;
  const critical = thresholds.rssGrowthCriticalMBPerSec;
  if (slopeMBPerSec < warn) return null;

  const severity: BaseFinding['severity'] =
    metric === 'rss' && slopeMBPerSec >= critical ? 'critical' : 'warning';
  const deltaMB = (stats.endBytes - stats.startBytes) / BYTES_PER_MB;
  const label = metric === 'rss' ? 'Resident set size' : 'V8 heap (heapUsed)';
  const allocator = correlatedAllocatorFromMemory(summary, hotAllocators);

  return {
    id: `memory-growth:${metric}`,
    profileKind: 'memory',
    severity,
    category: 'memory-growth',
    title: `${label} grew ${formatRate(slopeMBPerSec)} during the capture`,
    confidence: sampleCount >= thresholds.minSamples * 2 ? 'high' : 'medium',
    proofLevel: 'heuristic',
    evidence: {
      file: 'process.memoryUsage',
      line: 0,
      function: metric,
      selfPct: 0,
      extra: {
        metric,
        slopeMBPerSec,
        startMB: stats.startBytes / BYTES_PER_MB,
        endMB: stats.endBytes / BYTES_PER_MB,
        peakMB: stats.maxBytes / BYTES_PER_MB,
        deltaMB,
        sampleCount,
        durationMs,
        ...(allocator ? { correlatedAllocator: allocator } : {}),
      },
    },
    measurements: {
      observed: {
        slopeMBPerSec,
        deltaMB,
        durationMs,
      },
      thresholds: {
        warnMBPerSec: warn,
        criticalMBPerSec: critical,
        minDurationMs: thresholds.minDurationMs,
        minSamples: thresholds.minSamples,
      },
    },
    why: `${label} climbed at ${formatRate(slopeMBPerSec)} (linear fit) over ${(durationMs / 1000).toFixed(1)}s. Sustained linear growth is a leak signature: objects are retained instead of being released between requests.`,
    suggestion:
      metric === 'rss'
        ? 'Rerun with `--kind memory --heap-snapshot-analysis` so Lanterna can compare start/end retained growth and expose `profiles.memory.heapSnapshotAnalysis.retainerPaths`. Correlate retainer clues with the top hot allocators in `profiles.memory.hotAllocators`; use Chrome DevTools heap snapshots only if Lanterna still lacks retention signal.'
        : 'V8 heap is growing — review long-lived collections (Map, Set, arrays), event listeners, and Promise chains that retain references. Run with `--expose-gc` and force a GC near peak to confirm objects are reachable, not just deferred.',
    references: [
      'https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot',
      'https://nodejs.org/api/process.html#processmemoryusage',
    ],
  };
}

function toMBPerSec(stats: MemorySeriesStats | undefined): number {
  return (stats?.slopeBytesPerSec ?? 0) / BYTES_PER_MB;
}

function formatRate(mbPerSec: number): string {
  if (mbPerSec >= 1) return `${mbPerSec.toFixed(2)} MB/s`;
  return `${(mbPerSec * 1024).toFixed(1)} KB/s`;
}
