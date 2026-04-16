import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
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
  assert.ok(Date.now() - startedAt < 8_000, 'unsupported inspector runs should fail within the inspector startup window');
  const stderr = String(failure.stderr ?? '');
  if (stderr.length > 0) {
    assert.match(
      stderr,
      /(unable to start Node inspector for target process: .*Lanterna requires Node inspector support|target exited before inspector was ready .*operation not permitted|timed out waiting for inspector URL .*operation not permitted)/,
    );
  }
}

async function pidAttachSupportedInEnvironment(): Promise<boolean> {
  if (process.platform === 'win32') {
    return false;
  }

  try {
    const response = await fetch('http://127.0.0.1:9229/json/list');
    if (!response.ok) return true;
    const targets = await response.json() as Array<{ webSocketDebuggerUrl?: string }>;
    return targets.length === 0;
  } catch {
    return true;
  }
}

async function spawnFixture(args: string[]): Promise<ChildProcess> {
  const child = spawn('node', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.setEncoding('utf8');
  return child;
}

async function waitForInspectorUrl(child: ChildProcess, timeoutMs = 5_000): Promise<string> {
  const stderr = child.stderr;
  assert.ok(stderr, 'expected child stderr pipe');

  return await new Promise<string>((resolveUrl, reject) => {
    let settled = false;
    let buffer = '';
    const timeout = setTimeout(() => {
      rejectOnce(new Error(`timed out waiting for inspector URL. stderr=${buffer}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      stderr.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };

    const rejectOnce = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const resolveOnce = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveUrl(url);
    };

    const onData = (chunk: string | Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/Debugger listening on (ws:\/\/[^\s]+)/);
      if (match?.[1]) resolveOnce(match[1]);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      rejectOnce(new Error(`fixture exited before inspector was ready (code=${code}, signal=${signal})`));
    };

    const onError = (err: Error) => rejectOnce(err);

    stderr.on('data', onData);
    child.on('exit', onExit);
    child.on('error', onError);
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

interface SpawnedCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

async function runLanternaAndSignal(
  args: string[],
  stopSignal: NodeJS.Signals,
  delayMs = 700,
): Promise<SpawnedCommandResult> {
  const child = spawn('node', [binPath, ...args], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const stopTimer = setTimeout(() => {
    if (child.exitCode === null) {
      child.kill(stopSignal);
    }
  }, delayMs);

  return await new Promise<SpawnedCommandResult>((resolveResult, reject) => {
    child.once('error', (error) => {
      clearTimeout(stopTimer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(stopTimer);
      resolveResult({ code, signal, stdout, stderr });
    });
  });
}

function isPidAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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

  it('attaches to an existing inspector URL', async () => {
    if (!await inspectorSupported()) {
      return;
    }

    const child = await spawnFixture(['--inspect=0', resolve(fixturesDir, 'event-loop-stall-app.mjs')]);
    const wsUrl = await waitForInspectorUrl(child);

    try {
      const { stdout } = await execFileAsync(
        'node',
        [binPath, 'attach', '--inspect-url', wsUrl, '--duration', '1200ms', '--pretty'],
        { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
      );

      const report = JSON.parse(stdout);
      assert.equal(report.meta.mode, 'attach');
      assert.equal(report.meta.captureIntegrity.controlChannel, false);
      assert.equal(report.meta.pid, child.pid);
      assert.equal(report.meta.command.length, 0);
      assert.equal(report.eventLoop.available, true);
      assert.ok(report.eventLoop.stallIntervals.length > 0);
    } finally {
      await terminateChild(child);
    }
  });

  it('attaches to an existing pid via SIGUSR1', async () => {
    if (!await inspectorSupported() || !await pidAttachSupportedInEnvironment()) {
      return;
    }

    const child = await spawnFixture([resolve(fixturesDir, 'event-loop-stall-app.mjs')]);

    try {
      const { stdout } = await execFileAsync(
        'node',
        [binPath, 'attach', '--pid', String(child.pid), '--duration', '1200ms', '--pretty'],
        { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
      );

      const report = JSON.parse(stdout);
      assert.equal(report.meta.mode, 'attach');
      assert.equal(report.meta.pid, child.pid);
      assert.equal(report.meta.captureIntegrity.controlChannel, false);
      assert.equal(report.eventLoop.available, true);
      assert.ok(report.eventLoop.stallIntervals.length > 0);
    } finally {
      await terminateChild(child);
    }
  });

  it('writes a report and stops the spawned target on SIGINT', async () => {
    if (!await inspectorSupported()) {
      return;
    }

    const result = await runLanternaAndSignal(
      ['run', '--pretty', '--', 'node', resolve(fixturesDir, 'event-loop-stall-app.mjs')],
      'SIGINT',
    );

    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    const report = JSON.parse(result.stdout);
    assert.equal(report.meta.mode, 'spawn');
    assert.ok(report.meta.durationMs > 0);
    assert.equal(isPidAlive(report.meta.pid), false);
  });

  it('writes a single JSON file on SIGTERM in attach mode and keeps the target alive', async () => {
    if (!await inspectorSupported()) {
      return;
    }

    const child = await spawnFixture(['--inspect=0', resolve(fixturesDir, 'event-loop-stall-app.mjs')]);
    const wsUrl = await waitForInspectorUrl(child);
    const outputDir = await mkdtemp(join(tmpdir(), 'lanterna-live-'));
    const outputPath = join(outputDir, 'attach-report.json');

    try {
      const result = await runLanternaAndSignal(
        ['attach', '--inspect-url', wsUrl, '--output', outputPath, '--pretty', '--duration', '30s'],
        'SIGTERM',
      );

      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, '');
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.meta.mode, 'attach');
      assert.equal(report.meta.pid, child.pid);
      assert.equal(isPidAlive(child.pid), true);
    } finally {
      await terminateChild(child);
    }
  });
});
