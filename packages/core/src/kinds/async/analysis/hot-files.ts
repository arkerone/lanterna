import type {
  AsyncCpuAttribution,
  AsyncHotFile,
  AsyncOperationKindReport,
  AsyncProfileQuality,
  AsyncStackFrameReport,
  ProfileConfidence,
} from '../../../report/types.js';
import type { AsyncChainNode, AsyncOperationRecord } from '../types.js';
import type { AsyncFrameReporter } from './frames.js';
import { effectiveDuration } from './top-operations.js';

const MAX_HOT_FILES = 25;
const MAX_HOT_FILE_SAMPLE_IDS = 10;

export function buildHotFiles(args: {
  records: AsyncOperationRecord[];
  captureDurationMs: number;
  chainNodes: Map<number, AsyncChainNode>;
  rootByAsyncId: Map<number, number>;
  cpuAttribution: AsyncCpuAttribution;
  quality: AsyncProfileQuality;
  frameReporter: AsyncFrameReporter;
}): AsyncHotFile[] {
  const {
    records,
    captureDurationMs,
    chainNodes,
    rootByAsyncId,
    cpuAttribution,
    quality,
    frameReporter,
  } = args;
  interface HotFileAggregate {
    file: string;
    operationCount: number;
    totalDurationMs: number;
    orphanCount: number;
    maxOrphanAgeMs: number;
    maxChainDepth: number;
    cpuPct: number;
    runMs: number;
    kindBreakdown: Partial<Record<AsyncOperationKindReport, number>>;
    sampleAsyncIds: number[];
    frames: Map<string, { frame: AsyncStackFrameReport; count: number; durationMs: number }>;
  }
  const byFile = new Map<string, HotFileAggregate>();
  const cpuPctByFile = new Map<string, number>();
  for (const entry of cpuAttribution.topChains) {
    if (!entry.rootFrame) continue;
    const file = frameReporter.normalizeFrameFile(entry.rootFrame.file);
    cpuPctByFile.set(file, (cpuPctByFile.get(file) ?? 0) + entry.cpuPct);
  }

  for (const rec of records) {
    const frame = rec.initStack[0];
    if (!frame) continue;
    const file = frameReporter.normalizeFrameFile(frame.file);
    const durationMs = effectiveDuration(rec, captureDurationMs);
    const ageMs = rec.orphan ? Math.max(0, captureDurationMs - rec.initAtMs) : 0;
    const aggregate = byFile.get(file) ?? {
      file,
      operationCount: 0,
      totalDurationMs: 0,
      orphanCount: 0,
      maxOrphanAgeMs: 0,
      maxChainDepth: 0,
      cpuPct: 0,
      runMs: 0,
      kindBreakdown: {},
      sampleAsyncIds: [],
      frames: new Map<
        string,
        { frame: AsyncStackFrameReport; count: number; durationMs: number }
      >(),
    };
    aggregate.operationCount += 1;
    aggregate.totalDurationMs += durationMs;
    aggregate.orphanCount += rec.orphan ? 1 : 0;
    aggregate.maxOrphanAgeMs = Math.max(aggregate.maxOrphanAgeMs, ageMs);
    aggregate.maxChainDepth = Math.max(
      aggregate.maxChainDepth,
      chainNodes.get(rec.asyncId)?.depth ?? 0,
    );
    aggregate.runMs += rec.runMs;
    aggregate.kindBreakdown[rec.kind] = (aggregate.kindBreakdown[rec.kind] ?? 0) + 1;
    if (aggregate.sampleAsyncIds.length < MAX_HOT_FILE_SAMPLE_IDS) {
      aggregate.sampleAsyncIds.push(rec.asyncId);
    }
    const reportFrame = frameReporter.toReportFrame(frame);
    const frameKey = `${reportFrame.file}:${reportFrame.line}:${reportFrame.function}`;
    const frameAggregate = aggregate.frames.get(frameKey);
    if (frameAggregate) {
      frameAggregate.count += 1;
      frameAggregate.durationMs += durationMs;
    } else {
      aggregate.frames.set(frameKey, { frame: reportFrame, count: 1, durationMs });
    }
    byFile.set(file, aggregate);

    const rootId = rootByAsyncId.get(rec.asyncId);
    const rootFrame = rootId
      ? records.find((candidate) => candidate.asyncId === rootId)?.initStack[0]
      : undefined;
    if (rootFrame && frameReporter.normalizeFrameFile(rootFrame.file) !== file) {
      cpuPctByFile.set(file, cpuPctByFile.get(file) ?? 0);
    }
  }

  const hotFiles: AsyncHotFile[] = [];
  for (const aggregate of byFile.values()) {
    aggregate.cpuPct = cpuPctByFile.get(aggregate.file) ?? 0;
    const primary = [...aggregate.frames.values()].sort(
      (a, b) => b.durationMs - a.durationMs || b.count - a.count || a.frame.line - b.frame.line,
    )[0];
    if (!primary) continue;
    const score =
      aggregate.totalDurationMs +
      aggregate.runMs +
      aggregate.orphanCount * 100 +
      aggregate.maxChainDepth * 10 +
      aggregate.cpuPct * 5;
    const userCaller = frameReporter.userCallerFromAsyncFrame(primary.frame, {
      profilePct: aggregate.cpuPct,
      supportPct: 100,
      confidence: confidenceForHotFile(quality, aggregate.operationCount),
      basis: 'async-stack',
    });
    hotFiles.push({
      file: aggregate.file,
      score,
      confidence: confidenceForHotFile(quality, aggregate.operationCount),
      primaryFrame: primary.frame,
      operationCount: aggregate.operationCount,
      totalDurationMs: aggregate.totalDurationMs,
      orphanCount: aggregate.orphanCount,
      maxOrphanAgeMs: aggregate.maxOrphanAgeMs,
      maxChainDepth: aggregate.maxChainDepth,
      cpuPct: aggregate.cpuPct,
      runMs: aggregate.runMs,
      kindBreakdown: aggregate.kindBreakdown,
      sampleAsyncIds: aggregate.sampleAsyncIds,
      ...(userCaller ? { userCaller } : {}),
    });
  }
  hotFiles.sort(
    (a, b) =>
      b.score - a.score || b.operationCount - a.operationCount || a.file.localeCompare(b.file),
  );
  return hotFiles.slice(0, MAX_HOT_FILES);
}

function confidenceForHotFile(
  quality: AsyncProfileQuality,
  operationCount: number,
): ProfileConfidence {
  if (quality.confidence === 'low') return 'low';
  if (quality.confidence === 'high' && operationCount > 0) return 'high';
  return 'medium';
}
