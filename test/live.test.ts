import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const binPath = resolve(repoRoot, 'bin', 'lanterna.js');
const fixturesDir = resolve(repoRoot, 'test', 'fixtures');
let inspectorSupportPromise: Promise<boolean> | undefined;

interface ExecFileFailure extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
}

async function inspectorSupported(): Promise<boolean> {
  inspectorSupportPromise ??= detectInspectorSupport();
  return inspectorSupportPromise;
}

async function detectInspectorSupport(): Promise<boolean> {
  try {
    const { stderr } = await execFileAsync(
      'node',
      ['--inspect=0', '-e', ''],
      { cwd: repoRoot, timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    return /Debugger listening on ws:\/\//.test(stderr);
  } catch (err) {
    return /Debugger listening on ws:\/\//.test(String((err as ExecFileFailure).stderr ?? ''));
  }
}

async function expectInspectorFailure(args: string[]): Promise<void> {
  let failure: ExecFileFailure | undefined;
  const startedAt = Date.now();
  try {
    await execFileAsync(
      'node',
      [binPath, ...args],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );
  } catch (err) {
    failure = err as ExecFileFailure;
  }

  assert.ok(failure, 'expected lanterna run to fail when inspector is unavailable');
  assert.equal(failure.code, 1);
  assert.equal(failure.killed, false);
  assert.ok(Date.now() - startedAt < 2_000, 'unsupported inspector runs should fail fast');
  const stderr = String(failure.stderr ?? '');
  if (stderr.length > 0) {
    assert.match(
      stderr,
      /unable to start Node inspector for target process: .*Lanterna requires Node inspector support/,
    );
  }
}

describe('live profiling', () => {
  it('supports the no-duration path on a short-lived process', async () => {
    if (!await inspectorSupported()) {
      await expectInspectorFailure(['run', '--pretty', '--', 'node', '-e', 'let x=0; for (let i=0;i<5e6;i++) x+=i;']);
      return;
    }

    const { stdout } = await execFileAsync(
      'node',
      [binPath, 'run', '--pretty', '--', 'node', '-e', 'let x=0; for (let i=0;i<5e6;i++) x+=i;'],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );

    const report = JSON.parse(stdout);
    assert.equal(report.meta.mode, 'spawn');
    assert.equal(report.meta.captureIntegrity.controlChannel, true);
    assert.ok(report.meta.durationMs > 0);
  });

  it('captures real event-loop stalls and correlated hotspots', async () => {
    if (!await inspectorSupported()) {
      await expectInspectorFailure(['run', '--duration', '1200ms', '--pretty', '--', 'node', resolve(fixturesDir, 'event-loop-stall-app.mjs')]);
      return;
    }

    const { stdout } = await execFileAsync(
      'node',
      [binPath, 'run', '--duration', '1200ms', '--pretty', '--', 'node', resolve(fixturesDir, 'event-loop-stall-app.mjs')],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );

    const report = JSON.parse(stdout);
    assert.equal(report.eventLoop.available, true);
    assert.ok(report.eventLoop.stallIntervals.length > 0);
    assert.ok(report.eventLoop.correlatedHotspots.length > 0);
    assert.match(report.eventLoop.correlatedHotspots[0].function, /busyWait|tick/);
    assert.ok(report.findings.some((finding: { id: string }) => finding.id === 'event-loop-stall'));
  });

  it('attributes sync crypto findings to the user caller on live runs', async () => {
    if (!await inspectorSupported()) {
      await expectInspectorFailure(['run', '--duration', '1200ms', '--pretty', '--', 'node', resolve(fixturesDir, 'sync-crypto-app.mjs')]);
      return;
    }

    const { stdout } = await execFileAsync(
      'node',
      [binPath, 'run', '--duration', '1200ms', '--pretty', '--', 'node', resolve(fixturesDir, 'sync-crypto-app.mjs')],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );

    const report = JSON.parse(stdout);
    const finding = report.findings.find((candidate: { id: string }) => candidate.id === 'sync-crypto-on-hot-path');
    assert.ok(finding, 'expected sync-crypto-on-hot-path finding');
    assert.match(finding.evidence.function, /hashPassword/);
    assert.equal(finding.evidence.extra.attributionConfidence, 'high');
    assert.ok(
      report.eventLoop.measurementBasis === 'none'
      || report.eventLoop.measurementBasis === 'histogram'
      || report.eventLoop.measurementBasis === 'both',
    );
  });
});
