import type { Finding, FindingSeverity, LanternaReport } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { diffReports } from '../src/diff/diff-report.js';
import { renderDiff } from '../src/diff/render-diff.js';

function f(props: {
  id: string;
  severity?: FindingSeverity;
  profileKind?: string;
  title?: string;
  confidence?: 'low' | 'medium' | 'high';
  score?: number;
}): Finding {
  return {
    id: props.id,
    profileKind: props.profileKind ?? 'cpu',
    severity: props.severity ?? 'warning',
    title: props.title ?? props.id,
    confidence: props.confidence,
    priority:
      props.score === undefined ? undefined : { score: props.score, actionConfidence: 'medium' },
  } as unknown as Finding;
}

interface ReportProps {
  findings: Finding[];
  mode?: string;
  durationMs?: number;
  profileKinds?: string[];
  cpu?: { idleRatio?: number; gcRatio?: number; topSelfPct?: number };
  memory?: { rssSlope?: number; heapSlope?: number };
}

function report(props: ReportProps): LanternaReport {
  const profiles: Record<string, unknown> = {};
  if (props.cpu) {
    profiles.cpu = {
      summary: {
        idleRatio: props.cpu.idleRatio ?? 0,
        gcRatio: props.cpu.gcRatio ?? 0,
        topCpuCulprit:
          props.cpu.topSelfPct === undefined ? undefined : { selfPct: props.cpu.topSelfPct },
      },
    };
  }
  if (props.memory) {
    profiles.memory = {
      summary: {
        rss:
          props.memory.rssSlope === undefined
            ? undefined
            : { slopeBytesPerSec: props.memory.rssSlope },
        heapUsed:
          props.memory.heapSlope === undefined
            ? undefined
            : { slopeBytesPerSec: props.memory.heapSlope },
      },
    };
  }
  return {
    meta: {
      mode: props.mode ?? 'spawn',
      durationMs: props.durationMs ?? 1000,
      profileKinds: props.profileKinds ?? ['cpu'],
    },
    profiles,
    findings: props.findings,
  } as unknown as LanternaReport;
}

describe('diffReports', () => {
  it('classifies added, removed, changed, and unchanged findings by id', () => {
    const baseline = report({
      findings: [
        f({ id: 'cpu-hotspot:a', severity: 'warning' }),
        f({ id: 'cpu-hotspot:b', severity: 'warning' }),
        f({ id: 'cpu-hotspot:stable', severity: 'info' }),
      ],
    });
    const current = report({
      findings: [
        f({ id: 'cpu-hotspot:b', severity: 'critical' }), // changed (worse)
        f({ id: 'cpu-hotspot:stable', severity: 'info' }), // unchanged
        f({ id: 'cpu-hotspot:c', severity: 'warning' }), // added
      ],
    });

    const diff = diffReports(baseline, current);
    expect(diff.findings.added.map((x) => x.id)).toEqual(['cpu-hotspot:c']);
    expect(diff.findings.removed.map((x) => x.id)).toEqual(['cpu-hotspot:a']);
    expect(diff.findings.changed.map((x) => x.id)).toEqual(['cpu-hotspot:b']);
    expect(diff.findings.changed[0]?.severityDirection).toBe('worse');
    expect(diff.findings.unchangedCount).toBe(1);
  });

  it('flags regression when a non-info finding is added', () => {
    const baseline = report({ findings: [] });
    const current = report({ findings: [f({ id: 'x', severity: 'critical' })] });
    expect(diffReports(baseline, current).regressed).toBe(true);
  });

  it('does not flag regression when only info findings are added', () => {
    const baseline = report({ findings: [] });
    const current = report({ findings: [f({ id: 'x', severity: 'info' })] });
    expect(diffReports(baseline, current).regressed).toBe(false);
  });

  it('flags regression when an existing finding worsens in severity', () => {
    const baseline = report({ findings: [f({ id: 'x', severity: 'warning' })] });
    const current = report({ findings: [f({ id: 'x', severity: 'critical' })] });
    expect(diffReports(baseline, current).regressed).toBe(true);
  });

  it('detects confidence and score changes', () => {
    const baseline = report({ findings: [f({ id: 'x', confidence: 'low', score: 50 })] });
    const current = report({ findings: [f({ id: 'x', confidence: 'high', score: 90 })] });
    const change = diffReports(baseline, current).findings.changed[0];
    expect(change?.confidenceFrom).toBe('low');
    expect(change?.confidenceTo).toBe('high');
    expect(change?.scoreFrom).toBe(50);
    expect(change?.scoreTo).toBe(90);
    expect(change?.severityDirection).toBe('same');
  });

  it('computes scalar deltas with correct direction', () => {
    const baseline = report({
      findings: [],
      cpu: { idleRatio: 0.1, gcRatio: 0.05 },
      memory: { rssSlope: 1000 },
    });
    const current = report({
      findings: [],
      cpu: { idleRatio: 0.3, gcRatio: 0.2 },
      memory: { rssSlope: 5000 },
    });
    const deltas = diffReports(baseline, current).scalarDeltas;
    const idle = deltas.find((d) => d.label === 'idle ratio');
    const gc = deltas.find((d) => d.label === 'GC ratio');
    const rss = deltas.find((d) => d.label === 'RSS slope (B/s)');
    // idle rose (more headroom) -> better (worseWhenHigher: false)
    expect(idle?.direction).toBe('better');
    // gc rose -> worse (worseWhenHigher: true)
    expect(gc?.direction).toBe('worse');
    // rss slope rose -> worse
    expect(rss?.direction).toBe('worse');
  });

  it('skips scalar deltas for kinds absent in either report', () => {
    const baseline = report({ findings: [], cpu: { idleRatio: 0.2 } });
    const current = report({ findings: [] }); // no cpu profile
    expect(diffReports(baseline, current).scalarDeltas).toEqual([]);
  });
});

describe('renderDiff', () => {
  const diff = diffReports(
    report({ findings: [f({ id: 'old', severity: 'warning' })] }),
    report({ findings: [f({ id: 'new', severity: 'critical' })] }),
  );

  it('renders json with a parseable regressed flag', () => {
    const parsed = JSON.parse(renderDiff(diff, 'json', false));
    expect(parsed.regressed).toBe(true);
    expect(parsed.findings.added).toHaveLength(1);
  });

  it('renders an agent frontmatter contract', () => {
    const agent = renderDiff(diff, 'agent', false);
    expect(agent.startsWith('---')).toBe(true);
    expect(agent).toContain('regressed: true');
    expect(agent).toContain('# Report Diff');
  });

  it('renders text and markdown headings', () => {
    expect(renderDiff(diff, 'text', false)).toContain('Result: REGRESSED');
    expect(renderDiff(diff, 'markdown', false)).toContain('## Findings');
  });
});
