import type { RawDeopt } from './types.js';

// Parses V8 --trace-deopt output. Format (approx):
//   [marking 0x... <function> for deoptimization]
//   [bailout (kind: <kind>, reason: <reason>): begin ... <function> at <file>:<line>]
// We extract the last well-formed bailout line per function+location.
export function parseDeoptsFromStderr(stderr: string): RawDeopt[] {
  const lines = stderr.split('\n');
  const bailoutPattern =
    /bailout .*?kind:\s*([^,]+),\s*reason:\s*([^)]+)\).*?<[^>]*>\s+(\S+)\s+at\s+(\S+):(\d+)/i;
  const genericBailoutPattern = /bailout .*?kind:\s*([^,]+),\s*reason:\s*([^)]+)\)/i;
  const deoptPattern =
    /deoptimiz\w+\s+.*?\(([^)]+)\):\s*(?:begin|end)\s+\S+\s+<[^>]*>\s+(\S+).*?reason:\s*([^,;]+)/i;
  const deoptCountsByKey = new Map<string, RawDeopt & { count: number }>();

  for (const line of lines) {
    let match = bailoutPattern.exec(line);
    if (match) {
      const key = `${match[3]}@${match[4]}:${match[5]}|${match[2]}`;
      const existing = deoptCountsByKey.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      deoptCountsByKey.set(key, {
        function: match[3] ?? '',
        file: match[4] ?? '',
        line: Number(match[5]) || 0,
        reason: (match[2] ?? '').trim(),
        bailoutType: (match[1] ?? '').trim(),
        count: 1,
      });
      continue;
    }

    match = genericBailoutPattern.exec(line);
    if (match) {
      const reason = (match[2] ?? '').trim();
      const key = `<unknown>|${reason}`;
      const existing = deoptCountsByKey.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      deoptCountsByKey.set(key, {
        function: '<unknown>',
        file: '',
        line: 0,
        reason,
        bailoutType: (match[1] ?? '').trim(),
        count: 1,
      });
      continue;
    }

    match = deoptPattern.exec(line);
    if (!match) continue;
    const key = `${match[2]}|${match[3]}`;
    const existing = deoptCountsByKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    deoptCountsByKey.set(key, {
      function: match[2] ?? '',
      file: '',
      line: 0,
      reason: (match[3] ?? '').trim(),
      bailoutType: (match[1] ?? '').trim(),
      count: 1,
    });
  }

  return Array.from(deoptCountsByKey.values());
}
