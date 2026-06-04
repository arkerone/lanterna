import type {
  AsyncCpuAttributionEntry,
  AsyncHotFile,
  AsyncTopOperation,
  Finding,
  Hotspot,
  LanternaReport,
  MemoryHotAllocator,
  UserCallerAttribution,
} from '@lanterna-profiler/core';

const SUMMARY_ITEM_LIMIT = 5;

type CpuProfile = NonNullable<LanternaReport['profiles']['cpu']>;
type MemoryProfile = NonNullable<LanternaReport['profiles']['memory']>;
type AsyncProfile = NonNullable<LanternaReport['profiles']['async']>;
type CpuSummaryHotspot = NonNullable<CpuProfile['summary']['topCpuCulprit']>;

export interface ReportView {
  sourceMaps: LanternaReport['meta']['captureIntegrity']['sourceMaps'] | undefined;
  cpu?: {
    profile: CpuProfile;
    topCpuCulprit?: CpuSummaryHotspot;
    topRequestEntry?: CpuSummaryHotspot;
    hotspots: Hotspot[];
  };
  memory?: {
    profile: MemoryProfile;
    topAllocatorUserCaller?: UserCallerAttribution;
    allocators: MemoryHotAllocator[];
  };
  async?: {
    profile: AsyncProfile;
    topHotFileUserCaller?: UserCallerAttribution;
    operations: AsyncTopOperation[];
    hotFiles: AsyncHotFile[];
    cpuChains: AsyncCpuAttributionEntry[];
  };
  findings: ReportFindingView[];
}

export interface ReportFindingView {
  finding: Finding;
  userCaller?: UserCallerAttribution;
  candidateCallers: UserCallerAttribution[];
}

export function buildReportView(report: LanternaReport): ReportView {
  const cpu = report.profiles?.cpu;
  const memory = report.profiles?.memory;
  const async_ = report.profiles?.async;

  return {
    sourceMaps: report.meta?.captureIntegrity?.sourceMaps,
    cpu: cpu
      ? {
          profile: cpu,
          topCpuCulprit: cpu.summary?.topCpuCulprit,
          topRequestEntry: sameFrameLocation(
            cpu.summary?.topRequestEntry,
            cpu.summary?.topCpuCulprit,
          )
            ? undefined
            : cpu.summary?.topRequestEntry,
          hotspots: topItems(cpu.hotspots ?? []),
        }
      : undefined,
    memory: memory
      ? {
          profile: memory,
          topAllocatorUserCaller: memory.summary?.topAllocator?.userCaller,
          allocators: topItems(memory.hotAllocators ?? []),
        }
      : undefined,
    async: async_
      ? {
          profile: async_,
          topHotFileUserCaller: async_.summary?.topAsyncHotFile?.userCaller,
          operations: topItems(async_.topOperations ?? []),
          hotFiles: topItems(async_.hotFiles ?? []),
          cpuChains: topItems(async_.cpuAttribution?.topChains ?? []),
        }
      : undefined,
    findings: (report.findings ?? []).map((finding) => ({
      finding,
      userCaller: userCallerFromEvidenceExtra(finding.evidence.extra),
      candidateCallers: candidateCallersFromEvidenceExtra(finding.evidence.extra),
    })),
  };
}

export function userCallerFromEvidenceExtra(
  extra: Finding['evidence']['extra'],
): UserCallerAttribution | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  return (extra as { userCaller?: UserCallerAttribution }).userCaller;
}

export function candidateCallersFromEvidenceExtra(
  extra: Finding['evidence']['extra'],
): UserCallerAttribution[] {
  if (!extra || typeof extra !== 'object') return [];
  const candidateCallers = (extra as { candidateCallers?: unknown }).candidateCallers;
  return Array.isArray(candidateCallers) ? (candidateCallers as UserCallerAttribution[]) : [];
}

function sameFrameLocation(left: ReportFrame | undefined, right: ReportFrame | undefined): boolean {
  if (!left || !right) return false;
  return (
    preferredFrameLocation(left) === preferredFrameLocation(right) &&
    left.function === right.function
  );
}

function preferredFrameLocation(frame: ReportFrame): string {
  if (frame.source) return `${frame.source.file}:${frame.source.line}`;
  return `${frame.file}:${frame.line}`;
}

function topItems<T>(items: readonly T[]): T[] {
  return items.slice(0, SUMMARY_ITEM_LIMIT);
}

type ReportFrame = {
  function?: string;
  file: string;
  line: number;
  source?: { file: string; line: number };
};
