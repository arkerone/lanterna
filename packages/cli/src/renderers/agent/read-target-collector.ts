import type {
  AsyncProfileReport,
  Finding,
  LanternaReport,
  UserCallerAttribution,
} from '@lanterna-profiler/core';
import { formatPct } from '../formatting.js';
import { decisionForFinding } from './findings.js';
import {
  candidateCallersFromEvidenceExtra,
  correlatedAllocatorFromEvidenceExtra,
  entryFrameFromEvidenceExtra,
  type Frame,
  frameMatchesTarget,
  isExternalOrRuntimeFrame,
  matchedCpuUserStackForFinding,
  reasonForExternalUserCaller,
  userCallerFromEvidenceExtra,
} from './frames.js';
import { isEditableUserFile, isGeneratedOutputPath } from './paths.js';
import {
  asyncOperationFrames,
  formatImpact,
  signalFromAsyncHotFile,
  signalFromAsyncScore,
  signalFromCpuPct,
  signalFromDuration,
  signalFromPctFrame,
  signalFromTotalPctFrame,
  signalFromWeight,
} from './values.js';

export type ReadTargetSource = 'finding' | 'cpu' | 'memory' | 'async';
export type ReadTargetDecision = 'read-first' | 'inspect-lead' | 'supporting-context';
export type ReadTargetReason =
  | 'finding-location'
  | 'generated-output-fallback'
  | 'user-caller'
  | 'dependency-hotspot-caller'
  | 'runtime-hotspot-caller'
  | 'correlated-allocator'
  | 'cpu-user-stack'
  | 'top-cpu-culprit'
  | 'top-cpu-hotspot'
  | 'top-request-entry'
  | 'top-user-hotspot'
  | 'hot-stack-cluster'
  | 'memory-allocator'
  | 'top-async-hot-file'
  | 'top-async-hot-file-caller'
  | 'long-async-operation'
  | 'long-async-operation-caller'
  | 'async-entry-frame'
  | 'async-hot-file'
  | 'async-hot-file-caller'
  | 'async-cpu-attribution-root'
  | 'async-cpu-attribution'
  | 'async-cpu-attribution-caller';

export type ReadTarget = {
  location: string;
  file: string;
  generatedOutput: boolean;
  reason: ReadTargetReason;
  source: ReadTargetSource;
  signal: string;
  decision: ReadTargetDecision;
  rank: number;
};

/**
 * Collects the agent-facing source locations worth reading first. This is the
 * policy seam; rendering code should only decide how to display these targets.
 */
export function collectReadTargets(report: LanternaReport): ReadTarget[] {
  const targets: ReadTarget[] = [];
  collectFindingReadTargets(targets, report);
  collectAggregateReadTargets(targets, report);
  return dedupeReadTargets(targets)
    .sort(
      (leftTarget, rightTarget) =>
        leftTarget.rank - rightTarget.rank ||
        leftTarget.location.localeCompare(rightTarget.location),
    )
    .slice(0, 10);
}

function collectFindingReadTargets(targets: ReadTarget[], report: LanternaReport): void {
  const findings = report.findings ?? [];
  findings.forEach((finding, index) => {
    const signal = formatImpact(finding);
    const findingDecision = decisionForFinding(finding);
    const evidenceTarget = readTargetFrame(finding.evidence);
    if (evidenceTarget) {
      const findingIsActionable =
        findingDecision === 'actionable' && !evidenceTarget.generatedOutput;
      targets.push({
        ...evidenceTarget,
        reason: evidenceTarget.generatedOutput ? 'generated-output-fallback' : 'finding-location',
        source: 'finding',
        signal,
        decision: findingIsActionable ? 'read-first' : 'inspect-lead',
        rank: findingIsActionable ? index : 100 + index,
      });
      collectExtraFindingReadTargets(targets, finding, index, signal);
      collectCpuUserStackReadTargets(targets, finding, report, index);
      return;
    }
    const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
    const userCallerTarget = readTargetFrame(userCaller);
    if (userCallerTarget) {
      targets.push({
        ...userCallerTarget,
        reason: reasonForExternalUserCaller(finding.evidence),
        source: 'finding',
        signal,
        decision:
          findingDecision === 'actionable' && userCaller?.confidence === 'high'
            ? 'read-first'
            : 'inspect-lead',
        rank:
          findingDecision === 'actionable' && userCaller?.confidence === 'high'
            ? index
            : 100 + index,
      });
    }
    candidateCallersFromEvidenceExtra(finding.evidence.extra)
      .filter((caller) => caller !== userCaller)
      .forEach((caller, candidateIndex) => {
        const target = readTargetFrame(caller);
        if (!target) return;
        targets.push({
          ...target,
          reason: reasonForExternalUserCaller(finding.evidence),
          source: 'finding',
          signal,
          decision:
            caller.stackDistance === 1 && caller.confidence === 'high'
              ? 'inspect-lead'
              : 'supporting-context',
          rank: 150 + index * 10 + candidateIndex,
        });
      });
    collectExtraFindingReadTargets(targets, finding, index, signal);
    collectCpuUserStackReadTargets(targets, finding, report, index);
  });
}

