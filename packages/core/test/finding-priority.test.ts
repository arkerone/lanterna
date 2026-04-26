import { describe, expect, it } from 'vitest';
import { sortFindings } from '../src/analysis/core/pipeline.js';
import type { Finding } from '../src/report/types.js';

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 'finding',
    severity: 'warning',
    category: 'custom',
    title: 'Finding',
    evidence: { file: '/app/index.js', line: 1, function: 'handler', selfPct: 1 },
    measurements: {
      observed: { totalPct: 15 },
      thresholds: { minTotalPct: 5 },
    },
    why: 'why',
    suggestion: 'fix',
    references: [],
    ...overrides,
  } as Finding;
}

describe('sortFindings', () => {
  it('computes priority and prefers higher measured impact over severity alone', () => {
    const sorted = sortFindings(
      [
        finding({
          id: 'critical-low-impact',
          severity: 'critical',
          measurements: {
            observed: { totalPct: 2 },
            thresholds: { minTotalPct: 1 },
          },
        }),
        finding({
          id: 'warning-high-impact',
          severity: 'warning',
          evidence: { file: '/app/index.js', line: 1, function: 'handler', selfPct: 15 },
          measurements: {
            observed: { totalPct: 18 },
            thresholds: { minTotalPct: 3 },
          },
        }),
      ],
      1_000,
    );

    expect(sorted[0]?.id).toBe('warning-high-impact');
    expect(sorted[0]?.priority?.score).toBeGreaterThan(sorted[1]?.priority?.score ?? 0);
    expect(sorted[0]?.priority?.actionConfidence).toBe('medium');
    expect(sorted[0]?.priority?.impactEstimateMs).toBe(180);
  });

  it('downranks low-confidence histogram-only findings below strongly attributed work', () => {
    const sorted = sortFindings([
      finding({
        id: 'event-loop-histogram-only',
        severity: 'critical',
        category: 'event-loop-stall',
        evidence: {
          file: '',
          line: 0,
          function: 'event loop',
          selfPct: 0,
          extra: { proofLevel: 'aggregate-correlation', measurementBasis: 'histogram' },
        },
        measurements: {
          observed: { maxLagMs: 450 },
          thresholds: { maxLowConfidence: 400 },
        },
      }),
      finding({
        id: 'sync-crypto-attributed',
        severity: 'warning',
        category: 'sync-crypto',
        evidence: {
          file: '/app/auth.js',
          line: 10,
          function: 'hashPassword',
          selfPct: 12,
          extra: { attributionConfidence: 'high' },
        },
        measurements: {
          observed: { totalPct: 9 },
          thresholds: { minTotalPct: 1 },
        },
      }),
    ]);

    expect(sorted[0]?.id).toBe('sync-crypto-attributed');
    expect(sorted[0]?.priority?.actionConfidence).toBe('high');
  });

  it('uses memory-specific threshold pairs instead of raw MB or ratio fallback', () => {
    const sorted = sortFindings([
      finding({
        id: 'external-buffer-pressure',
        category: 'external-buffer-pressure',
        measurements: {
          observed: { ratio: 1.2, externalMeanMB: 48 },
          thresholds: { warnRatio: 0.5, minExternalMeanMB: 32 },
        },
      }),
      finding({
        id: 'memory-growth:rss',
        category: 'memory-growth',
        measurements: {
          observed: { slopeMBPerSec: 2.5 },
          thresholds: { warnMBPerSec: 1 },
        },
      }),
    ]);

    expect(sorted.map((f) => f.id)).toEqual(['memory-growth:rss', 'external-buffer-pressure']);
    expect(sorted[0]?.priority?.score).toBe(250);
    expect(sorted[1]?.priority?.score).toBe(240);
  });
});
