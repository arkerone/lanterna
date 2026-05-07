import {
  DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
  DEFAULT_ASYNC_MAX_RECORDS,
  DEFAULT_ASYNC_STACK_DEPTH,
  DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  DEFAULT_MEMORY_USAGE_INTERVAL_MS,
} from '@lanterna-profiler/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAttachArgs, parseReportArgs, parseRunArgs } from '../src/parse.js';

const MEMORY_DEFAULTS = {
  heapSamplingIntervalBytes: DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  memoryUsageIntervalMs: DEFAULT_MEMORY_USAGE_INTERVAL_MS,
  includeMemoryUsageSamples: false,
  heapSnapshotAnalysis: { enabled: false },
  asyncMaxRecords: DEFAULT_ASYNC_MAX_RECORDS,
  asyncStackDepth: DEFAULT_ASYNC_STACK_DEPTH,
  asyncIncludeMicrotasks: false,
  asyncConcurrencyIntervalMs: DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
  asyncInstrumentation: 'safe',
  sourceMaps: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function expectKindsToEqual(kinds: string[], expected: string[]): void {
  expect(kinds).toEqual(expected);
}

describe('parseRunArgs', () => {
  it('parses the target command after `--` and preserves profiling options', () => {
    expect(
      parseRunArgs([
        '--duration',
        '1.5s',
        '--sample-interval',
        '2500',
        '--pretty',
        '--deep',
        '--',
        'node',
        'server.mjs',
        '--port',
        '3000',
      ]),
    ).toEqual({
      command: ['node', 'server.mjs', '--port', '3000'],
      durationMs: 1500,
      pretty: true,
      format: 'json',
      deep: true,
      sampleIntervalMicros: 2500,
      detectors: [],
      kinds: ['cpu'],
      ...MEMORY_DEFAULTS,
    });
  });

  it('fails with a separator hint when a target option is passed before `--`', () => {
    expect(() => parseRunArgs(['--watch', 'node', 'server.mjs'])).toThrow(
      'unknown option "--watch" (did you forget "--" before the target command?)',
    );
  });

  it('does not leak commander stderr output for unknown options', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => parseRunArgs(['--watch', 'node', 'server.mjs'])).toThrow(
      'unknown option "--watch" (did you forget "--" before the target command?)',
    );

    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('rejects missing target commands', () => {
    expect(() => parseRunArgs(['--duration', '1s'])).toThrow(
      'no command provided. Use: lanterna run [options] -- <command> [args...]',
    );
  });

  it('parses output format and run orchestration options', () => {
    expect(
      parseRunArgs([
        '--format',
        'markdown',
        '--wait-for-url',
        'http://127.0.0.1:3000/health',
        '--wait-timeout',
        '5s',
        '--capture-delay',
        '250ms',
        '--workload',
        'npx -y autocannon http://127.0.0.1:3000',
        '--',
        'node',
        'server.js',
      ]),
    ).toMatchObject({
      command: ['node', 'server.js'],
      format: 'markdown',
      waitForUrl: 'http://127.0.0.1:3000/health',
      waitTimeoutMs: 5000,
      captureDelayMs: 250,
      workload: 'npx -y autocannon http://127.0.0.1:3000',
    });
  });

  it('accepts agent format for run captures', () => {
    expect(parseRunArgs(['--format', 'agent', '--', 'node', 'app.js'])).toMatchObject({
      command: ['node', 'app.js'],
      format: 'agent',
    });
  });

  it('parses --no-source-maps for run captures', () => {
    expect(parseRunArgs(['--no-source-maps', '--', 'node', 'app.js']).sourceMaps).toBe(false);
  });

  it('rejects unknown output formats', () => {
    expect(() => parseRunArgs(['--format', 'html', '--', 'node', 'app.js'])).toThrow(
      /invalid --format/,
    );
  });

  it('rejects sample intervals below the configured minimum', () => {
    expect(() => parseRunArgs(['--sample-interval', '10', '--', 'node', 'app.js'])).toThrow(
      /invalid --sample-interval/,
    );
  });

  it('accepts heap sample interval in bytes, KiB, and MiB', () => {
    expect(
      parseRunArgs(['--heap-sample-interval', '524288', '--', 'node', 'app.js'])
        .heapSamplingIntervalBytes,
    ).toBe(524_288);
    expect(
      parseRunArgs(['--heap-sample-interval', '512KiB', '--', 'node', 'app.js'])
        .heapSamplingIntervalBytes,
    ).toBe(512 * 1024);
    expect(
      parseRunArgs(['--heap-sample-interval', '1MiB', '--', 'node', 'app.js'])
        .heapSamplingIntervalBytes,
    ).toBe(1024 * 1024);
    expect(
      parseRunArgs(['--heap-sample-interval', '256k', '--', 'node', 'app.js'])
        .heapSamplingIntervalBytes,
    ).toBe(256 * 1024);
  });

  it('rejects malformed or below-minimum heap sample intervals', () => {
    expect(() => parseRunArgs(['--heap-sample-interval', 'big', '--', 'node', 'app.js'])).toThrow(
      /invalid --heap-sample-interval/,
    );
    expect(() => parseRunArgs(['--heap-sample-interval', '512', '--', 'node', 'app.js'])).toThrow(
      /invalid --heap-sample-interval/,
    );
  });

  it('normalizes repeated and comma-separated kinds without duplication', () => {
    const parsed = parseRunArgs([
      '--kind',
      'cpu,memory',
      '--kind',
      'cpu',
      '--kind',
      'async',
      '--',
      'node',
      'app.js',
    ]);

    expectKindsToEqual(parsed.kinds, ['cpu', 'memory', 'async']);
  });

  it('rejects whitespace-separated multi-kind syntax before the target separator', () => {
    expect(() => parseRunArgs(['--kind', 'cpu', 'memory', '--', 'node', 'app.js'])).toThrow(
      /Use --kind cpu,memory or repeat --kind/,
    );
  });

  it('accepts comma-separated multi-kind syntax', () => {
    const parsed = parseRunArgs(['--kind', 'cpu,memory', '--', 'node', 'app.js']);

    expectKindsToEqual(parsed.kinds, ['cpu', 'memory']);
  });

  it('accepts repeatable multi-kind syntax', () => {
    const parsed = parseRunArgs(['--kind', 'cpu', '--kind', 'memory', '--', 'node', 'app.js']);

    expectKindsToEqual(parsed.kinds, ['cpu', 'memory']);
  });

  it('parses raw memory sample opt-in for run and attach', () => {
    expect(
      parseRunArgs(['--kind', 'memory', '--include-memory-samples', '--', 'node', 'app.js'])
        .includeMemoryUsageSamples,
    ).toBe(true);

    expect(
      parseAttachArgs([
        '--inspect-url',
        'ws://127.0.0.1:9229/test',
        '--kind',
        'memory',
        '--include-memory-samples',
      ]).includeMemoryUsageSamples,
    ).toBe(true);
  });

  it('parses async instrumentation mode for async captures', () => {
    expect(
      parseRunArgs(['--kind', 'async', '--async-instrumentation', 'full', '--', 'node', 'app.js'])
        .asyncInstrumentation,
    ).toBe('full');

    expect(() => parseRunArgs(['--async-instrumentation', 'safe', '--', 'node', 'app.js'])).toThrow(
      '--async-* options require --kind async',
    );
    expect(() =>
      parseRunArgs([
        '--kind',
        'async',
        '--async-instrumentation',
        'aggressive',
        '--',
        'node',
        'app.js',
      ]),
    ).toThrow(/invalid --async-instrumentation/);
  });

  it('rejects the old async max records flag name', () => {
    expect(() =>
      parseRunArgs(['--kind', 'async', '--async-max-records', '1000', '--', 'node', 'app.js']),
    ).toThrow(/unknown option "--async-max-records"/);
  });

  it('accepts the async max events flag name', () => {
    expect(
      parseRunArgs(['--kind', 'async', '--async-max-events', '1000', '--', 'node', 'app.js'])
        .asyncMaxRecords,
    ).toBe(1000);
  });

  it('parses heap snapshot analysis options for memory captures', () => {
    expect(
      parseRunArgs(['--kind', 'memory', '--heap-snapshot-analysis', '--', 'node', 'app.js']),
    ).toMatchObject({
      heapSnapshotAnalysis: {
        enabled: true,
      },
    });

    expect(
      parseRunArgs([
        '--kind',
        'memory',
        '--heap-snapshot-analysis',
        '--heap-snapshot-dir',
        '/tmp/lanterna-heaps',
        '--',
        'node',
        'app.js',
      ]),
    ).toMatchObject({
      heapSnapshotAnalysis: {
        enabled: true,
        outputDir: '/tmp/lanterna-heaps',
      },
    });
  });

  it('rejects heap snapshot analysis without the memory kind', () => {
    expect(() => parseRunArgs(['--heap-snapshot-analysis', '--', 'node', 'app.js'])).toThrow(
      /--heap-snapshot-analysis requires --kind memory/,
    );
    expect(() =>
      parseAttachArgs(['--pid', '42', '--heap-snapshot-dir', '/tmp/lanterna-heaps']),
    ).toThrow(/--heap-snapshot-dir requires --kind memory/);
  });
});

describe('parseAttachArgs', () => {
  it('accepts a pid target and normalizes options', () => {
    expect(parseAttachArgs(['--pid', '42', '--duration', '1500ms', '--pretty'])).toEqual({
      pid: 42,
      durationMs: 1500,
      pretty: true,
      format: 'json',
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
      ...MEMORY_DEFAULTS,
    });
  });

  it('accepts an inspector url target and output path', () => {
    expect(
      parseAttachArgs([
        '--inspect-url',
        'ws://127.0.0.1:9229/test',
        '--duration',
        '2m',
        '--output',
        '/tmp/report.json',
      ]),
    ).toEqual({
      inspectUrl: 'ws://127.0.0.1:9229/test',
      durationMs: 120_000,
      output: '/tmp/report.json',
      pretty: false,
      format: 'json',
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
      ...MEMORY_DEFAULTS,
    });
  });

  it('rejects attach with both pid and inspect-url', () => {
    expect(() =>
      parseAttachArgs([
        '--pid',
        '42',
        '--inspect-url',
        'ws://127.0.0.1:9229/test',
        '--duration',
        '1s',
      ]),
    ).toThrow('`lanterna attach` accepts at most one of --pid or --inspect-url');
  });

  it('accepts attach without an explicit target so the CLI can prompt interactively', () => {
    expect(parseAttachArgs(['--pid', '--pretty'])).toEqual({
      promptForTarget: true,
      pretty: true,
      format: 'json',
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
      ...MEMORY_DEFAULTS,
    });
  });

  it('accepts attach without duration for manual-stop mode', () => {
    expect(parseAttachArgs(['--pid', '42'])).toEqual({
      pid: 42,
      pretty: false,
      format: 'json',
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
      ...MEMORY_DEFAULTS,
    });
  });

  it('accepts attach kinds with repeatable and comma-separated syntax', () => {
    const parsed = parseAttachArgs([
      '--pid',
      '42',
      '--kind',
      'cpu,memory',
      '--kind',
      'cpu',
      '--kind',
      'async',
    ]);

    expect(parsed).toMatchObject({
      pid: 42,
      pretty: false,
      format: 'json',
      sampleIntervalMicros: 1000,
      detectors: [],
    });
    expectKindsToEqual(parsed.kinds, ['cpu', 'memory', 'async']);
  });

  it('parses --no-source-maps for attach captures', () => {
    expect(parseAttachArgs(['--pid', '42', '--no-source-maps']).sourceMaps).toBe(false);
  });

  it('accepts agent format for attach captures', () => {
    expect(parseAttachArgs(['--pid', '42', '--format', 'agent'])).toMatchObject({
      pid: 42,
      format: 'agent',
    });
  });

  it('does not prompt interactively for bare attach anymore', () => {
    expect(parseAttachArgs([])).toEqual({
      pretty: false,
      format: 'json',
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
      ...MEMORY_DEFAULTS,
    });
  });

  it('rejects invalid pid values and unsupported deep mode', () => {
    expect(() => parseAttachArgs(['--pid', '0', '--duration', '1s'])).toThrow(/invalid --pid/);
    expect(() => parseAttachArgs(['--pid', '42', '--duration', '1s', '--deep'])).toThrow(
      '`lanterna attach` does not support --deep; attach mode cannot enable deopt tracing on an existing process',
    );
  });
});

describe('parseReportArgs', () => {
  it('parses a report file and output options', () => {
    expect(
      parseReportArgs(['report.json', '--format', 'text', '--output', 'report.txt', '--pretty']),
    ).toEqual({
      file: 'report.json',
      format: 'text',
      output: 'report.txt',
      pretty: true,
    });
  });

  it('accepts agent format for existing reports', () => {
    expect(
      parseReportArgs(['report.json', '--format', 'agent', '--output', 'report.agent.md']),
    ).toEqual({
      file: 'report.json',
      format: 'agent',
      output: 'report.agent.md',
      pretty: false,
    });
  });

  it('defaults existing report rendering to text', () => {
    expect(parseReportArgs(['report.json'])).toEqual({
      file: 'report.json',
      format: 'text',
      pretty: false,
    });
  });

  it('requires a report file', () => {
    expect(() => parseReportArgs([])).toThrow(
      'no report file provided. Use: lanterna report <file> [options]',
    );
  });
});
