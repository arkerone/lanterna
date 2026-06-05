import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LANTERNA_REPORT_SCHEMA_VERSION, type LanternaReport } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { writeExistingReportOutput, writeReportDiffOutput } from '../src/output.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lanterna-report-intake-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(dir: string, filename: string, value: unknown): Promise<string> {
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
}

function report(overrides: Partial<LanternaReport> = {}): LanternaReport {
  return {
    meta: {
      schemaVersion: LANTERNA_REPORT_SCHEMA_VERSION,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      pid: 1234,
      startedAt: '2024-01-01T00:00:00.000Z',
      durationMs: 1000,
      cwd: '/app',
      command: ['node', 'app.js'],
      lanternaVersion: '0.1.0',
      mode: 'spawn',
      profileKinds: [],
      kinds: {},
      captureIntegrity: {
        controlChannel: false,
        controlChannelExpected: false,
        eventLoopTimed: false,
        gcTimed: false,
        gcObserverAvailable: false,
        controlChannelWriteErrors: 0,
        gcObserverSetupFailed: 0,
        heartbeatDropped: 0,
        kinds: {},
      },
    },
    profiles: {},
    findings: [],
    ...overrides,
  };
}

describe('report intake', () => {
  it('renders a valid existing report after validation', async () => {
    await withTempDir(async (dir) => {
      const input = await writeJson(dir, 'report.json', report());
      const output = join(dir, 'rendered.json');

      await writeExistingReportOutput(input, output, true, 'json');

      const rendered = JSON.parse(await readFile(output, 'utf8')) as LanternaReport;
      expect(rendered.meta.schemaVersion).toBe(LANTERNA_REPORT_SCHEMA_VERSION);
    });
  });

  it('rejects invalid JSON before rendering an existing report', async () => {
    await withTempDir(async (dir) => {
      const input = join(dir, 'report.json');
      await writeFile(input, '{not json', 'utf8');

      await expect(writeExistingReportOutput(input, undefined, false, 'text')).rejects.toThrow(
        /Failed to parse Lanterna report/,
      );
    });
  });

  it('rejects reports that do not match the schema', async () => {
    await withTempDir(async (dir) => {
      const input = await writeJson(dir, 'report.json', { findings: [] });

      await expect(writeExistingReportOutput(input, undefined, false, 'text')).rejects.toThrow(
        /Invalid Lanterna report/,
      );
    });
  });

  it('rejects unsupported report schema versions', async () => {
    await withTempDir(async (dir) => {
      const input = await writeJson(
        dir,
        'report.json',
        report({ meta: { ...report().meta, schemaVersion: '1.0.0' } }),
      );

      await expect(writeExistingReportOutput(input, undefined, false, 'text')).rejects.toThrow(
        /Unsupported Lanterna report schema version/,
      );
    });
  });

  it('validates both reports before diffing', async () => {
    await withTempDir(async (dir) => {
      const baseline = await writeJson(dir, 'baseline.json', report());
      const current = await writeJson(dir, 'current.json', {
        meta: {},
        profiles: {},
        findings: [],
      });

      await expect(
        writeReportDiffOutput(baseline, current, undefined, false, 'text'),
      ).rejects.toThrow(/Invalid current report/);
    });
  });
});
