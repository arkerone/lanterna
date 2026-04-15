import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttachArgs } from '../src/cli/parse.js';

describe('cli parsing', () => {
  it('rejects attach with both pid and inspect-url', () => {
    assert.throws(
      () => parseAttachArgs(['--pid', '42', '--inspect-url', 'ws://127.0.0.1:9229/test', '--duration', '1s']),
      /requires exactly one of --pid or --inspect-url/,
    );
  });

  it('rejects attach without duration', () => {
    assert.throws(
      () => parseAttachArgs(['--pid', '42']),
      /requires --duration/,
    );
  });

  it('rejects --deep in attach mode', () => {
    assert.throws(
      () => parseAttachArgs(['--pid', '42', '--duration', '1s', '--deep']),
      /does not support --deep/,
    );
  });

  it('accepts a valid attach config', () => {
    assert.deepEqual(
      parseAttachArgs(['--pid', '42', '--duration', '1500ms', '--pretty']),
      {
        pid: 42,
        durationMs: 1500,
        pretty: true,
        sampleIntervalMicros: 1000,
      },
    );
  });
});
