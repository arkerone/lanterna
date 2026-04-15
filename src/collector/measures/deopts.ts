import type { RawDeopt } from '../source.js';

// Parses V8 --trace-deopt output. Format (approx):
//   [marking 0x... <function> for deoptimization]
//   [bailout (kind: <kind>, reason: <reason>): begin ... <function> at <file>:<line>]
// We extract the last well-formed bailout line per function+location.
export function parseDeoptsFromStderr(stderr: string): RawDeopt[] {
  const lines = stderr.split('\n');
  const reBailout = /bailout .*?kind:\s*([^,]+),\s*reason:\s*([^\)]+)\).*?<[^>]*>\s+(\S+)\s+at\s+(\S+):(\d+)/i;
  const reDeopt = /deoptimiz\w+\s+.*?\(([^)]+)\):\s*(?:begin|end)\s+\S+\s+<[^>]*>\s+(\S+).*?reason:\s*([^,;]+)/i;
  // Map<key, RawDeopt & { count: number }>
  const counts = new Map<string, RawDeopt & { count: number }>();

  for (const line of lines) {
    let m = reBailout.exec(line);
    if (m) {
      const key = `${m[3]}@${m[4]}:${m[5]}|${m[2]}`;
      const existing = counts.get(key);
      if (existing) { existing.count += 1; continue; }
      counts.set(key, {
        function: m[3] ?? '',
        file: m[4] ?? '',
        line: Number(m[5]) || 0,
        reason: (m[2] ?? '').trim(),
        bailoutType: (m[1] ?? '').trim(),
        count: 1,
      });
      continue;
    }
    m = reDeopt.exec(line);
    if (m) {
      const key = `${m[2]}|${m[3]}`;
      const existing = counts.get(key);
      if (existing) { existing.count += 1; continue; }
      counts.set(key, {
        function: m[2] ?? '',
        file: '',
        line: 0,
        reason: (m[3] ?? '').trim(),
        bailoutType: (m[1] ?? '').trim(),
        count: 1,
      });
    }
  }

  return Array.from(counts.values());
}
