import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function tsFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...tsFilesUnder(path));
      continue;
    }
    if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function matchingFiles(dir: string, pattern: RegExp): string[] {
  return tsFilesUnder(join(repoRoot, dir))
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(repoRoot, file));
}

describe('package architecture boundaries', () => {
  it('keeps core independent from the detector pack', () => {
    expect(matchingFiles('packages/core/src', /@lanterna-profiler\/detectors/)).toEqual([]);
  });

  it('keeps capture orchestration out of detectors', () => {
    expect(
      matchingFiles(
        'packages/detectors/src',
        /\b(runCapture|SpawnSource|AttachSource|createManualStopSignal|buildLanternaReport)\b/,
      ),
    ).toEqual([]);
  });

  it('keeps CLI on core for profile execution', () => {
    expect(
      matchingFiles(
        'packages/cli/src',
        /import\s+\{[^}]*\b(runProfile|attachProfile|createDefaultKindRegistry)\b[^}]*\}\s+from\s+['"]@lanterna-profiler\/detectors['"]/s,
      ),
    ).toEqual([]);
  });
});