function collectExtraFindingReadTargets(
  targets: ReadTarget[],
  finding: Finding,
  findingIndex: number,
  signal: string,
): void {
  const correlatedAllocator = correlatedAllocatorFromEvidenceExtra(finding.evidence.extra);
  const allocatorTarget = correlatedAllocator?.userCaller ?? correlatedAllocator;
  pushReadTarget(targets, allocatorTarget, {
    reason: 'correlated-allocator',
    source: 'finding',
    signal,
    decision:
      correlatedAllocator?.userCaller?.confidence === 'high' ? 'read-first' : 'inspect-lead',
    rank: 60 + findingIndex * 20,
  });

  pushReadTarget(targets, entryFrameFromEvidenceExtra(finding.evidence.extra), {
    reason: 'async-entry-frame',
    source: 'finding',
    signal,
    decision: 'inspect-lead',
    rank: 65 + findingIndex * 20,
  });
}

function collectCpuUserStackReadTargets(
  targets: ReadTarget[],
  finding: Finding,
  report: LanternaReport,
  findingIndex: number,
): void {
  const stack = matchedCpuUserStackForFinding(finding, report);
  if (!stack) return;
  stack.userFrames.forEach((frame, frameIndex) => {
    const target = readTargetFrame(frame);
    if (!target) return;
    targets.push({
      ...target,
      reason: 'cpu-user-stack',
      source: 'finding',
      signal: `${formatPct(stack.weightPct)} stack`,
      decision: frameMatchesTarget(frame, finding.evidence) ? 'inspect-lead' : 'supporting-context',
      rank: 80 + findingIndex * 20 + frameIndex,
    });
  });
}

function collectAggregateReadTargets(targets: ReadTarget[], report: LanternaReport): void {
  const cpu = report.profiles?.cpu;
  if (cpu) {
    const hasCpuFinding = (report.findings ?? []).some((finding) => finding.profileKind === 'cpu');
    pushReadTarget(targets, cpu.summary?.topCpuCulprit, {
      reason: 'top-cpu-culprit',
      source: 'cpu',
      signal: signalFromPctFrame(cpu.summary?.topCpuCulprit),
      decision: 'read-first',
      rank: 180,
    });
    if (!hasCpuFinding) {
      pushReadTarget(targets, cpu.summary?.topRequestEntry, {
        reason: 'top-request-entry',
        source: 'cpu',
        signal: signalFromTotalPctFrame(cpu.summary?.topRequestEntry),
        decision: 'inspect-lead',
        rank: 195,
      });
      pushReadTarget(targets, cpu.summary?.topUserHotspot, {
        reason: 'top-user-hotspot',
        source: 'cpu',
        signal: signalFromTotalPctFrame(cpu.summary?.topUserHotspot),
        decision: 'inspect-lead',
        rank: 200,
      });
      for (const hotspot of cpu.hotspots ?? []) {
        const userCallerTarget = readTargetFrame(hotspot.userCaller);
        if (userCallerTarget && isExternalOrRuntimeFrame(hotspot)) {
          targets.push({
            ...userCallerTarget,
            reason: reasonForExternalUserCaller(hotspot),
            source: 'cpu',
            signal: signalFromPctFrame(hotspot),
            decision: hotspot.userCaller?.confidence === 'high' ? 'read-first' : 'inspect-lead',
            rank: hotspot.userCaller?.confidence === 'high' ? 210 : 230,
          });
        } else {
          pushReadTarget(targets, hotspot, {
            reason: 'top-cpu-hotspot',
            source: 'cpu',
            signal: signalFromPctFrame(hotspot),
            decision: 'inspect-lead',
            rank: 220,
          });
        }
      }
      for (const stack of cpu.hotStacks ?? []) {
        const frame = stack.frames.find((candidate) => Boolean(readTargetFrame(candidate)));
        pushReadTarget(targets, frame, {
          reason: 'hot-stack-cluster',
          source: 'cpu',
          signal: signalFromWeight(stack.weightPct),
          decision: 'supporting-context',
          rank: 240,
        });
      }
      for (const cluster of cpu.hotStackClusters ?? []) {
        pushReadTarget(targets, cluster.anchor, {
          reason: 'hot-stack-cluster',
          source: 'cpu',
          signal: signalFromWeight(cluster.weightPct),
          decision: 'supporting-context',
          rank: 250,
        });
      }
    }
  }
  const memory = report.profiles?.memory;
  if (memory) {
    collectAllocatorReadTarget(targets, memory.summary?.topAllocator, 300);
    for (const allocator of memory.hotAllocators ?? []) {
      collectAllocatorReadTarget(targets, allocator, 310);
    }
  }
  const asyncProfile = report.profiles?.async;
  if (asyncProfile) collectAsyncReadTargets(targets, asyncProfile);
}

