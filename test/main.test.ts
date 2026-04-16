import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACH_HELP, GLOBAL_HELP, RUN_HELP, main } from '../src/cli/main.js';

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
  });

  it('prints run help when run is invoked without args', async () => {
    await main(['run']);
    expect(stdoutWrite).toHaveBeenCalledWith(RUN_HELP);
  });

  it('prints attach help when attach is invoked without args', async () => {
    await main(['attach']);
    expect(stdoutWrite).toHaveBeenCalledWith(ATTACH_HELP);
  });

  it('prints run help for run --help', async () => {
    await main(['run', '--help']);
    expect(stdoutWrite).toHaveBeenCalledWith(RUN_HELP);
  });

  it('prints attach help for attach --help', async () => {
    await main(['attach', '--help']);
    expect(stdoutWrite).toHaveBeenCalledWith(ATTACH_HELP);
  });

  it('prints a human-readable error for unknown commands', async () => {
    await main(['wat']);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Unknown command: wat'));
    expect(process.exitCode).toBe(2);
  });
});
