import { writeSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stopAndPersist = vi.fn();
const start = vi.fn();
const succeed = vi.fn();
const fail = vi.fn();
const stop = vi.fn();

const spinner = {
  start,
  stopAndPersist,
  succeed,
  fail,
  stop,
  text: '',
};

start.mockImplementation(() => spinner);

vi.mock('ora', () => ({
  default: vi.fn(() => spinner),
}));

vi.mock('node:fs', () => ({
  writeSync: vi.fn(),
}));

describe('activity indicator', () => {
  beforeEach(() => {
    stopAndPersist.mockClear();
    start.mockClear();
    succeed.mockClear();
    fail.mockClear();
    stop.mockClear();
    vi.mocked(writeSync).mockClear();
  });

  it('persists completed steps as green checks when history is enabled', async () => {
    const { startActivityIndicator } = await import('../src/activity-indicator.js');
    const indicator = startActivityIndicator('Step one', { keepHistory: true });

    indicator.update('Step two');

    expect(stopAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: expect.stringContaining('✔'),
        text: expect.stringContaining('Step one'),
      }),
    );
    expect(start).toHaveBeenCalled();
  });

  it('persists the failed step and prints the failure reason when history is enabled', async () => {
    const { startActivityIndicator } = await import('../src/activity-indicator.js');
    const indicator = startActivityIndicator('Connecting to CDP', { keepHistory: true });

    indicator.fail('lanterna: failed to connect');

    expect(stopAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: expect.stringContaining('✖'),
        text: expect.stringContaining('Connecting to CDP'),
      }),
    );
    expect(writeSync).toHaveBeenCalledWith(
      2,
      expect.stringContaining('lanterna: failed to connect'),
    );
  });
});
