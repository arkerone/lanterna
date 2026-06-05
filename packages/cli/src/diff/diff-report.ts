import type { Finding, FindingSeverity, LanternaReport } from '@lanterna-profiler/core';

const SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, warning: 1, critical: 2 };

export type ChangeDirection = 'worse' | 'better' | 'same';

export interface FindingChange {
  id: string;
  title: string;
  profileKind: string;
  severityFrom: FindingSeverity;
  severityTo: FindingSeverity;
  severityDirection: ChangeDirection;
  confidenceFrom?: Finding['confidence'];
  confidenceTo?: Finding['confidence'];
  scoreFrom?: number;
  scoreTo?: number;
}

export interface ScalarDelta {
  kind: string;
  label: string;
  from?: number;
  to?: number;
  delta?: number;
  /** When true, a rise is a regression; when false, a drop is. */
  worseWhenHigher: boolean;
  direction: ChangeDirection;
}

export interface DiffReportMeta {
  mode: string;
  durationMs: number;
  profileKinds: string[];
  findingCount: number;
}

export interface ReportDiff {
  baseline: DiffReportMeta;
  current: DiffReportMeta;
  findings: {
    added: Finding[];
    removed: Finding[];
    changed: FindingChange[];
    unchangedCount: number;
  };
  scalarDeltas: ScalarDelta[];
  /** True when current introduces or worsens a non-info finding. */
  regressed: boolean;
}

function metaOf(report: LanternaReport): DiffReportMeta {
  return {
    mode: report.meta.mode,
    durationMs: report.meta.durationMs,
    profileKinds: [...report.meta.profileKinds],
    findingCount: report.findings.length,
  };
}

function severityDirection(from: FindingSeverity, to: FindingSeverity): ChangeDirection {
  const delta = SEVERITY_RANK[to] - SEVERITY_RANK[from];
  if (delta > 0) return 'worse';
  if (delta < 0) return 'better';
  return 'same';
}

function findingChanged(a: Finding, b: Finding): boolean {
  if (a.severity !== b.severity) return true;
  if ((a.confidence ?? '') !== (b.confidence ?? '')) return true;
  const scoreA = a.priority?.score;
  const scoreB = b.priority?.score;
  if (scoreA !== undefined && scoreB !== undefined && Math.round(scoreA) !== Math.round(scoreB)) {
    return true;
  }
  return false;
}

function diffFindings(baseline: LanternaReport, current: LanternaReport): ReportDiff['findings'] {
  const baseById = new Map(baseline.findings.map((f) => [f.id, f]));
  const curById = new Map(current.findings.map((f) => [f.id, f]));

  const added = current.findings.filter((f) => !baseById.has(f.id));
  const removed = baseline.findings.filter((f) => !curById.has(f.id));

  const changed: FindingChange[] = [];
  let unchangedCount = 0;
  for (const cur of current.findings) {
    const base = baseById.get(cur.id);
    if (!base) continue;
    if (!findingChanged(base, cur)) {
      unchangedCount++;
      continue;
    }
    changed.push({
      id: cur.id,
      title: cur.title,
      profileKind: cur.profileKind,
      severityFrom: base.severity,
      severityTo: cur.severity,
      severityDirection: severityDirection(base.severity, cur.severity),
      confidenceFrom: base.confidence,
      confidenceTo: cur.confidence,
      scoreFrom: base.priority?.score,
      scoreTo: cur.priority?.score,
    });
  }

  return { added, removed, changed, unchangedCount };
}

function scalarDelta(
  kind: string,
  label: string,
  from: number | undefined,
  to: number | undefined,
  worseWhenHigher: boolean,
): ScalarDelta | undefined {
  if (from === undefined && to === undefined) return undefined;
  const delta = from !== undefined && to !== undefined ? to - from : undefined;
  let direction: ChangeDirection = 'same';
  if (delta !== undefined && delta !== 0) {
    const rose = delta > 0;
    direction = rose === worseWhenHigher ? 'worse' : 'better';
  }
  return { kind, label, from, to, delta, worseWhenHigher, direction };
}

function diffScalars(baseline: LanternaReport, current: LanternaReport): ScalarDelta[] {
  const deltas: ScalarDelta[] = [];
  const push = (d: ScalarDelta | undefined) => {
    if (d) deltas.push(d);
  };

  const baseCpu = baseline.profiles.cpu;
  const curCpu = current.profiles.cpu;
  if (baseCpu && curCpu) {
    push(
      scalarDelta('cpu', 'idle ratio', baseCpu.summary.idleRatio, curCpu.summary.idleRatio, false),
    );
    push(scalarDelta('cpu', 'GC ratio', baseCpu.summary.gcRatio, curCpu.summary.gcRatio, true));
    push(
      scalarDelta(
        'cpu',
        'top culprit self%',
        baseCpu.summary.topCpuCulprit?.selfPct,
        curCpu.summary.topCpuCulprit?.selfPct,
        true,
      ),
    );
  }

  const baseMem = baseline.profiles.memory;
  const curMem = current.profiles.memory;
  if (baseMem && curMem) {
    push(
      scalarDelta(
        'memory',
        'RSS slope (B/s)',
        baseMem.summary.rss?.slopeBytesPerSec,
        curMem.summary.rss?.slopeBytesPerSec,
        true,
      ),
    );
    push(
      scalarDelta(
        'memory',
        'heapUsed slope (B/s)',
        baseMem.summary.heapUsed?.slopeBytesPerSec,
        curMem.summary.heapUsed?.slopeBytesPerSec,
        true,
      ),
    );
  }

  return deltas;
}

/**
 * Diffs two Lanterna reports. The diff is finding-first (the product surface):
 * added / removed / changed findings keyed by `Finding.id`, plus a small set of
 * headline scalar deltas for kinds present in both reports. `regressed` is true
 * when the current report introduces or worsens a non-info finding — the headline
 * an agent or CI gate reads first.
 */
export function diffReports(baseline: LanternaReport, current: LanternaReport): ReportDiff {
  const findings = diffFindings(baseline, current);
  const regressed =
    findings.added.some((f) => f.severity !== 'info') ||
    findings.changed.some((c) => c.severityDirection === 'worse');
  return {
    baseline: metaOf(baseline),
    current: metaOf(current),
    findings,
    scalarDeltas: diffScalars(baseline, current),
    regressed,
  };
}
