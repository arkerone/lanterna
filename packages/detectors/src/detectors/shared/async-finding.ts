import type {
  AsyncProfileReport,
  AsyncStackFrameReport,
  BaseFinding,
  Finding,
  FindingMeasurements,
  UserCallerAttribution,
} from '@lanterna-profiler/core';
import { type AsyncAnchor, asyncConfidence, asyncEvidenceExtra } from './async-evidence.js';

type AsyncFindingConfidence = NonNullable<BaseFinding['confidence']>;
type AsyncFindingProofLevel = NonNullable<BaseFinding['proofLevel']>;

interface AsyncFindingFallbackFrame {
  readonly file: string;
  readonly line: number;
  readonly function: string;
  readonly source?: AsyncStackFrameReport['source'];
}

export interface BuildAsyncFindingArgs {
  readonly report: AsyncProfileReport;
  readonly anchor: AsyncAnchor;
  readonly frame?: AsyncStackFrameReport;
  readonly fallback?: AsyncFindingFallbackFrame;
  readonly userCaller?: UserCallerAttribution;
  readonly id: string;
  readonly severity: BaseFinding['severity'];
  readonly category: string;
  readonly title: string;
  readonly confidence: AsyncFindingConfidence;
  readonly proofLevel: AsyncFindingProofLevel;
  readonly selfPct?: number;
  readonly extra: Record<string, unknown>;
  readonly measurements?: FindingMeasurements;
  readonly why: string;
  readonly suggestion: string;
  readonly references: string[];
}

/**
 * Builds the repeated async finding evidence shell: frame anchor, optional
 * user caller, and capture-quality evidence. The detector still owns the
 * trigger, wording, thresholds, and category-specific fields.
 */
export function buildAsyncFinding(
  args: BuildAsyncFindingArgs,
): BaseFinding<string, Record<string, unknown>> {
  const frame = args.frame ??
    args.fallback ?? {
      file: '(async)',
      line: 0,
      function: '(async)',
    };
  return {
    id: args.id,
    profileKind: 'async',
    severity: args.severity,
    category: args.category,
    title: args.title,
    confidence: args.confidence,
    proofLevel: args.proofLevel,
    evidence: {
      file: frame.file,
      line: frame.line,
      function: frame.function,
      selfPct: args.selfPct ?? 0,
      ...(frame.source ? { source: frame.source } : {}),
      extra: {
        ...args.extra,
        ...(args.userCaller ? { userCaller: args.userCaller } : {}),
        ...asyncEvidenceExtra(args.report, args.anchor),
      },
    },
    ...(args.measurements ? { measurements: args.measurements } : {}),
    why: args.why,
    suggestion: args.suggestion,
    references: args.references,
  };
}

/**
 * The outcome an async list detector returns for one ranked item: emit a
 * finding, skip this item (keep scanning), or stop the scan because every
 * remaining item is smaller (the sorted-desc early break).
 */
export type AsyncListOutcome =
  | { readonly action: 'emit'; readonly finding: BuildAsyncFindingArgs }
  | { readonly action: 'skip' }
  | { readonly action: 'stop' };

/** Skip this item but keep scanning the ranked list. */
export const skipAsyncItem: AsyncListOutcome = { action: 'skip' };

/** Stop scanning: the list is sorted desc, so every remaining item is smaller. */
export const stopAsyncList: AsyncListOutcome = { action: 'stop' };

/** Emit a finding from the assembled {@link buildAsyncFinding} args. */
export function emitAsyncFinding(finding: BuildAsyncFindingArgs): AsyncListOutcome {
  return { action: 'emit', finding };
}

/**
 * The capped iterate → skip/stop → assemble loop shared by every async detector
 * that ranks a list of entities (operations, chains, attribution roots) and
 * emits one finding each. The detector owns only the per-item decision via
 * `evaluate`; this owns the `maxFindings` cap, the skip-vs-stop control flow,
 * and the {@link buildAsyncFinding} call so all four list detectors emit through
 * one seam.
 */
export function collectAsyncListFindings<T>(
  items: Iterable<T>,
  maxFindings: number,
  evaluate: (item: T) => AsyncListOutcome,
): Finding[] {
  const findings: Finding[] = [];
  for (const item of items) {
    if (findings.length >= maxFindings) break;
    const outcome = evaluate(item);
    if (outcome.action === 'stop') break;
    if (outcome.action === 'skip') continue;
    findings.push(buildAsyncFinding(outcome.finding));
  }
  return findings;
}

export function confidenceForAsyncFinding(
  report: AsyncProfileReport,
  options: { base: AsyncFindingConfidence; dropped?: boolean },
): AsyncFindingConfidence {
  if (options.dropped ?? hasAsyncRecordLoss(report)) return 'low';
  return asyncConfidence(report, options.base) ?? options.base;
}

export function hasAsyncRecordLoss(report: AsyncProfileReport): boolean {
  return report.summary.recordsDropped > 0;
}
