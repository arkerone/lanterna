import type { RawDeopt } from '../collector/source.js';
import type { DeoptEntry } from '../report/types.js';

const EXPLAIN: Record<string, string> = {
  'not a Smi': 'Function expected a small integer but got a non-Smi (float, boxed number, or other type). Keep numeric arguments as integers.',
  'wrong map': 'Object shape changed between calls. V8 specialised on one hidden class; a different shape arrived.',
  'minus zero': 'Result was -0 where +0 was assumed. Normalise with `value + 0` or guard the path.',
  'out of bounds': 'Array access beyond length. Check bounds before indexing on hot paths.',
  'not a heap number': 'Expected a boxed number, got a Smi or non-number. Stabilise types.',
  'insufficient type feedback': 'Call site did not see enough consistent types to optimise. Avoid polymorphic arguments.',
  'Insufficient type feedback for call': 'Call site polymorphic or too cold to optimise. Stabilise callee.',
};

export function enrichDeopts(raw: RawDeopt[]): DeoptEntry[] {
  // parseDeoptsFromStderr already deduplicates and counts; just enrich with explanation.
  return raw
    .map((d) => ({
      function: d.function,
      file: d.file,
      line: d.line,
      reason: d.reason,
      bailoutType: d.bailoutType,
      count: d.count,
      explanation: explain(d.reason),
    }))
    .sort((a, b) => b.count - a.count);
}

function explain(reason: string): string {
  const exact = EXPLAIN[reason];
  if (exact) return exact;
  const trimmed = reason.trim();
  for (const [k, v] of Object.entries(EXPLAIN)) {
    if (trimmed.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return `Function was deoptimised (${reason}). Inspect call-site types and object shapes.`;
}