function collectAllocatorReadTarget(
  targets: ReadTarget[],
  allocatorFrame: (Frame & { userCaller?: UserCallerAttribution; selfPct?: number }) | undefined,
  rank: number,
): void {
  if (!allocatorFrame) return;
  const userCallerTarget = readTargetFrame(allocatorFrame.userCaller);
  if (userCallerTarget && isExternalOrRuntimeFrame(allocatorFrame)) {
    targets.push({
      ...userCallerTarget,
      reason: 'memory-allocator',
      source: 'memory',
      signal: signalFromPctFrame(allocatorFrame),
      decision: allocatorFrame.userCaller?.confidence === 'high' ? 'read-first' : 'inspect-lead',
      rank,
    });
    return;
  }
  pushReadTarget(targets, allocatorFrame, {
    reason: 'memory-allocator',
    source: 'memory',
    signal: signalFromPctFrame(allocatorFrame),
    decision: 'inspect-lead',
    rank,
  });
}

function collectAsyncReadTargets(targets: ReadTarget[], asyncProfile: AsyncProfileReport): void {
  collectAsyncFrameReadTarget(targets, asyncProfile.summary.topAsyncHotFile, {
    reason: 'top-async-hot-file',
    signal: signalFromAsyncScore(asyncProfile.summary.topAsyncHotFile),
    rank: 400,
  });
  collectAsyncFrameReadTarget(targets, asyncProfile.summary.topAsyncHotFile?.userCaller, {
    reason: 'top-async-hot-file-caller',
    signal: signalFromAsyncScore(asyncProfile.summary.topAsyncHotFile),
    rank: 410,
  });
  for (const operation of asyncProfile.topOperations ?? []) {
    const userCaller = readTargetFrame(operation.userCaller);
    if (userCaller) {
      targets.push({
        ...userCaller,
        reason: 'long-async-operation-caller',
        source: 'async',
        signal: signalFromDuration(operation.durationMs),
        decision: operation.userCaller?.confidence === 'high' ? 'read-first' : 'inspect-lead',
        rank: 420,
      });
    } else {
      for (const frame of asyncOperationFrames(operation)) {
        if (
          pushReadTarget(targets, frame, {
            reason: 'long-async-operation',
            source: 'async',
            signal: signalFromDuration(operation.durationMs),
            decision: 'inspect-lead',
            rank: 430,
          })
        ) {
          break;
        }
      }
    }
  }
  for (const hotFile of asyncProfile.hotFiles ?? []) {
    collectAsyncFrameReadTarget(targets, hotFile.primaryFrame, {
      reason: 'async-hot-file',
      signal: signalFromAsyncHotFile(hotFile),
      rank: 440,
    });
    collectAsyncFrameReadTarget(targets, hotFile.userCaller, {
      reason: 'async-hot-file-caller',
      signal: signalFromAsyncHotFile(hotFile),
      rank: 450,
    });
  }
  for (const chain of asyncProfile.cpuAttribution?.topChains ?? []) {
    collectAsyncFrameReadTarget(targets, chain.rootFrame, {
      reason: 'async-cpu-attribution-root',
      signal: signalFromCpuPct(chain.cpuPct),
      rank: 460,
    });
    collectAsyncFrameReadTarget(targets, chain.executionFrame, {
      reason: 'async-cpu-attribution',
      signal: signalFromCpuPct(chain.cpuPct),
      rank: 470,
    });
    collectAsyncFrameReadTarget(targets, chain.userCaller, {
      reason: 'async-cpu-attribution-caller',
      signal: signalFromCpuPct(chain.cpuPct),
      rank: 480,
    });
  }
}

