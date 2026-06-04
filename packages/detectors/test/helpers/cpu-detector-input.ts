import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  CorrelatedHotspot,
  EventLoopReport,
  FrameCategory,
  Hotspot,
  KindScopedDetectorBundle,
  KindScopedDetectorShared,
  ReportMeta,
  SourceLocation,
  UserCallerAttribution,
} from '@lanterna-profiler/core';

/**
 * Concise spec for a hotspot the detector should see. Anything omitted gets a
 * harmless default; `userCaller` / `candidateCallers` are co-located here and
 * routed into the analysis maps the detectors read.
 */
export interface HotspotInput {
  id?: string;
  function: string;
  file?: string;
  line?: number;
  column?: number;
  category?: FrameCategory;
  package?: string;
  selfPct?: number;
  totalPct?: number;
  selfMs?: number;
  totalMs?: number;
  source?: SourceLocation;
  userCaller?: UserCallerAttribution;
  candidateCallers?: UserCallerAttribution[];
}

export interface MakeCpuDetectorInputOptions {
  hotspots: HotspotInput[];
  /** Populates `report.eventLoop.correlatedHotspots` (drives stall correlation). */
  correlatedHotspots?: CorrelatedHotspot[];
  /** Working directory the detector resolves source files against. */
  cwd?: string;
  /**
   * Source files written to a fresh temp dir (which becomes `cwd`). Keys are
   * paths relative to that dir. Use when a detector reads source — call
   * `cleanup()` afterwards.
   */
  sourceFiles?: Record<string, string>;
}

export interface CpuDetectorInput {
  /** Pass straight into `detector.detect(input.kinds, input.shared)`. */
  kinds: KindScopedDetectorBundle<'cpu'>;
  shared: KindScopedDetectorShared;
  cwd: string;
  /** Removes the temp source dir, if any. Safe to call when none was created. */
  cleanup(): void;
}

/** Build a `UserCallerAttribution` with test-friendly defaults. */
export function userCaller(partial: Partial<UserCallerAttribution> = {}): UserCallerAttribution {
  return {
    function: 'handler',
    file: 'app.js',
    line: 1,
    column: 0,
    profilePct: 0,
    supportPct: 100,
    confidence: 'high',
    basis: 'cpu-sample-path',
    ...partial,
  };
}

function makeHotspot(input: HotspotInput, index: number): Hotspot {
  return {
    id: input.id ?? `h${index}`,
    function: input.function,
    file: input.file ?? 'node:internal',
    line: input.line ?? 0,
    column: input.column ?? 0,
    category: input.category ?? 'node:builtin',
    ...(input.package !== undefined ? { package: input.package } : {}),
    selfMs: input.selfMs ?? 0,
    selfPct: input.selfPct ?? 0,
    totalMs: input.totalMs ?? 0,
    totalPct: input.totalPct ?? 0,
    callers: [],
    callees: [],
    optimizationState: 'unknown',
    ...(input.source ? { source: input.source } : {}),
    ...(input.userCaller ? { userCaller: input.userCaller } : {}),
  };
}

function makeEventLoop(correlatedHotspots?: CorrelatedHotspot[]): EventLoopReport {
  return {
    maxLagMs: 0,
    p99LagMs: 0,
    p50LagMs: 0,
    meanLagMs: 0,
    sampleCount: 0,
    stallIntervals: [],
    available: false,
    measurementBasis: 'none',
    confidence: 'none',
    ...(correlatedHotspots ? { correlatedHotspots } : {}),
  };
}

/**
 * Synthesizes the minimal cpu kind bundle a {@link KindScopedDetector}'s
 * `detect()` reads — `view.hotspotAnalysis` (the `CpuHotspotContext`),
 * `view.bundle.target.cwd`, and `report.eventLoop` — so detectors can be tested
 * through their real interface instead of the whole capture→report pipeline.
 *
 * Only the fields detectors actually read are populated; the outer `view` /
 * `report` are cast (test scaffolding) rather than fully reconstructed.
 */
export function makeCpuDetectorInput(options: MakeCpuDetectorInputOptions): CpuDetectorInput {
  let cwd = options.cwd ?? '/app';
  let tempDir: string | undefined;
  if (options.sourceFiles) {
    tempDir = mkdtempSync(join(tmpdir(), 'lanterna-detector-'));
    cwd = tempDir;
    for (const [relativePath, contents] of Object.entries(options.sourceFiles)) {
      const absolutePath = join(tempDir, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, contents, 'utf8');
    }
  }

  const fullHotspots: Hotspot[] = [];
  const hotspotById = new Map<string, Hotspot>();
  const userCallerById = new Map<string, UserCallerAttribution>();
  const candidateCallersById = new Map<string, UserCallerAttribution[]>();
  options.hotspots.forEach((input, index) => {
    const hotspot = makeHotspot(input, index);
    fullHotspots.push(hotspot);
    hotspotById.set(hotspot.id, hotspot);
    if (input.userCaller) userCallerById.set(hotspot.id, input.userCaller);
    if (input.candidateCallers) candidateCallersById.set(hotspot.id, input.candidateCallers);
  });

  const hotspotAnalysis = {
    publicHotspots: [] as Hotspot[],
    fullHotspots,
    hotspotById,
    userCallerById,
    candidateCallersById,
  };

  // Only the read surface is populated; the rest of view/report is irrelevant to detect().
  const kinds = {
    cpu: {
      report: { eventLoop: makeEventLoop(options.correlatedHotspots) },
      view: { hotspotAnalysis, bundle: { target: { cwd } } },
    },
  } as unknown as KindScopedDetectorBundle<'cpu'>;

  const shared: KindScopedDetectorShared = {
    findings: [],
    meta: {} as ReportMeta,
    profiles: {},
  };

  return {
    kinds,
    shared,
    cwd,
    cleanup() {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
