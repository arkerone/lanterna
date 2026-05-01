import type {
  AsyncHotFile,
  AsyncProfileReport,
  AsyncStackFrameReport,
  BaseFinding,
} from '@lanterna-profiler/core';

export interface AsyncAnchor {
  frame?: AsyncStackFrameReport;
  hotFile?: AsyncHotFile;
  hotFileRank?: number;
}

export function anchorForFrame(
  report: AsyncProfileReport,
  frame: AsyncStackFrameReport | undefined,
): AsyncAnchor {
  if (frame) {
    const hotFileRank = report.hotFiles.findIndex((hotFile) => hotFile.file === frame.file);
    return {
      frame,
      hotFile: hotFileRank >= 0 ? report.hotFiles[hotFileRank] : undefined,
      hotFileRank: hotFileRank >= 0 ? hotFileRank + 1 : undefined,
    };
  }
  const hotFile = reliableTopHotFile(report);
  return {
    frame: hotFile?.primaryFrame,
    hotFile,
    hotFileRank: hotFile ? 1 : undefined,
  };
}

export function anchorForFile(report: AsyncProfileReport, file: string | undefined): AsyncAnchor {
  if (!file) return anchorForFrame(report, undefined);
  const hotFileRank = report.hotFiles.findIndex((hotFile) => hotFile.file === file);
  if (hotFileRank >= 0) {
    const hotFile = report.hotFiles[hotFileRank];
    return {
      frame: hotFile?.primaryFrame,
      hotFile,
      hotFileRank: hotFileRank + 1,
    };
  }
  return anchorForFrame(report, undefined);
}

export function asyncEvidenceExtra(
  report: AsyncProfileReport,
  anchor: AsyncAnchor,
): Record<string, unknown> {
  return {
    asyncQuality: report.quality.confidence,
    hotFileRank: anchor.hotFileRank ?? null,
    hotFileScore: anchor.hotFile?.score ?? null,
    recordsDropped: report.quality.recordsDropped,
    sampledStackRatio: report.quality.sampledStackRatio,
    initStackCoverageRatio: report.quality.initStackCoverageRatio,
    cdpAsyncStackCoverageRatio: report.quality.cdpAsyncStackCoverageRatio,
    instrumentationMode: report.quality.instrumentationMode,
    attachPartialCapture: report.quality.attachPartialCapture,
    cpuAttributionCoveragePct: report.quality.cpuAttributionCoveragePct,
    cpuAmbiguousSamples: report.quality.cpuAmbiguousSamples,
    clockSyncUncertaintyMs: report.quality.clockSyncUncertaintyMs,
  };
}

export function asyncConfidence(
  report: AsyncProfileReport,
  base: BaseFinding['confidence'],
): BaseFinding['confidence'] {
  if (report.quality.confidence === 'low') return 'low';
  if (base === 'low') return 'low';
  if (report.quality.confidence === 'medium' || base === 'medium') return 'medium';
  return 'high';
}

function reliableTopHotFile(report: AsyncProfileReport): AsyncHotFile | undefined {
  const hotFile = report.hotFiles[0];
  if (!hotFile) return undefined;
  if (report.quality.sampledStackRatio < 0.5) return undefined;
  return hotFile;
}
