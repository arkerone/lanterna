import type { Finding, LanternaReport } from '@lanterna-profiler/core';
import { formatPct } from '../formatting.js';
import { decisionForFinding } from './findings.js';

const MOSTLY_IDLE_CPU_RATIO = 0.9;
const BEST_EFFORT_DETECTOR_PREFIXES = ['deopt-loop:', 'deep-async-chain:', 'hot-async-context:'];
const BEST_EFFORT_DETECTOR_CAVEAT = 'best-effort detector evidence present';

export function blockingIntegrityCaveats(report: LanternaReport): string[] {
  const integrity = report.meta?.captureIntegrity;
  if (!integrity) return ['capture integrity missing'];
  const caveats: string[] = [];
  if (integrity.controlChannelExpected && !integrity.controlChannel) {
    caveats.push('control channel unavailable');
  }
  return caveats;
}

export function degradingSignalCaveats(report: LanternaReport): string[] {
  const integrity = report.meta?.captureIntegrity;
  const caveats: string[] = [];
  const sourceMaps = integrity?.sourceMaps;
  if (report.profiles?.cpu?.quality?.confidence === 'low') caveats.push('CPU confidence low');
  const idleRatio =
    report.profiles?.cpu?.quality?.idleRatio ?? report.profiles?.cpu?.summary?.idleRatio;
  if (
    typeof idleRatio === 'number' &&
    Number.isFinite(idleRatio) &&
    idleRatio >= MOSTLY_IDLE_CPU_RATIO
  ) {
    caveats.push(`CPU profile mostly idle (${formatPct(idleRatio * 100)})`);
  }
  if (report.profiles?.memory?.memoryUsage?.available === false) {
    caveats.push('memory usage series unavailable');
  }
  if (report.profiles?.memory?.quality?.confidence === 'low') {
    caveats.push('memory confidence low');
  }
  const heapSnapshotWarnings = report.profiles?.memory?.heapSnapshotAnalysis?.warnings ?? [];
  if (heapSnapshotWarnings.length > 0) {
    caveats.push(`heap snapshot warnings: ${heapSnapshotWarnings.join('; ')}`);
  }
  const asyncProfile = report.profiles?.async;
  if (asyncProfile?.quality?.confidence === 'low') caveats.push('async confidence low');
  if (asyncProfile?.summary?.available === false) caveats.push('async summary unavailable');
  if ((asyncProfile?.quality?.recordsDropped ?? 0) > 0) {
    caveats.push(`${asyncProfile?.quality?.recordsDropped ?? 0} async records dropped`);
  }
  if (sourceMaps?.enabled && (sourceMaps.applicable ?? true) && sourceMaps.coverage < 0.7) {
    caveats.push('source-map coverage below 70%');
  }
  if ((report.findings ?? []).some(isBestEffortDetectorFinding)) {
    caveats.push(BEST_EFFORT_DETECTOR_CAVEAT);
  }
  if (integrity?.eventLoopTimed === false) caveats.push('event-loop timing unavailable');
  if (integrity?.gcTimed === false) caveats.push('GC timing unavailable');
  if ((integrity?.heartbeatDropped ?? 0) > 0) {
    caveats.push(`${integrity?.heartbeatDropped ?? 0} heartbeat events dropped`);
  }
  return caveats;
}

export function hasInsufficientSignal(report: LanternaReport): boolean {
  return (
    blockingIntegrityCaveats(report).length > 0 ||
    rerunRequiredSignalCaveats(report).length > 0 ||
    (report.findings ?? []).some((finding: Finding) => decisionForFinding(finding) === 'rerun')
  );
}

function rerunRequiredSignalCaveats(report: LanternaReport): string[] {
  return degradingSignalCaveats(report).filter(
    (caveat) =>
      caveat !== 'event-loop timing unavailable' &&
      caveat !== 'GC timing unavailable' &&
      caveat !== BEST_EFFORT_DETECTOR_CAVEAT,
  );
}

function isBestEffortDetectorFinding(finding: Finding): boolean {
  return BEST_EFFORT_DETECTOR_PREFIXES.some((prefix) => finding.id.startsWith(prefix));
}
