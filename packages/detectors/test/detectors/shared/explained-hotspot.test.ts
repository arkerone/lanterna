import type { Finding, Hotspot } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { isHotspotExplainedByFindings } from '../../../src/detectors/shared/explained-hotspot.js';

describe('explained CPU hotspot', () => {
  it('treats attributed caller evidence as an explanation for the user hotspot', () => {
    const hotspot = cpuHotspot({ function: 'hashPassword', file: '/app/auth.js', line: 12 });
    const finding = cpuFinding({
      category: 'sync-crypto',
      evidence: {
        file: 'node:crypto',
        line: 0,
        function: 'pbkdf2Sync',
        selfPct: 60,
        extra: {
          userCaller: { function: 'hashPassword', file: '/app/auth.js', line: 12 },
        },
      },
    });

    expect(isHotspotExplainedByFindings(hotspot, [finding])).toBe(true);
  });

  it('ignores non-specific CPU findings', () => {
    const hotspot = cpuHotspot({ function: 'hashPassword', file: '/app/auth.js', line: 12 });
    const finding = cpuFinding({
      category: 'event-loop-stall',
      evidence: { file: '/app/auth.js', line: 12, function: 'hashPassword', selfPct: 60 },
    });

    expect(isHotspotExplainedByFindings(hotspot, [finding])).toBe(false);
  });
});

function cpuHotspot(input: Pick<Hotspot, 'function' | 'file' | 'line'>): Hotspot {
  return {
    id: `${input.file}:${input.line}:${input.function}`,
    function: input.function,
    file: input.file,
    line: input.line,
    category: 'user',
    selfPct: 60,
    totalPct: 60,
  };
}

function cpuFinding(input: { category: string; evidence: Finding['evidence'] }): Finding {
  return {
    id: `${input.category}:test`,
    profileKind: 'cpu',
    severity: 'warning',
    category: input.category,
    title: input.category,
    evidence: input.evidence,
    why: 'test',
    suggestion: 'test',
    references: [],
  };
}
