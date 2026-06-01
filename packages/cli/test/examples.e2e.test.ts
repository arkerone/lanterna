// End-to-end coverage suite: runs every example in `examples/` through the
// locally-built CLI and verifies its behaviour. It checks four things:
//
//   1. positives — each pathological workload PRODUCES its expected finding(s),
//      at the expected severity/confidence where the manifest pins them;
//   2. negatives — each corrected variant (`app.fixed.js`) does NOT produce the
//      finding (proves the fix works and the detector isn't trigger-happy);
//   3. attach mode — the second capture path (`lanterna attach`) also surfaces
//      findings on a running process;
//   4. agent output — the `--format agent` renderer emits the agent contract.
//
// It does REAL profiling (spawns the CLI, attaches over CDP, captures for several
// seconds each), so it is heavy (~5-6 min) and opt-in — it only runs when
// LANTERNA_E2E is set:
//
//   npm run test:e2e            # from the repo root (builds first, then runs)

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, FIXED_EXAMPLES } from '../../../examples/manifest.mjs';

interface ExampleSpec {
  dir: string;
  title: string;
  kinds: string[];
  deep?: boolean;
  durationMs: number;
  expect: string[];
  severity?: Record<string, string>;
  confidence?: Record<string, string>;
  bestEffort?: boolean;
  waitForUrl?: string;
  workload?: string;
}

interface FixedSpec {
  dir: string;
  app: string;
  kinds: string[];
  deep?: boolean;
  durationMs: number;
  forbid: string[];
}

interface Finding {
  id: string;
  severity: string;
  confidence: string;
}

const positives = EXAMPLES as ExampleSpec[];
const negatives = FIXED_EXAMPLES as FixedSpec[];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LANTERNA_BIN = resolve(REPO_ROOT, 'packages/cli/bin/lanterna.js');
const E2E_ENABLED = process.env.LANTERNA_E2E === '1' || process.env.LANTERNA_E2E === 'true';

function runLanterna(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code) => resolvePromise({ code, stderr }));
    child.on('error', (error) => resolvePromise({ code: -1, stderr: String(error) }));
  });
}

interface CaptureOptions {
  app: string;
  kinds: string[];
  durationMs: number;
  deep?: boolean;
  waitForUrl?: string;
  workload?: string;
}

