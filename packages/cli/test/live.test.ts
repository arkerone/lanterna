import assert from 'node:assert/strict';
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, stripVTControlCharacters } from 'node:util';
import { describe, it } from 'vitest';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const binPath = resolve(repoRoot, 'bin', 'lanterna.js');
const fixturesDir = resolve(repoRoot, 'test', 'fixtures');
const deoptFixture = [
  'function churn(value) { return value.x + 1; }',
  '%PrepareFunctionForOptimization(churn);',
  'churn({ x: 1 });',
  'churn({ x: 2 });',
  '%OptimizeFunctionOnNextCall(churn);',
  'churn({ x: 3 });',
  'churn({ x: "4" });',
].join(' ');
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
    const { stderr } = await execFileAsync('node', ['--inspect=0', '-e', ''], {
      cwd: repoRoot,
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return /Debugger listening on ws:\/\//.test(stderr);
  } catch (err) {
    return /Debugger listening on ws:\/\//.test(String((err as ExecFileFailure).stderr ?? ''));
  }
}

async function expectInspectorFailure(args: string[]): Promise<void> {
  let failure: ExecFileFailure | undefined;
  const startedAt = Date.now();
  try {
    await execFileAsync('node', [binPath, ...args], {
      cwd: repoRoot,
      timeout: 10_000,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch (err) {
    failure = err as ExecFileFailure;
  }

  assert.ok(failure, 'expected lanterna run to fail when inspector is unavailable');
  assert.equal(failure.code, 1);
  assert.equal(failure.killed, false);
  assert.ok(
    Date.now() - startedAt < 8_000,
    'unsupported inspector runs should fail within the inspector startup window',
  );
  const stderr = String(failure.stderr ?? '');
  if (stderr.length > 0) {
    assert.ok(
      /(unable to start Node inspector for target process\. Lanterna requires Node inspector support|target exited before inspector was ready|timed out waiting for inspector URL)/.test(
        stderr,
      ),
      `expected inspector startup failure message in stderr: ${stderr}`,
    );
    assert.ok(
      /operation not permitted|not allowed in NODE_OPTIONS/.test(stderr),
      `expected underlying inspector failure in stderr: ${stderr}`,
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
    const targets = (await response.json()) as Array<{ webSocketDebuggerUrl?: string }>;
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
      rejectOnce(
        new Error(`fixture exited before inspector was ready (code=${code}, signal=${signal})`),
      );
    };

    const onError = (err: Error) => rejectOnce(err);

    stderr.on('data', onData);
    child.on('exit', onExit);
    child.on('error', onError);
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off('exit', resolveOnce);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1_000);
    child.once('exit', resolveOnce);
    if (child.exitCode !== null) resolveOnce();
    else child.kill('SIGTERM');
  });
}

interface SpawnedCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface CpuProfileLike {
  deopts: unknown[];
  eventLoop: {
    available: boolean;
    stallIntervals: unknown[];
    correlatedHotspots?: Array<{ function: string }>;
    measurementBasis?: 'none' | 'histogram' | 'both';
  };
}

interface ReportWithCpuProfile {
  profiles?: {
    cpu?: CpuProfileLike;
  };
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value);
}

function normalizeTerminalOutput(value: string): string {
  return stripAnsi(value).replace(/\r/g, '\n').trim();
}

function getCpuProfile(report: ReportWithCpuProfile): CpuProfileLike {
  const cpuProfile = report.profiles?.cpu;
  assert.ok(cpuProfile, 'expected cpu profile in report');
  return cpuProfile;
}

