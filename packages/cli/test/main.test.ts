import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACH_HELP, GLOBAL_HELP, main, RUN_HELP, VERSION } from '../src/main.js';
import {
  ASYNC_OPTIONS,
  ATTACH_CAPTURE_OPTIONS,
  COMMON_CAPTURE_OPTIONS,
  MEMORY_OPTIONS,
  OUTPUT_OPTIONS,
  PLUGIN_OPTIONS,
  RUN_CAPTURE_OPTIONS,
} from '../src/option-descriptors.js';

describe('main help routing', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    process.exitCode = undefined;
  });

  it('prints global help with no args', async () => {
    await main([]);
    expect(stdoutWrite).toHaveBeenCalledWith(GLOBAL_HELP);
    expect(GLOBAL_HELP).toContain('██');
    expect(GLOBAL_HELP).toContain('Agent-first Node.js profiler');
    expect(GLOBAL_HELP).toContain('Commands');
    expect(GLOBAL_HELP).toContain('Examples');
  });

  it('prints run help when run is invoked without args', async () => {
    await main(['run']);
    expect(stdoutWrite).toHaveBeenCalledWith(RUN_HELP);
    expect(RUN_HELP).toContain('LANTERNA');
    expect(RUN_HELP).toContain('run');
    expect(RUN_HELP).toContain('Fresh process capture');
    expect(RUN_HELP).toContain('Capture');
    expect(RUN_HELP).toContain('Memory kind');
    expect(RUN_HELP).toContain('Output');
  });

  it('prints attach help when attach is invoked without args', async () => {
    await main(['attach']);
    expect(stdoutWrite).toHaveBeenCalledWith(ATTACH_HELP);
    expect(ATTACH_HELP).toContain('LANTERNA');
    expect(ATTACH_HELP).toContain('attach');
    expect(ATTACH_HELP).toContain('Live process capture');
    expect(ATTACH_HELP).toContain('Capture');
  });

  it('prints run help for run --help', async () => {
    await main(['run', '--help']);
    expect(stdoutWrite).toHaveBeenCalledWith(RUN_HELP);
  });

  it('prints attach help for attach --help', async () => {
    await main(['attach', '--help']);
    expect(stdoutWrite).toHaveBeenCalledWith(ATTACH_HELP);
  });

  it('prints version for --version', async () => {
    await main(['--version']);
    const written = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain('lanterna');
    expect(written).toContain(VERSION);
  });

  it('prints version for -v', async () => {
    await main(['-v']);
    const written = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain(VERSION);
  });

  it('prints a human-readable error for unknown commands', async () => {
    await main(['wat']);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('wat'));
    expect(process.exitCode).toBe(2);
  });

  it('renders help from the declared option descriptors', () => {
    const runOptions = [
      ...COMMON_CAPTURE_OPTIONS,
      ...RUN_CAPTURE_OPTIONS,
      ...MEMORY_OPTIONS,
      ...ASYNC_OPTIONS,
      ...OUTPUT_OPTIONS,
      ...PLUGIN_OPTIONS,
    ];
    const attachOptions = [
      ...ATTACH_CAPTURE_OPTIONS,
      ...COMMON_CAPTURE_OPTIONS,
      ...MEMORY_OPTIONS,
      ...ASYNC_OPTIONS,
      ...OUTPUT_OPTIONS,
      ...PLUGIN_OPTIONS,
    ];
    const globalOptions = [
      ...COMMON_CAPTURE_OPTIONS,
      ...RUN_CAPTURE_OPTIONS,
      ...ATTACH_CAPTURE_OPTIONS,
      ...MEMORY_OPTIONS,
      ...ASYNC_OPTIONS,
      ...OUTPUT_OPTIONS,
      ...PLUGIN_OPTIONS,
    ];

    for (const option of runOptions) expect(RUN_HELP).toContain(option.flag);
    for (const option of attachOptions) expect(ATTACH_HELP).toContain(option.flag);
    for (const option of globalOptions) expect(GLOBAL_HELP).toContain(option.flag);
  });

  it('documents async as experimental in global, run, and attach help', () => {
    for (const help of [GLOBAL_HELP, RUN_HELP, ATTACH_HELP]) {
      expect(help).toContain('async');
      expect(help).toContain('experimental');
    }
  });
});
