import type {
  BaseFinding,
  FindingMeasurements,
  MemoryHotAllocator,
  UserCallerAttribution,
} from '@lanterna-profiler/core';

export { isActionableMemoryFrame } from './memory-actionability.js';

export interface MemoryFindingFrame {
  readonly function: string;
  readonly file: string;
  readonly line: number;
  readonly selfPct: number;
  readonly source?: MemoryHotAllocator['source'];
}

export interface BuildMemoryFindingArgs {
  readonly id: string;
  readonly severity: BaseFinding['severity'];
  readonly category: string;
  readonly title: string;
  readonly confidence: NonNullable<BaseFinding['confidence']>;
  readonly proofLevel: NonNullable<BaseFinding['proofLevel']>;
  readonly frame: MemoryFindingFrame;
  readonly extra: Record<string, unknown>;
  readonly measurements?: FindingMeasurements;
  readonly why: string;
  readonly suggestion: string;
  readonly references: string[];
}

export function buildMemoryFinding(
  args: BuildMemoryFindingArgs,
): BaseFinding<string, Record<string, unknown>> {
  return {
    id: args.id,
    profileKind: 'memory',
    severity: args.severity,
    category: args.category,
    title: args.title,
    confidence: args.confidence,
    proofLevel: args.proofLevel,
    evidence: {
      file: args.frame.file,
      line: args.frame.line,
      function: args.frame.function,
      selfPct: args.frame.selfPct,
      ...(args.frame.source ? { source: args.frame.source } : {}),
      extra: args.extra,
    },
    ...(args.measurements ? { measurements: args.measurements } : {}),
    why: args.why,
    suggestion: args.suggestion,
    references: args.references,
  };
}

export function allocatorUserCaller(
  allocator: MemoryHotAllocator,
): UserCallerAttribution | undefined {
  if (allocator.userCaller) return allocator.userCaller;
  if (allocator.category !== 'user') return undefined;
  return {
    function: allocator.function,
    file: allocator.file,
    line: allocator.line,
    column: allocator.column,
    ...(allocator.source ? { source: allocator.source } : {}),
    stackDistance: 0,
    profilePct: allocator.totalPct,
    supportPct: 100,
    confidence: 'high',
    basis: 'heap-sample-path',
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