async function expectLanternaCommandFailure(
  args: string[],
  expectedMessage: string,
): Promise<void> {
  let failure: ExecFileFailure | undefined;
  try {
    await execFileAsync('node', [binPath, ...args], {
      cwd: repoRoot,
      timeout: 10_000,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch (err) {
    failure = err as ExecFileFailure;
  }

  assert.ok(failure, 'expected lanterna command to fail');
  assert.equal(failure.code, 1);
  assert.equal(failure.killed, false);
  assert.equal(String(failure.stdout ?? ''), '');
  const stderr = normalizeTerminalOutput(String(failure.stderr ?? ''));
  assert.equal(stderr.split('\n').at(-1), expectedMessage);
}

async function runLanternaAndSignal(
  args: string[],
  stopSignal: NodeJS.Signals,
  options: { delayMs?: number; signalAfterStderr?: RegExp } = {},
): Promise<SpawnedCommandResult> {
  const delayMs = options.delayMs ?? 700;
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
    const text = chunk.toString();
    stderr += text;
    if (options.signalAfterStderr?.test(normalizeTerminalOutput(stderr))) {
      sendSignal();
    }
  });

  let signalSent = false;
  const sendSignal = () => {
    if (signalSent) return;
    signalSent = true;
    if (child.exitCode === null) {
      child.kill(stopSignal);
    }
  };
  const stopTimer = setTimeout(sendSignal, delayMs);

  return await new Promise<SpawnedCommandResult>((resolveResult, reject) => {
    const hardTimeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `lanterna command did not exit after signal ${stopSignal}. stdout=${stdout} stderr=${stderr}`,
        ),
      );
    }, 15_000);
    child.once('error', (error) => {
      clearTimeout(stopTimer);
      clearTimeout(hardTimeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(stopTimer);
      clearTimeout(hardTimeout);
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
  it('rejects unknown profile kinds for run before capture starts', async () => {
    await expectLanternaCommandFailure(
      ['run', '--kind', 'nope', '--', 'node', '-e', 'setTimeout(() => {}, 10)'],
      'Lanterna profiling failed: unknown profile kind(s): nope. Available kinds: cpu, memory',
    );
  });

  it('rejects unknown profile kinds for attach before capture starts', async () => {
    await expectLanternaCommandFailure(
      [
        'attach',
        '--inspect-url',
        'ws://127.0.0.1:9229/test',
        '--kind',
        'nope',
        '--duration',
        '10ms',
      ],
      'Lanterna attach capture failed: unknown profile kind(s): nope. Available kinds: cpu, memory',
    );
  });

  it('supports the no-duration path on a short-lived process', async () => {
    if (!(await inspectorSupported())) {
      await expectInspectorFailure([
        'run',
        '--pretty',
        '--',
        'node',
        '-e',
        'let x=0; for (let i=0;i<5e6;i++) x+=i;',
      ]);
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

  it('relays target stderr while profiling a spawned process', async () => {
    if (!(await inspectorSupported())) {
      await expectInspectorFailure([
        'run',
        '--pretty',
        '--',
        'node',
        '-e',
        'console.error("lanterna-target-stderr-marker")',
      ]);
      return;
    }

    const { stderr } = await execFileAsync(
      'node',
      [
        binPath,
        'run',
        '--pretty',
        '--',
        'node',
        '-e',
        'console.error("lanterna-target-stderr-marker")',
      ],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );

    assert.match(stderr, /lanterna-target-stderr-marker/);
  });

  it('keeps target stdout and stderr on their original streams during deep spawned runs', async () => {
    if (!(await inspectorSupported())) {
      await expectInspectorFailure([
        'run',
        '--deep',
        '--pretty',
        '--',
        'node',
        '-e',
        'console.log("lanterna-target-stdout-marker"); console.error("lanterna-target-stderr-marker")',
      ]);
      return;
    }

    const tmp = await mkdtemp(join(tmpdir(), 'lanterna-deep-streams-'));
    const reportPath = join(tmp, 'report.json');
    const stdoutMarker = 'lanterna-target-stdout-marker';
    const stderrMarker = 'lanterna-target-stderr-marker';
    const { stdout, stderr } = await execFileAsync(
      'node',
      [
        binPath,
        'run',
        '--deep',
        '--pretty',
        '--output',
        reportPath,
        '--',
        'node',
        '-e',
        'console.log(process.env.LANTERNA_TEST_STDOUT_MARKER); console.error(process.env.LANTERNA_TEST_STDERR_MARKER)',
      ],
      {
        cwd: repoRoot,
        timeout: 10_000,
        maxBuffer: 1024 * 1024 * 4,
        env: {
          ...process.env,
          LANTERNA_TEST_STDOUT_MARKER: stdoutMarker,
          LANTERNA_TEST_STDERR_MARKER: stderrMarker,
        },
      },
    );

    assert.match(stdout, new RegExp(stdoutMarker));
    assert.doesNotMatch(stderr, new RegExp(stdoutMarker));
    assert.match(stderr, new RegExp(stderrMarker));
  });

  it('collects deopts from target diagnostic output during deep spawned runs', async () => {
    if (!(await inspectorSupported())) {
      await expectInspectorFailure([
        'run',
        '--deep',
        '--pretty',
        '--',
        'node',
        '--allow-natives-syntax',
        '-e',
        deoptFixture,
      ]);
      return;
    }

    const { stdout } = await execFileAsync(
      'node',
      [
        binPath,
        'run',
        '--deep',
        '--pretty',
        '--',
        'node',
        '--allow-natives-syntax',
        '-e',
        deoptFixture,
      ],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 8 },
    );

    const report = JSON.parse(stdout);
    const cpuProfile = getCpuProfile(report);
    assert.equal(report.meta.kinds.cpu.deep, true);
    assert.ok(cpuProfile.deopts.length > 0, 'expected --deep to parse target deopts');
  });

  it('captures real event-loop stalls and correlated hotspots', async () => {
    if (!(await inspectorSupported())) {
      await expectInspectorFailure([
        'run',
        '--duration',
        '1200ms',
        '--pretty',
        '--',
        'node',
        resolve(fixturesDir, 'event-loop-stall-app.mjs'),
      ]);
      return;
    }

    const { stdout } = await execFileAsync(
      'node',
      [
        binPath,
        'run',
        '--duration',
        '1200ms',
        '--pretty',
        '--',
        'node',
        resolve(fixturesDir, 'event-loop-stall-app.mjs'),
      ],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );

    const report = JSON.parse(stdout);
    const cpuProfile = getCpuProfile(report);
    const correlatedHotspots = cpuProfile.eventLoop.correlatedHotspots;
    assert.ok(Array.isArray(correlatedHotspots) && correlatedHotspots.length > 0);
    assert.equal(cpuProfile.eventLoop.available, true);
    assert.ok(cpuProfile.eventLoop.stallIntervals.length > 0);
    assert.match(correlatedHotspots[0].function, /busyWait|tick/);
    assert.ok(report.findings.some((finding: { id: string }) => finding.id === 'event-loop-stall'));
  });

  it('attributes sync crypto findings to the user caller on live runs', async () => {
    if (!(await inspectorSupported())) {
      await expectInspectorFailure([
        'run',
        '--duration',
        '1200ms',
        '--pretty',
        '--',
        'node',
        resolve(fixturesDir, 'sync-crypto-app.mjs'),
      ]);
      return;
    }

    const { stdout } = await execFileAsync(
      'node',
      [
        binPath,
        'run',
        '--duration',
        '1200ms',
        '--pretty',
        '--',
        'node',
        resolve(fixturesDir, 'sync-crypto-app.mjs'),
      ],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );

    const report = JSON.parse(stdout);
    const cpuProfile = getCpuProfile(report);
    const finding = report.findings.find(
      (candidate: { id: string }) => candidate.id === 'sync-crypto-on-hot-path',
    );
    assert.ok(finding, 'expected sync-crypto-on-hot-path finding');
    assert.match(finding.evidence.function, /hashPassword/);
    assert.equal(finding.evidence.extra.attributionConfidence, 'high');
    assert.equal(finding.evidence.extra.proofLevel, 'attributed-caller');
    assert.ok(
      cpuProfile.eventLoop.measurementBasis === 'none' ||
        cpuProfile.eventLoop.measurementBasis === 'histogram' ||
        cpuProfile.eventLoop.measurementBasis === 'both',
    );
  });

  it('attaches to an existing inspector URL with an explicit cpu kind', async () => {
    if (!(await inspectorSupported())) {
      return;
    }

    const child = await spawnFixture([
      '--inspect=0',
      resolve(fixturesDir, 'event-loop-stall-app.mjs'),
    ]);
    const wsUrl = await waitForInspectorUrl(child);

    try {
      const { stdout } = await execFileAsync(
        'node',
        [
          binPath,
          'attach',
          '--inspect-url',
          wsUrl,
          '--kind',
          'cpu',
          '--duration',
          '1200ms',
          '--pretty',
        ],
        { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
      );

      const report = JSON.parse(stdout);
      const cpuProfile = getCpuProfile(report);
      assert.equal(report.meta.mode, 'attach');
      assert.ok(report.meta.profileKinds.includes('cpu'));
      assert.equal(report.meta.captureIntegrity.controlChannel, false);
      assert.equal(report.meta.pid, child.pid);
      assert.equal(report.meta.command.length, 0);
      assert.equal(cpuProfile.eventLoop.available, true);
      assert.ok(cpuProfile.eventLoop.stallIntervals.length > 0);
    } finally {
      await terminateChild(child);
    }
  });

  it('attaches to an existing pid via SIGUSR1', async () => {
    if (!(await inspectorSupported()) || !(await pidAttachSupportedInEnvironment())) {
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
      const cpuProfile = getCpuProfile(report);
      assert.equal(report.meta.mode, 'attach');
      assert.equal(report.meta.pid, child.pid);
      assert.equal(report.meta.captureIntegrity.controlChannel, false);
      assert.equal(cpuProfile.eventLoop.available, true);
      assert.ok(cpuProfile.eventLoop.stallIntervals.length > 0);
    } finally {
      await terminateChild(child);
    }
  });

  it('writes a report and stops the spawned target on SIGINT', async () => {
    if (!(await inspectorSupported())) {
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

  it('loads an external detector plugin via --detectors', async () => {
    if (!(await inspectorSupported())) {
      return;
    }

    const { stdout } = await execFileAsync(
      'node',
      [
        binPath,
        'run',
        '--duration',
        '1200ms',
        '--pretty',
        '--detectors',
        resolve(fixturesDir, 'custom-plugin.mjs'),
        '--',
        'node',
        resolve(fixturesDir, 'sync-crypto-app.mjs'),
      ],
      { cwd: repoRoot, timeout: 10_000, maxBuffer: 1024 * 1024 * 4 },
    );

    const report = JSON.parse(stdout);
    assert.ok(
      report.findings.some((finding: { id: string }) => finding.id === 'custom-test:always'),
      'expected custom-test:always finding from the plugin',
    );
  });

  it('writes a single JSON file on SIGTERM in attach mode and keeps the target alive', async () => {
    if (!(await inspectorSupported())) {
      return;
    }

    const child = await spawnFixture([
      '--inspect=0',
      resolve(fixturesDir, 'event-loop-stall-app.mjs'),
    ]);
    const wsUrl = await waitForInspectorUrl(child);
    const outputDir = await mkdtemp(join(tmpdir(), 'lanterna-live-'));
    const outputPath = join(outputDir, 'attach-report.json');

    try {
      const result = await runLanternaAndSignal(
        ['attach', '--inspect-url', wsUrl, '--output', outputPath, '--pretty', '--duration', '30s'],
        'SIGTERM',
        {
          delayMs: 2_500,
          signalAfterStderr: /Capture is running/,
        },
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