function collectAsyncFrameReadTarget(
  targets: ReadTarget[],
  frame: Frame | undefined,
  attrs: { reason: ReadTargetReason; signal: string; rank: number },
): void {
  pushReadTarget(targets, frame, {
    reason: attrs.reason,
    source: 'async',
    signal: attrs.signal,
    decision: 'inspect-lead',
    rank: attrs.rank,
  });
}

function pushReadTarget(
  targets: ReadTarget[],
  frame: Frame | undefined,
  attrs: Omit<ReadTarget, 'file' | 'location' | 'generatedOutput'>,
): boolean {
  const target = readTargetFrame(frame);
  if (!target) return false;
  targets.push({ ...target, ...attrs });
  return true;
}

function readTargetFrame(
  frame: Frame | undefined,
): Pick<ReadTarget, 'file' | 'location' | 'generatedOutput'> | undefined {
  if (!frame) return undefined;
  if (frame.source && isEditableUserFile(frame.source.file)) {
    return {
      file: frame.source.file,
      location: `${frame.source.file}:${frame.source.line}`,
      generatedOutput: false,
    };
  }
  if (!isEditableUserFile(frame.file)) return undefined;
  return {
    file: frame.file,
    location: `${frame.file}:${frame.line}`,
    generatedOutput: isGeneratedOutputPath(frame.file),
  };
}

function dedupeReadTargets(targets: ReadTarget[]): ReadTarget[] {
  const byLocation = new Map<string, ReadTarget>();
  for (const target of targets) {
    const existing = byLocation.get(target.location);
    if (!existing || compareReadTargetPriority(target, existing) < 0) {
      byLocation.set(target.location, target);
    }
  }
  return [...byLocation.values()];
}

function compareReadTargetPriority(left: ReadTarget, right: ReadTarget): number {
  const decisionDelta = decisionRank(left.decision) - decisionRank(right.decision);
  if (decisionDelta !== 0) return decisionDelta;
  return left.rank - right.rank;
}

function decisionRank(decision: ReadTargetDecision): number {
  switch (decision) {
    case 'read-first':
      return 0;
    case 'inspect-lead':
      return 1;
    case 'supporting-context':
      return 2;
  }
}

export function formatReadTargetReason(reason: ReadTargetReason): string {
  switch (reason) {
    case 'finding-location':
      return 'finding location';
    case 'generated-output-fallback':
      return 'generated output fallback';
    case 'user-caller':
      return 'user caller';
    case 'dependency-hotspot-caller':
      return 'user caller for dependency hotspot';
    case 'runtime-hotspot-caller':
      return 'user caller for runtime hotspot';
    case 'correlated-allocator':
      return 'correlated allocator';
    case 'cpu-user-stack':
      return 'CPU user stack';
    case 'top-cpu-culprit':
      return 'top CPU culprit';
    case 'top-cpu-hotspot':
      return 'top CPU hotspot';
    case 'top-request-entry':
      return 'top request entry';
    case 'top-user-hotspot':
      return 'top user hotspot';
    case 'hot-stack-cluster':
      return 'hot stack cluster';
    case 'memory-allocator':
      return 'memory allocator';
    case 'top-async-hot-file':
      return 'top async hot file';
    case 'top-async-hot-file-caller':
      return 'top async hot file caller';
    case 'long-async-operation':
      return 'long async operation';
    case 'long-async-operation-caller':
      return 'long async operation caller';
    case 'async-entry-frame':
      return 'async entry frame';
    case 'async-hot-file':
      return 'async hot file';
    case 'async-hot-file-caller':
      return 'async hot file caller';
    case 'async-cpu-attribution-root':
      return 'async CPU attribution root';
    case 'async-cpu-attribution':
      return 'async CPU attribution';
    case 'async-cpu-attribution-caller':
      return 'async CPU attribution caller';
  }
}
