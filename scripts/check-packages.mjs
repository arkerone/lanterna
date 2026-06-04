import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
const packedTarballs = [];
const packDir = await mkdtemp(resolve(tmpdir(), 'lanterna-pack-tarballs-'));

try {
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

    packedTarballs.push(await packWorkspace(workspace, packDir));
  }

  if (!failed) {
    await smokePackedPackages(packedTarballs);
  }

  if (failed) process.exitCode = 1;
} finally {
  await rm(packDir, { recursive: true, force: true });
}

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

async function packWorkspace(workspace, destination) {
  try {
    const { stdout } = await execFileAsync(
      'npm',
      ['pack', '--json', '--pack-destination', destination, '-w', workspace],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: npmCache },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const pack = JSON.parse(stdout);
    const entry = pack[0];
    if (!entry?.filename) throw new Error('npm pack did not return a filename');
    return resolve(destination, entry.filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to create npm pack tarball for ${workspace}: ${message}`);
  }
}

async function smokePackedPackages(tarballs) {
  const installDir = await mkdtemp(resolve(tmpdir(), 'lanterna-pack-smoke-'));
  try {
    await execFileAsync('npm', ['init', '-y'], {
      cwd: installDir,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
    });
    await execFileAsync(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        ...tarballs,
      ],
      {
        cwd: installDir,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: npmCache },
        maxBuffer: 16 * 1024 * 1024,
      },
    );

    await execFileAsync(
      process.execPath,
      [
        '-e',
        "const m = await import('@lanterna-profiler/core'); if (!m.runProfile) process.exit(1);",
      ],
      { cwd: installDir, encoding: 'utf8' },
    );
    await execFileAsync(
      process.execPath,
      [
        '-e',
        "const m = await import('@lanterna-profiler/detectors'); if (!m.defaultDetectors?.length) process.exit(1);",
      ],
      { cwd: installDir, encoding: 'utf8' },
    );
    await execFileAsync(
      process.execPath,
      [join(installDir, 'node_modules/@lanterna-profiler/cli/bin/lanterna.js'), '--help'],
      { cwd: installDir, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`packed package smoke test failed: ${message}`);
  } finally {
    await rm(installDir, { recursive: true, force: true });
  }
}
