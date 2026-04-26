import type {
  BaseFinding,
  Finding,
  KindScopedDetector,
  MemorySeriesStats,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';

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
      const finding = buildGrowthFinding('rss', rss, durationMs, sampleCount);
      if (finding) findings.push(finding);
    }
    if (heapUsed) {
      const finding = buildGrowthFinding('heapUsed', heapUsed, durationMs, sampleCount);
      if (finding) findings.push(finding);
    }
    return findings;
  },
};

function buildGrowthFinding(
  metric: 'rss' | 'heapUsed',
  stats: MemorySeriesStats,
  durationMs: number,
  sampleCount: number,
): BaseFinding<string, Record<string, unknown>> | null {
  const slopeMBPerSec = stats.slopeBytesPerSec / BYTES_PER_MB;
  const thresholds = DETECTOR_THRESHOLDS.memoryGrowth;
  const warn =
    metric === 'rss' ? thresholds.rssGrowthWarnMBPerSec : thresholds.heapGrowthWarnMBPerSec;
  const critical = thresholds.rssGrowthCriticalMBPerSec;
  if (slopeMBPerSec < warn) return null;

  const severity: BaseFinding['severity'] =
    metric === 'rss' && slopeMBPerSec >= critical ? 'critical' : 'warning';
  const deltaMB = (stats.endBytes - stats.startBytes) / BYTES_PER_MB;
  const label = metric === 'rss' ? 'Resident set size' : 'V8 heap (heapUsed)';

  return {
    id: `memory-growth:${metric}`,
    profileKind: 'memory',
    severity,
    category: 'memory-growth',
    title: `${label} grew ${formatRate(slopeMBPerSec)} during the capture`,
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
        ? 'Take heap snapshots at start vs end (Chrome DevTools or `--inspect`), compare retained-size diffs, and look for unbounded caches/Maps, dangling listeners, or accumulating closures. Correlate with the top hot allocators in `profiles.memory.hotAllocators`.'
        : 'V8 heap is growing — review long-lived collections (Map, Set, arrays), event listeners, and Promise chains that retain references. Run with `--expose-gc` and force a GC near peak to confirm objects are reachable, not just deferred.',
    references: [
      'https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot',
      'https://nodejs.org/api/process.html#processmemoryusage',
    ],
  };
}

function formatRate(mbPerSec: number): string {
  if (mbPerSec >= 1) return `${mbPerSec.toFixed(2)} MB/s`;
  return `${(mbPerSec * 1024).toFixed(1)} KB/s`;
}
