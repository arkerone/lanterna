import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAttachArgs, parseRunArgs } from '../src/parse.js';

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
      deep: true,
      sampleIntervalMicros: 2500,
      detectors: [],
      kinds: ['cpu'],
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

  it('rejects sample intervals below the configured minimum', () => {
    expect(() => parseRunArgs(['--sample-interval', '10', '--', 'node', 'app.js'])).toThrow(
      /invalid --sample-interval/,
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
});

describe('parseAttachArgs', () => {
  it('accepts a pid target and normalizes options', () => {
    expect(parseAttachArgs(['--pid', '42', '--duration', '1500ms', '--pretty'])).toEqual({
      pid: 42,
      durationMs: 1500,
      pretty: true,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
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
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
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
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });
  });

  it('accepts attach without duration for manual-stop mode', () => {
    expect(parseAttachArgs(['--pid', '42'])).toEqual({
      pid: 42,
      pretty: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
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
      sampleIntervalMicros: 1000,
      detectors: [],
    });
    expectKindsToEqual(parsed.kinds, ['cpu', 'memory', 'async']);
  });

  it('does not prompt interactively for bare attach anymore', () => {
    expect(parseAttachArgs([])).toEqual({
      pretty: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });
  });

  it('rejects invalid pid values and unsupported deep mode', () => {
    expect(() => parseAttachArgs(['--pid', '0', '--duration', '1s'])).toThrow(/invalid --pid/);
    expect(() => parseAttachArgs(['--pid', '42', '--duration', '1s', '--deep'])).toThrow(
      '`lanterna attach` does not support --deep; attach mode cannot enable deopt tracing on an existing process',
    );
  });
});