async function capture(options: CaptureOptions): Promise<{ findings: Finding[]; kinds: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'lanterna-e2e-'));
  const reportPath = join(dir, 'report.json');
  try {
    const args = [
      LANTERNA_BIN,
      'run',
      '--kind',
      options.kinds.join(','),
      '--duration',
      `${options.durationMs}ms`,
      '--output',
      reportPath,
    ];
    if (options.deep) args.push('--deep');
    if (options.waitForUrl) args.push('--wait-for-url', options.waitForUrl);
    if (options.workload) args.push('--workload', options.workload);
    args.push('--', process.execPath, resolve(REPO_ROOT, 'examples', options.app));

    const { code, stderr } = await runLanterna(args);
    let report: { findings?: Finding[]; meta?: { profileKinds?: string[] } };
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'));
    } catch {
      throw new Error(`lanterna produced no report (exit ${code}). stderr:\n${stderr.slice(-600)}`);
    }
    return { findings: report.findings ?? [], kinds: report.meta?.profileKinds ?? [] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const matching = (findings: Finding[], stem: string) =>
  findings.filter((finding) => finding.id.startsWith(stem));

describe.skipIf(!E2E_ENABLED)('examples — positives (the finding fires)', () => {
  for (const spec of positives) {
    const label = `${spec.dir} → ${spec.expect.join(', ')}${spec.bestEffort ? ' (best-effort)' : ''}`;
    it(
      label,
      async () => {
        const { findings, kinds } = await capture({
          app: `${spec.dir}/app.js`,
          kinds: spec.kinds,
          durationMs: spec.durationMs,
          deep: spec.deep,
          waitForUrl: spec.waitForUrl,
          workload: spec.workload,
        });
        const ids = findings.map((finding) => finding.id);
        for (const kind of spec.kinds) {
          expect(kinds, `kind "${kind}" not captured for ${spec.dir}`).toContain(kind);
        }

        const missing = spec.expect.filter((stem) => matching(findings, stem).length === 0);
        if (missing.length > 0 && spec.bestEffort) {
          console.warn(
            `[best-effort miss] ${spec.dir}: ${missing.join(', ')} not detected (got: ${ids.join(', ') || 'none'})`,
          );
          return;
        }
        expect(
          missing,
          `${spec.dir} did not produce ${missing.join(', ')} (got: ${ids.join(', ') || 'none'})`,
        ).toEqual([]);

        for (const [stem, severity] of Object.entries(spec.severity ?? {})) {
          const got = matching(findings, stem).map((finding) => finding.severity);
          expect(got, `${spec.dir}: ${stem} severities ${got.join('/')} ∌ ${severity}`).toContain(
            severity,
          );
        }
        for (const [stem, confidence] of Object.entries(spec.confidence ?? {})) {
          const got = matching(findings, stem).map((finding) => finding.confidence);
          expect(
            got,
            `${spec.dir}: ${stem} confidences ${got.join('/')} ∌ ${confidence}`,
          ).toContain(confidence);
        }
      },
      spec.durationMs + 30_000,
    );
  }
});

describe.skipIf(!E2E_ENABLED)('examples — negatives (the fix clears the finding)', () => {
  for (const spec of negatives) {
    it(
      `${spec.dir}/${spec.app} ⇏ ${spec.forbid.join(', ')}`,
      async () => {
        const { findings, kinds } = await capture({
          app: `${spec.dir}/${spec.app}`,
          kinds: spec.kinds,
          durationMs: spec.durationMs,
          deep: spec.deep,
        });
        for (const kind of spec.kinds) {
          expect(kinds, `kind "${kind}" not captured for ${spec.dir}/${spec.app}`).toContain(kind);
        }
        const present = spec.forbid.filter((stem) => matching(findings, stem).length > 0);
        expect(
          present,
          `${spec.dir}/${spec.app} should NOT fire ${present.join(', ')} (got: ${findings.map((f) => f.id).join(', ') || 'none'})`,
        ).toEqual([]);
      },
      spec.durationMs + 30_000,
    );
  }
});

describe.skipIf(!E2E_ENABLED)('capture paths', () => {
  it('attach surfaces findings on a running process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lanterna-attach-'));
    const reportPath = join(dir, 'report.json');
    // Start the target with its own inspector on a free port and attach to its
    // ws:// URL. (This avoids the SIGUSR1 / 9229-9238 port-scan path, which flakes
    // when another process — e.g. a `node --watch` dev server — holds 9229.)
    const target = spawn(
      process.execPath,
      ['--inspect=0', resolve(REPO_ROOT, 'examples/cpu-hotspot/app.js')],
      { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    try {
      const inspectUrl = await new Promise<string>((resolveUrl, reject) => {
        const timer = setTimeout(
          () => reject(new Error('target did not open an inspector in time')),
          10_000,
        );
        let buffered = '';
        target.stderr?.on('data', (chunk) => {
          buffered += String(chunk);
          const match = buffered.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/);
          if (match) {
            clearTimeout(timer);
            resolveUrl(match[0]);
          }
        });
        target.on('exit', () => {
          clearTimeout(timer);
          reject(new Error('target exited before opening an inspector'));
        });
      });
      await sleep(500); // let it start hashing

      const { code, stderr } = await runLanterna([
        LANTERNA_BIN,
        'attach',
        '--inspect-url',
        inspectUrl,
        '--kind',
        'cpu',
        '--duration',
        '5s',
        '--output',
        reportPath,
      ]);
      let report: { findings?: Finding[]; meta?: { mode?: string } };
      try {
        report = JSON.parse(await readFile(reportPath, 'utf8'));
      } catch {
        throw new Error(`attach produced no report (exit ${code}). stderr:\n${stderr.slice(-600)}`);
      }
      const ids = (report.findings ?? []).map((finding) => finding.id);
      expect(
        ids.some((id) => id.startsWith('sync-crypto-on-hot-path')),
        ids.join(', '),
      ).toBe(true);
    } finally {
      target.kill('SIGKILL');
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it('--format agent emits the agent contract', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lanterna-agent-'));
    const reportPath = join(dir, 'report.agent.md');
    try {
      const { code, stderr } = await runLanterna([
        LANTERNA_BIN,
        'run',
        '--kind',
        'cpu',
        '--duration',
        '6s',
        '--format',
        'agent',
        '--output',
        reportPath,
        '--',
        process.execPath,
        resolve(REPO_ROOT, 'examples/cpu-hotspot/app.js'),
      ]);
      let md: string;
      try {
        md = await readFile(reportPath, 'utf8');
      } catch {
        throw new Error(
          `agent render produced no output (exit ${code}). stderr:\n${stderr.slice(-600)}`,
        );
      }
      expect(md).toContain('rerun_required:');
      expect(md).toContain('## Findings');
      expect(md).toContain('sync-crypto-on-hot-path');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
