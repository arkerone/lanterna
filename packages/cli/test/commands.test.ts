import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runProfile: vi.fn(),
  attachProfile: vi.fn(),
  resolveMany: vi.fn((ids: string[]) => ids.map((id) => ({ id }))),
  writeReportOutput: vi.fn(),
  loadLanternaConfig: vi.fn(),
  loadPlugins: vi.fn(),
  indicator: {
    update: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  },
}));

vi.mock('@lanterna-profiler/core', () => ({
  createDefaultKindRegistry: vi.fn(() => ({ resolveMany: mocks.resolveMany })),
  runProfile: mocks.runProfile,
  attachProfile: mocks.attachProfile,
}));

vi.mock('@lanterna-profiler/detectors', () => ({
  createBuiltInFindingAnalyzers: vi.fn(() => []),
}));

vi.mock('../src/activity-indicator.js', () => ({
  startActivityIndicator: vi.fn(() => mocks.indicator),
}));

vi.mock('../src/output.js', () => ({
  writeReportOutput: mocks.writeReportOutput,
}));

vi.mock('../src/config.js', () => ({
  loadLanternaConfig: mocks.loadLanternaConfig,
}));

vi.mock('../src/plugins.js', () => ({
  loadPlugins: mocks.loadPlugins,
}));

const { runCommand } = await import('../src/commands/run.js');
const { attachCommand } = await import('../src/commands/attach.js');

describe('profile commands', () => {
  beforeEach(() => {
    mocks.runProfile.mockResolvedValue({ meta: {}, profiles: {}, findings: [] });
    mocks.attachProfile.mockResolvedValue({ meta: {}, profiles: {}, findings: [] });
    mocks.loadLanternaConfig.mockResolvedValue(undefined);
    mocks.loadPlugins.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.runProfile.mockReset();
    mocks.attachProfile.mockReset();
    mocks.resolveMany.mockClear();
    mocks.writeReportOutput.mockClear();
    mocks.loadLanternaConfig.mockReset();
    mocks.loadPlugins.mockReset();
    mocks.indicator.update.mockClear();
    mocks.indicator.succeed.mockClear();
    mocks.indicator.fail.mockClear();
  });

  it('runCommand writes output and returns without exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const report = { meta: {}, profiles: {}, findings: [] };
    mocks.runProfile.mockResolvedValue(report);

    await runCommand({
      command: ['node', 'app.js'],
      pretty: true,
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });

    expect(exit).not.toHaveBeenCalled();
    expect(mocks.writeReportOutput).toHaveBeenCalledWith(report, undefined, true);
    expect(mocks.indicator.succeed).toHaveBeenCalledWith('Lanterna profile complete');
  });

  it('attachCommand writes output and returns without exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const report = { meta: {}, profiles: {}, findings: [] };
    mocks.attachProfile.mockResolvedValue(report);

    await attachCommand({
      pid: 1234,
      pretty: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });

    expect(exit).not.toHaveBeenCalled();
    expect(mocks.writeReportOutput).toHaveBeenCalledWith(report, undefined, false);
    expect(mocks.indicator.succeed).toHaveBeenCalledWith('Lanterna attach capture complete');
  });

  it('resolves config and flag plugins the same way for run and attach', async () => {
    const calls: string[] = [];
    const configPlugin = vi.fn(() => calls.push('config'));
    const flagPlugin = vi.fn(() => calls.push('flag'));
    mocks.loadLanternaConfig.mockResolvedValue({ detectors: ['./config-plugin.mjs'] });
    mocks.loadPlugins.mockResolvedValue([configPlugin, flagPlugin]);

    await runCommand({
      command: ['node', 'app.js'],
      pretty: false,
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: ['./flag-plugin.mjs'],
      kinds: ['cpu'],
    });

    const runSetupPipeline = mocks.runProfile.mock.calls[0]?.[0].setupPipeline;
    await runSetupPipeline?.({} as never, { cwd: process.cwd(), mode: 'spawn' });
    expect(mocks.loadPlugins).toHaveBeenCalledWith(
      ['./config-plugin.mjs', './flag-plugin.mjs'],
      process.cwd(),
    );
    expect(calls).toEqual(['config', 'flag']);

    calls.length = 0;
    mocks.loadPlugins.mockClear();

    await attachCommand({
      pid: 1234,
      pretty: false,
      sampleIntervalMicros: 1000,
      detectors: ['./flag-plugin.mjs'],
      kinds: ['cpu'],
    });

    const attachSetupPipeline = mocks.attachProfile.mock.calls[0]?.[0].setupPipeline;
    await attachSetupPipeline?.({} as never, { cwd: process.cwd(), mode: 'attach' });
    expect(mocks.loadPlugins).toHaveBeenCalledWith(
      ['./config-plugin.mjs', './flag-plugin.mjs'],
      process.cwd(),
    );
    expect(calls).toEqual(['config', 'flag']);
  });
});
