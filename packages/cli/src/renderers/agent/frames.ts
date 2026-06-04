import type { Finding, LanternaReport, UserCallerAttribution } from '@lanterna-profiler/core';
import { formatPct } from '../formatting.js';
import {
  isDependencyOrRuntimePath,
  isDependencyPath,
  isPseudoFile,
  isPseudoFrameFunction,
  isVirtualSourcePath,
} from './paths.js';

export type Frame = {
  function?: string;
  file: string;
  line: number;
  source?: { file: string; line: number };
};

export type CpuStackFrame = Frame & { category?: string };

export function userCallerFromEvidenceExtra(extra: unknown): UserCallerAttribution | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  return (extra as { userCaller?: UserCallerAttribution }).userCaller;
}

export function candidateCallersFromEvidenceExtra(extra: unknown): UserCallerAttribution[] {
  if (!extra || typeof extra !== 'object') return [];
  const candidateCallers = (extra as { candidateCallers?: unknown }).candidateCallers;
  return Array.isArray(candidateCallers) ? (candidateCallers as UserCallerAttribution[]) : [];
}

export function correlatedAllocatorFromEvidenceExtra(
  extra: unknown,
): (Frame & { basis?: string; userCaller?: UserCallerAttribution; totalPct?: number }) | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const correlatedAllocator = Reflect.get(extra, 'correlatedAllocator');
  if (
    !correlatedAllocator ||
    typeof correlatedAllocator !== 'object' ||
    Array.isArray(correlatedAllocator)
  ) {
    return undefined;
  }
  const frame = correlatedAllocator as Partial<
    Frame & { basis?: string; userCaller?: UserCallerAttribution; totalPct?: number }
  >;
  if (typeof frame.file !== 'string' || typeof frame.line !== 'number') return undefined;
  return frame as Frame & { basis?: string; userCaller?: UserCallerAttribution; totalPct?: number };
}

export function entryFrameFromEvidenceExtra(extra: unknown): Frame | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const entryFrame = Reflect.get(extra, 'entryFrame');
  if (!entryFrame || typeof entryFrame !== 'object' || Array.isArray(entryFrame)) return undefined;
  const frame = entryFrame as Partial<Frame>;
  if (typeof frame.file !== 'string' || typeof frame.line !== 'number') return undefined;
  return frame as Frame;
}

export function cpuUserStackForFinding(
  finding: Finding,
  report: LanternaReport,
): string | undefined {
  const stack = matchedCpuUserStackForFinding(finding, report);
  if (!stack) return undefined;
  const leafSuffix =
    stack.leaf && !isUserStackFrame(stack.leaf)
      ? `, leaf ${frameLabel(stack.leaf)} at ${frameLocation(stack.leaf)}`
      : '';
  return `${formatCpuStackFrames(stack.userFrames)} (${formatPct(stack.weightPct)} stack${leafSuffix})`;
}

export function matchedCpuUserStackForFinding(
  finding: Finding,
  report: LanternaReport,
): { userFrames: CpuStackFrame[]; leaf?: CpuStackFrame; weightPct: number } | undefined {
  if (finding.profileKind !== 'cpu') return undefined;
  const hotStacks = report.profiles?.cpu?.hotStacks ?? [];
  const scoredStacks = hotStacks
    .map((stack) => ({
      stack,
      score: scoreCpuStackForFinding(stack.frames, finding),
    }))
    .filter((match) => match.score > 0)
    .sort(
      (left, right) => right.score - left.score || right.stack.weightPct - left.stack.weightPct,
    );
  const bestStackMatch = scoredStacks[0];
  if (!bestStackMatch) return undefined;
  const trimmedStack = trimCpuUserStackForFinding(bestStackMatch.stack.frames, finding);
  if (trimmedStack.userFrames.length === 0) return undefined;
  return { ...trimmedStack, weightPct: bestStackMatch.stack.weightPct };
}

export function frameMatchesTarget(
  frame: CpuStackFrame,
  target: {
    function?: string;
    file: string;
    line: number;
    source?: { file: string; line: number };
  },
): boolean {
  const locationMatches =
    sameFrameFileLine(frame, target.file, target.line) ||
    (target.source ? sameFrameFileLine(frame, target.source.file, target.source.line) : false);
  if (!locationMatches) return false;
  if (!target.function || !frame.function) return true;
  return frameMatchesFunction(frame, target.function);
}

export function preferredLocation(finding: Finding): string {
  if (finding.evidence.source) {
    return `${finding.evidence.source.file}:${finding.evidence.source.line}`;
  }
  return `${finding.evidence.file}:${finding.evidence.line}`;
}

export function preferredLocationWithFallback(finding: Finding): string {
  const source = finding.evidence.source;
  const generated = `${finding.evidence.file}:${finding.evidence.line}`;
  if (source) return `${source.file}:${source.line} (fallback ${generated})`;
  return generated;
}

export function frameLocation(frame: Frame): string {
  if (frame.source) return `${frame.source.file}:${frame.source.line}`;
  return `${frame.file}:${frame.line}`;
}

export function frameLabel(frame: Frame): string {
  return frame.function ?? '—';
}

export function userCallerCell(caller: UserCallerAttribution | undefined): string {
  if (!caller) return '—';
  return `${frameLocation(caller)} (${caller.confidence})`;
}

