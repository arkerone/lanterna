import { describe, expect, it } from 'vitest';
import { parseAttachArgs, parseRunArgs } from '../src/cli/parse.js';

describe('parseRunArgs', () => {
  it('parses the target command after `--` and preserves profiling options', () => {
    expect(
      parseRunArgs([
        '--duration', '1.5s',
        '--sample-interval', '2500',
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
    });
  });

  it('fails with a separator hint when a target option is passed before `--`', () => {
    expect(() => parseRunArgs(['--watch', 'node', 'server.mjs'])).toThrow(
      'unknown option "--watch" (did you forget "--" before the target command?)',
    );
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
});

describe('parseAttachArgs', () => {
  it('accepts a pid target and normalizes options', () => {
    expect(
      parseAttachArgs(['--pid', '42', '--duration', '1500ms', '--pretty']),
    ).toEqual({
      pid: 42,
      durationMs: 1500,
      pretty: true,
      sampleIntervalMicros: 1000,
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
    });
  });

  it('rejects attach with both pid and inspect-url', () => {
    expect(() => parseAttachArgs([
      '--pid',
      '42',
      '--inspect-url',
      'ws://127.0.0.1:9229/test',
      '--duration',
      '1s',
    ])).toThrow('`lanterna attach` requires exactly one of --pid or --inspect-url');
  });

  it('rejects attach without duration', () => {
    expect(() => parseAttachArgs(['--pid', '42'])).toThrow(
      '`lanterna attach` requires --duration so the capture can stop without controlling the target process',
    );
  });

  it('rejects invalid pid values and unsupported deep mode', () => {
    expect(() => parseAttachArgs(['--pid', '0', '--duration', '1s'])).toThrow(/invalid --pid/);
    expect(() => parseAttachArgs(['--pid', '42', '--duration', '1s', '--deep'])).toThrow(
      '`lanterna attach` does not support --deep; attach mode cannot enable deopt tracing on an existing process',
    );
  });
});
