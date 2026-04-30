import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCache = process.env.LANTERNA_NPM_CACHE ?? `${tmpdir()}/lanterna-npm-cache`;

const workspaces = [
  '@lanterna-profiler/core',
  '@lanterna-profiler/detectors',
  '@lanterna-profiler/cli',
];

let failed = false;

for (const workspace of workspaces) {
  const files = await dryRunPackFiles(workspace);
  const paths = files.map((file) => file.path);
  const errors = [];

  if (!paths.includes('LICENSE')) {
    errors.push('missing LICENSE in package tarball');
  }
  for (const path of paths) {
    if (path.endsWith('.tsbuildinfo')) {
      errors.push(`includes TypeScript build metadata: ${path}`);
    }
  }

  if (errors.length > 0) {
    failed = true;
    console.error(`${workspace}:`);
    for (const error of errors) console.error(`  - ${error}`);
  }
}

if (failed) process.exitCode = 1;

async function dryRunPackFiles(workspace) {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'lanterna-pack-check-'));
  const outputPath = resolve(tempDir, 'pack.json');
  try {
    await execFileAsync(
      'sh',
      [
        '-c',
        'npm_config_cache="$1" npm pack --dry-run --json -w "$2" > "$3"',
        'sh',
        npmCache,
        workspace,
        outputPath,
      ],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    const stdout = await readFile(outputPath, 'utf8');
    const pack = JSON.parse(stdout);
    const entry = pack[0];
    return entry.files ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stdout = typeof error === 'object' && error !== null ? error.stdout : undefined;
    const stderr = typeof error === 'object' && error !== null ? error.stderr : undefined;
    throw new Error(
      [
        `failed to dry-run npm pack for ${workspace}: ${message}`,
        stdout ? `stdout:\n${stdout}` : '',
        stderr ? `stderr:\n${stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
