import { describe, expect, it } from 'vitest';
import { resolvePsFormat, serializeProcessList, toProcessListJson } from '../src/commands/ps.js';
import type { RunningNodeProcess } from '../src/node-process-discovery.js';

function makeProcess(over: Partial<RunningNodeProcess> = {}): RunningNodeProcess {
  return {
    pid: 4242,
    runtime: 'node',
    command: 'node server.js',
    cwd: '/srv/app',
    ageMs: 83_000,
    cpu: 12.4,
    memory: 3.1,
    attachMode: 'cdp-ready',
    ...over,
  };
}

describe('toProcessListJson', () => {
  it('maps every field', () => {
    expect(toProcessListJson([makeProcess()])).toEqual([
      {
        pid: 4242,
        runtime: 'node',
        attachMode: 'cdp-ready',
        command: 'node server.js',
        cwd: '/srv/app',
        ageMs: 83_000,
        cpu: 12.4,
        memory: 3.1,
      },
    ]);
  });

  it('omits optional fields that are undefined rather than emitting null', () => {
    const entries = toProcessListJson([
      makeProcess({ cwd: undefined, ageMs: undefined, cpu: undefined, memory: undefined }),
    ]);
    expect(entries).toEqual([
      {
        pid: 4242,
        runtime: 'node',
        attachMode: 'cdp-ready',
        command: 'node server.js',
      },
    ]);
    expect(entries[0]).not.toHaveProperty('cwd');
    expect(entries[0]).not.toHaveProperty('cpu');
  });
});

describe('serializeProcessList', () => {
  it('emits single-line JSON by default', () => {
    const out = serializeProcessList([makeProcess()], 'json', false);
    expect(out).not.toContain('\n');
    expect(JSON.parse(out)).toEqual(toProcessListJson([makeProcess()]));
  });

  it('emits indented JSON when pretty', () => {
    const out = serializeProcessList([makeProcess()], 'json', true);
    expect(out).toContain('\n  ');
    expect(JSON.parse(out)).toEqual(toProcessListJson([makeProcess()]));
  });

  it('emits an empty JSON array when nothing is attachable', () => {
    expect(serializeProcessList([], 'json', false)).toBe('[]');
  });

  it('renders a table containing each pid and attach mode in text mode', () => {
    const out = serializeProcessList([makeProcess({ pid: 9001 })], 'text', false);
    expect(out).toContain('9001');
    expect(out).toContain('CDP ready');
  });

  it('returns a guidance message when text mode finds nothing', () => {
    const out = serializeProcessList([], 'text', false);
    expect(out).toContain('No attachable node/nodejs runtimes found');
    expect(out).toContain('lanterna run');
  });
});

describe('resolvePsFormat', () => {
  it('honors an explicit format', () => {
    expect(resolvePsFormat('json')).toBe('json');
    expect(resolvePsFormat('text')).toBe('text');
  });

  it('defaults to a table on a TTY and JSON when piped', () => {
    const stdout = process.stdout as { isTTY?: boolean };
    const original = stdout.isTTY;
    try {
      stdout.isTTY = true;
      expect(resolvePsFormat(undefined)).toBe('text');
      stdout.isTTY = false;
      expect(resolvePsFormat(undefined)).toBe('json');
    } finally {
      stdout.isTTY = original;
    }
  });
});
