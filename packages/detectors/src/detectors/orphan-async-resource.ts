import type { BaseFinding, Finding, KindScopedDetector } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import { anchorForFrame, asyncConfidence, asyncEvidenceExtra } from './async-evidence.js';

/**
 * Fires when many async resources never destroy/resolve before flush. A
 * handful is normal (pending sockets, etc.); a sustained pile is a leak
 * signature — listeners not removed, promises pending on dropped I/O.
 *
 * Anchors the finding on the dominant init frame when stacks are available,
 * so the agent can navigate to the leaking call site directly.
 */
export const orphanAsyncResourceDetector: KindScopedDetector<'async'> = {
  id: 'orphan-async-resource',
  kindIds: ['async'],
  detect({ async }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.orphanAsyncResource;
    const report = async.report;
    if (!report.summary.available) return [];
    const aged = report.orphans.filter((o) => o.ageMs >= thresholds.minOrphanAgeMs);
    if (aged.length < thresholds.minOrphans) return [];

    // `aged` is capped by the analysis layer (top N by ageMs); for severity
    // gating we use the true total from the integrity counter so that very
    // large leaks still escalate to `critical`.
    const totalOrphans = Math.max(aged.length, report.summary.orphanCount);
    const dropped = report.summary.recordsDropped > 0;
    const severity: BaseFinding['severity'] =
      totalOrphans >= thresholds.criticalOrphans ? 'critical' : 'warning';
    const byKind = aged.reduce<Record<string, number>>((acc, o) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1;
      return acc;
    }, {});
    const dominantKind =
      Object.entries(byKind).sort((a, b) => b[1] - a[1])[0]?.[0] ?? aged[0]?.kind ?? 'other';

    // Find the most common init frame across the aged orphans — that's
    // typically the call site that's leaking.
    const frameCounts = new Map<
      string,
      { count: number; sample: NonNullable<(typeof aged)[number]['initFrame']> }
    >();
    for (const o of aged) {
      if (!o.initFrame) continue;
      const key = `${o.initFrame.file}:${o.initFrame.line}:${o.initFrame.function}`;
      const entry = frameCounts.get(key);
      if (entry) entry.count += 1;
      else frameCounts.set(key, { count: 1, sample: o.initFrame });
    }
    const dominantFrame = [...frameCounts.values()].sort((a, b) => b.count - a.count)[0];

    const baseConfidence: BaseFinding['confidence'] =
      totalOrphans >= thresholds.minOrphans * 2 ? 'high' : 'medium';
    const anchor = anchorForFrame(report, dominantFrame?.sample);
    const frame = anchor.frame;
    const confidence: BaseFinding['confidence'] = dropped
      ? 'low'
      : asyncConfidence(report, baseConfidence);

    return [
      {
        id: 'orphan-async-resource',
        profileKind: 'async',
        severity,
        category: 'orphan-async-resource',
        title: frame
          ? `${totalOrphans} async resources leaked from \`${frame.function}\``
          : `${totalOrphans} async resources never resolved (>${thresholds.minOrphanAgeMs}ms old)`,
        confidence,
        proofLevel: 'direct-sample',
        evidence: {
          file: frame?.file ?? '(async)',
          line: frame?.line ?? 0,
          function: frame?.function ?? `orphans:${dominantKind}`,
          selfPct: 0,
          extra: {
            orphanCount: totalOrphans,
            sampleOrphanCount: aged.length,
            byKind,
            dominantKind,
            dominantFrameOccurrences: dominantFrame?.count ?? 0,
            ...asyncEvidenceExtra(report, anchor),
            samplePeak: aged.slice(0, 10).map((o) => ({
              asyncId: o.asyncId,
              kind: o.kind,
              rawType: o.rawType,
              ageMs: o.ageMs,
              triggerAsyncId: o.triggerAsyncId,
              initFrame: o.initFrame,
            })),
          },
        },
        measurements: {
          observed: {
            orphanCount: totalOrphans,
            sampleOrphanCount: aged.length,
          },
          thresholds: {
            minOrphans: thresholds.minOrphans,
            criticalOrphans: thresholds.criticalOrphans,
            minOrphanAgeMs: thresholds.minOrphanAgeMs,
          },
        },
        why: dominantFrame
          ? `${totalOrphans} async resources of family \`${dominantKind}\` were initialized but never destroyed. ${dominantFrame.count} of the sampled ones came from \`${dominantFrame.sample.function}\` at \`${dominantFrame.sample.file}:${dominantFrame.sample.line}\` — that frame is leaking.${dropped ? ' (recordsDropped > 0; this is a lower bound.)' : ''}`
          : `${totalOrphans} async resources were initialized but never resolved or destroyed before the capture ended (oldest > ${thresholds.minOrphanAgeMs}ms). The dominant family is \`${dominantKind}\`.${dropped ? ' (recordsDropped > 0; this is a lower bound.)' : ''}`,
        suggestion: dominantFrame
          ? `Open \`${dominantFrame.sample.file}:${dominantFrame.sample.line}\` and ensure every \`on()\` has a matching \`off()\`/\`removeListener\`, every socket has a \`close\`/\`destroy\` path, and every promise resolves or rejects.`
          : `Inspect handlers that allocate resources of kind \`${dominantKind}\`: ensure listeners are removed, sockets closed, and promises bound to a timeout that rejects them.`,
        references: [
          'https://nodejs.org/api/async_hooks.html#asyncresource',
          'https://nodejs.org/api/events.html#emitterremovelistenereventname-listener',
        ],
      },
    ];
  },
};