export function sameFrameLocation(left: Frame | undefined, right: Frame | undefined): boolean {
  if (!left || !right) return false;
  return frameLocation(left) === frameLocation(right) && left.function === right.function;
}

export function userCallerSuffix(caller: UserCallerAttribution | undefined): string {
  if (!caller) return '';
  return ` — user_caller ${formatUserCallerCompact(caller)}`;
}

export function basisSuffix(basis: string | undefined): string {
  return basis ? ` (${basis})` : '';
}

export function formatUserCallerCompact(caller: UserCallerAttribution): string {
  const stackDistance =
    caller.stackDistance !== undefined ? `, distance ${caller.stackDistance}` : '';
  return `${caller.function ?? '—'} at ${frameLocation(caller)} (${caller.confidence}, ${caller.basis}, support ${formatPct(caller.supportPct)}${stackDistance})`;
}

export function reasonForExternalUserCaller(frame: Frame): ReadTargetReasonForFrame {
  if (isDependencyPath(frame.file)) return 'dependency-hotspot-caller';
  if (isExternalOrRuntimeFrame(frame)) return 'runtime-hotspot-caller';
  return 'user-caller';
}

export type ReadTargetReasonForFrame =
  | 'user-caller'
  | 'dependency-hotspot-caller'
  | 'runtime-hotspot-caller';

export function isExternalOrRuntimeFrame(frame: Frame): boolean {
  return (
    isDependencyOrRuntimePath(frame.file) ||
    isVirtualSourcePath(frame.file) ||
    isPseudoFile(frame.file) ||
    isPseudoFrameFunction(frame.function)
  );
}

export function isRenderableReviewFrame(frame: Frame | undefined): frame is Frame {
  if (!frame) return false;
  return !isPseudoFile(frame.file) && !isPseudoFrameFunction(frame.function);
}

function scoreCpuStackForFinding(frames: readonly CpuStackFrame[], finding: Finding): number {
  let score = frames.some((frame) => frameMatchesTarget(frame, finding.evidence)) ? 100 : 0;
  const expectedCalleeName = calleeNameFromExtra(finding.evidence.extra);
  if (
    expectedCalleeName &&
    frames.some((frame) => frameMatchesFunction(frame, expectedCalleeName))
  ) {
    score += 50;
  }
  for (const caller of candidateCallersFromEvidenceExtra(finding.evidence.extra)) {
    if (frames.some((frame) => frameMatchesTarget(frame, caller))) {
      score += caller.stackDistance === 1 ? 12 : 8;
    }
  }
  return score;
}

function trimCpuUserStackForFinding(
  frames: readonly CpuStackFrame[],
  finding: Finding,
): { userFrames: CpuStackFrame[]; leaf?: CpuStackFrame } {
  const causalFrames = [...frames].reverse();
  const endIndex = cpuStackEndIndex(causalFrames, finding);
  const prefix = causalFrames.slice(0, endIndex + 1);
  const firstUserIndex = prefix.findIndex(isUserStackFrame);
  if (firstUserIndex < 0) return { userFrames: [], leaf: prefix[prefix.length - 1] };
  const userFrames = prefix.slice(firstUserIndex).filter(isUserStackFrame);
  return { userFrames, leaf: prefix[prefix.length - 1] };
}

function cpuStackEndIndex(frames: readonly CpuStackFrame[], finding: Finding): number {
  const callee = calleeNameFromExtra(finding.evidence.extra);
  if (callee) {
    const calleeIndex = frames.findIndex((frame) => frameMatchesFunction(frame, callee));
    if (calleeIndex >= 0) return calleeIndex;
  }
  const evidenceIndex = frames.findIndex((frame) => frameMatchesTarget(frame, finding.evidence));
  return evidenceIndex >= 0 ? evidenceIndex : frames.length - 1;
}

function formatCpuStackFrames(frames: readonly CpuStackFrame[]): string {
  const labels = frames.map((frame) => `${frameLabel(frame)} at ${frameLocation(frame)}`);
  if (labels.length <= 12) return labels.join(' -> ');
  return [...labels.slice(0, 5), '...', ...labels.slice(-6)].join(' -> ');
}

function calleeNameFromExtra(extra: unknown): string | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const calleeName = Reflect.get(extra, 'callee');
  return typeof calleeName === 'string' && calleeName.length > 0 ? calleeName : undefined;
}

function sameFrameFileLine(frame: CpuStackFrame, file: string, line: number): boolean {
  return (
    (frame.file === file && frame.line === line) ||
    (frame.source?.file === file && frame.source.line === line)
  );
}

function frameMatchesFunction(
  frame: Pick<CpuStackFrame, 'function'>,
  functionName: string,
): boolean {
  const normalizedFrameName = stripV8OptimizationPrefix(frame.function ?? '');
  const normalizedTargetName = stripV8OptimizationPrefix(functionName);
  return (
    normalizedFrameName === normalizedTargetName ||
    normalizedFrameName.endsWith(`.${normalizedTargetName}`)
  );
}

function stripV8OptimizationPrefix(functionName: string): string {
  return functionName.replace(/^[*~]/, '');
}

function isUserStackFrame(frame: CpuStackFrame): boolean {
  return frame.category === 'user';
}
