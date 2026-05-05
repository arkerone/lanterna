import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RawDeopt } from '../../capture/core/types.js';
import type { DeoptEntry } from '../../report/types.js';
import type { SourceMapResolver } from '../sourcemap/resolver.js';

const EXPLAIN: Record<string, string> = {
  'not a Smi':
    'Function expected a small integer but got a non-Smi (float, boxed number, or other type). Keep numeric arguments as integers.',
  'wrong map':
    'Object shape changed between calls. V8 specialised on one hidden class; a different shape arrived.',
  'minus zero': 'Result was -0 where +0 was assumed. Normalise with `value + 0` or guard the path.',
  'out of bounds': 'Array access beyond length. Check bounds before indexing on hot paths.',
  'not a heap number': 'Expected a boxed number, got a Smi or non-number. Stabilise types.',
  'insufficient type feedback':
    'Call site did not see enough consistent types to optimise. Avoid polymorphic arguments.',
  'Insufficient type feedback for call':
    'Call site polymorphic or too cold to optimise. Stabilise callee.',
};

export function enrichDeopts(raw: RawDeopt[], sourceMaps?: SourceMapResolver): DeoptEntry[] {
  // V8 stderr emits absolute paths; the source-map resolver keys on the URL
  // form used by V8 callFrame.url (`file://` URLs). Normalize before lookup.
  const candidateUrls = sourceMaps
    ? Array.from(new Set(raw.map(deoptUrl).filter((u): u is string => Boolean(u))))
    : [];
  if (sourceMaps && candidateUrls.length > 0) sourceMaps.prepare(candidateUrls);

  return raw
    .map((deopt) => {
      const entry: DeoptEntry = {
        function: deopt.function,
        file: deopt.file,
        line: deopt.line,
        reason: deopt.reason,
        bailoutType: deopt.bailoutType,
        count: deopt.count,
        explanation: explain(deopt.reason),
      };
      if (sourceMaps && deopt.line > 0) {
        const url = deoptUrl(deopt);
        if (url) {
          const resolved = sourceMaps.resolve(url, deopt.line, 1);
          if (resolved) entry.source = resolved;
        }
      }
      return entry;
    })
    .sort((a, b) => b.count - a.count);
}

function deoptUrl(deopt: RawDeopt): string | undefined {
  const file = deopt.file;
  if (!file) return undefined;
  if (file.startsWith('file://')) return file;
  if (isAbsolute(file)) return pathToFileURL(file).href;
  return undefined;
}

function explain(reason: string): string {
  const exact = EXPLAIN[reason];
  if (exact) return exact;
  const trimmed = reason.trim();
  for (const [knownReason, explanation] of Object.entries(EXPLAIN)) {
    if (trimmed.toLowerCase().includes(knownReason.toLowerCase())) return explanation;
  }
  return `Function was deoptimised (${reason}). Inspect call-site types and object shapes.`;
}
