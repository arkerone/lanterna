import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runProfile: vi.fn(),
  attachProfile: vi.fn(),
  resolveMany: vi.fn((ids: string[]) => ids.map((id) => ({ id }))),
  writeReportOutput: vi.fn(),
  writeExistingReportOutput: vi.fn(),
  loadLanternaConfig: vi.fn(),
  loadPlugins: vi.fn(),
  indicator: {
    update: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  },
}));

vi.mock('@lanterna-profiler/core', () => ({
  createKindRegistry: vi.fn(() => ({ resolveMany: mocks.resolveMany })),
  runProfile: mocks.runProfile,
  attachProfile: mocks.attachProfile,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));

vi.mock('@lanterna-profiler/detectors', () => ({
  createBuiltInFindingAnalyzers: vi.fn(() => []),
  withBuiltInCpuDetectors: vi.fn((kind) => kind),
  createCpuProfileKindWithBuiltInDetectors: vi.fn(() => ({ id: 'cpu' })),
  createBuiltInMemoryFindingAnalyzers: vi.fn(() => []),
  withBuiltInMemoryDetectors: vi.fn((kind) => kind),
  createMemoryProfileKindWithBuiltInDetectors: vi.fn(() => ({ id: 'memory' })),
  createBuiltInAsyncFindingAnalyzers: vi.fn(() => []),
  withBuiltInAsyncDetectors: vi.fn((kind) => kind),
  createAsyncProfileKindWithBuiltInDetectors: vi.fn(() => ({ id: 'async' })),
}));

vi.mock('../src/activity-indicator.js', () => ({
  startActivityIndicator: vi.fn(() => mocks.indicator),
}));

vi.mock('../src/output.js', () => ({
  writeReportOutput: mocks.writeReportOutput,
  writeExistingReportOutput: mocks.writeExistingReportOutput,
}));

vi.mock('../src/config.js', () => ({
  loadLanternaConfig: mocks.loadLanternaConfig,
  applyLanternaConfig: (config, options) => ({
    ...options,
    detectors: [...(config?.detectors ?? []), ...(options.detectors ?? [])],
  }),
}));

vi.mock('../src/plugins.js', () => ({
  loadPlugins: mocks.loadPlugins,
}));

const { runCommand } = await import('../src/commands/run.js');
const { attachCommand } = await import('../src/commands/attach.js');
const { reportCommand } = await import('../src/commands/report.js');

describe('profile commands', () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.runProfile.mockResolvedValue({ meta: {}, profiles: {}, findings: [] });
    mocks.attachProfile.mockResolvedValue({ meta: {}, profiles: {}, findings: [] });
    mocks.loadLanternaConfig.mockResolvedValue(undefined);
    mocks.loadPlugins.mockResolvedValue({ kinds: [], setups: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.runProfile.mockReset();
    mocks.attachProfile.mockReset();
    mocks.resolveMany.mockClear();
    mocks.writeReportOutput.mockClear();
    mocks.writeExistingReportOutput.mockClear();
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
      format: 'json',
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });

    expect(exit).not.toHaveBeenCalled();
    expect(mocks.writeReportOutput).toHaveBeenCalledWith(
      report,
      undefined,
      true,
      'json',
      expect.any(Array),
    );
    expect(mocks.indicator.succeed).toHaveBeenCalledWith('Lanterna profile complete');
  });

  it('warns when the CPU profile confidence is low', async () => {
    const report = {
      meta: {},
      profiles: {
        cpu: {
          quality: {
            confidence: 'low',
            sampleCount: 83,
            durationMs: 400,
            idleRatio: 0.92,
            samplesTimed: true,
            durationBasis: 'timeDeltas',
            reasons: ['only 83 CPU samples captured', 'process was 92% idle'],
            recommendations: ['Rerun with --duration 5s or generate load during capture.'],
          },
        },
      },
      findings: [],
    };
    mocks.runProfile.mockResolvedValue(report);

    await runCommand({
      command: ['node', 'app.js'],
      pretty: true,
      format: 'json',
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });

    expect(mocks.indicator.update).toHaveBeenCalledWith(
      expect.stringContaining('Low confidence profile: only 83 CPU samples captured'),
    );
  });

  it('warns when async kind is selected', async () => {
    await runCommand({
      command: ['node', 'app.js'],
      pretty: true,
      format: 'json',
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['async'],
    });

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('--kind async is experimental'),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('Attach mode remains partial'),
    );
  });

  it('keeps the stronger warning for full async instrumentation', async () => {
    await runCommand({
      command: ['node', 'app.js'],
      pretty: true,
      format: 'json',
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['async'],
      asyncInstrumentation: 'full',
    });

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('--kind async is experimental'),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('--async-instrumentation=full is experimental'),
    );
  });

  it('attachCommand writes output and returns without exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const report = { meta: {}, profiles: {}, findings: [] };
    mocks.attachProfile.mockResolvedValue(report);

    await attachCommand({
      pid: 1234,
      pretty: false,
      format: 'json',
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });

    expect(exit).not.toHaveBeenCalled();
    expect(mocks.writeReportOutput).toHaveBeenCalledWith(
      report,
      undefined,
      false,
      'json',
      expect.any(Array),
    );
    expect(mocks.indicator.succeed).toHaveBeenCalledWith('Lanterna attach capture complete');
  });

  it('resolves config and flag plugins the same way for run and attach', async () => {
    const calls: string[] = [];
    const configPlugin = vi.fn(() => calls.push('config'));
    const flagPlugin = vi.fn(() => calls.push('flag'));
    mocks.loadLanternaConfig.mockResolvedValue({ detectors: ['./config-plugin.mjs'] });
    mocks.loadPlugins.mockResolvedValue({ kinds: [], setups: [configPlugin, flagPlugin] });

    await runCommand({
      command: ['node', 'app.js'],
      pretty: false,
      format: 'json',
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
      format: 'json',
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

  it('runCommand wires readiness and workload hooks into the capture', async () => {
    const report = { meta: {}, profiles: {}, findings: [] };
    mocks.runProfile.mockImplementation(async (options) => {
      await options.beforeCaptureStart?.();
      await options.onCaptureStarted?.();
      return report;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true } as unknown as Response);

    await runCommand({
      command: ['node', 'server.js'],
      pretty: false,
      format: 'text',
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
      waitForUrl: 'http://127.0.0.1:3000/health',
      waitTimeoutMs: 1000,
      workload: 'node -e "process.exit(0)"',
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/health', expect.any(Object));
    expect(mocks.writeReportOutput).toHaveBeenCalledWith(
      report,
      undefined,
      false,
      'text',
      expect.any(Array),
    );
  });

  it('runCommand passes agent format to report output', async () => {
    const report = { meta: {}, profiles: {}, findings: [] };
    mocks.runProfile.mockResolvedValue(report);

    await runCommand({
      command: ['node', 'app.js'],
      pretty: false,
      format: 'agent',
      deep: false,
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });

    expect(mocks.writeReportOutput).toHaveBeenCalledWith(
      report,
      undefined,
      false,
      'agent',
      expect.any(Array),
    );
  });

  it('attachCommand passes agent format to report output', async () => {
    const report = { meta: {}, profiles: {}, findings: [] };
    mocks.attachProfile.mockResolvedValue(report);

    await attachCommand({
      pid: 1234,
      pretty: false,
      format: 'agent',
      sampleIntervalMicros: 1000,
      detectors: [],
      kinds: ['cpu'],
    });

    expect(mocks.writeReportOutput).toHaveBeenCalledWith(
      report,
      undefined,
      false,
      'agent',
      expect.any(Array),
    );
  });

  it('reportCommand reads an existing report and writes the selected rendering', async () => {
    await reportCommand({
      file: 'report.json',
      pretty: false,
      format: 'markdown',
      output: 'report.md',
    });

    expect(mocks.writeExistingReportOutput).toHaveBeenCalledWith(
      'report.json',
      'report.md',
      false,
      'markdown',
    );
  });

  it('reportCommand can render an existing report for agents', async () => {
    await reportCommand({
      file: 'report.json',
      pretty: false,
      format: 'agent',
      output: 'report.agent.md',
    });

    expect(mocks.writeExistingReportOutput).toHaveBeenCalledWith(
      'report.json',
      'report.agent.md',
      false,
      'agent',
    );
  });
});
