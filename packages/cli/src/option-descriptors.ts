export interface CliOptionDescriptor {
  flag: string;
  description: string;
  hint?: string;
}

export const COMMON_CAPTURE_OPTIONS = [
  {
    flag: '--duration <ms|s|m>',
    description: 'Stop automatically after the given duration',
  },
  {
    flag: '--kind <id>',
    description: 'Profile kind to capture. Repeatable or comma-separated',
    hint: 'default cpu, built-in: cpu, memory, async',
  },
  {
    flag: '--sample-interval <us>',
    description: 'V8 CPU sample interval in microseconds',
    hint: 'default 1000',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const RUN_CAPTURE_OPTIONS = [
  {
    flag: '--deep',
    description: 'Enable deopt tracing',
    hint: 'stderr becomes noisier',
  },
  {
    flag: '--wait-for-url <url>',
    description: 'Wait for app readiness before capture',
  },
  {
    flag: '--wait-timeout <ms|s|m>',
    description: 'Readiness timeout',
    hint: 'default 30s',
  },
  {
    flag: '--capture-delay <ms|s|m>',
    description: 'Extra delay after readiness before capture',
  },
  {
    flag: '--workload <command>',
    description: 'Shell command to run in parallel during capture',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const ATTACH_CAPTURE_OPTIONS = [
  {
    flag: '--pid [pid]',
    description: 'Attach by PID, or open the interactive picker if no pid is given',
  },
  {
    flag: '--inspect-url <url>',
    description: 'Attach to an existing inspector WebSocket URL',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const MEMORY_OPTIONS = [
  {
    flag: '--heap-sample-interval <size>',
    description: 'V8 heap sampling interval (bytes or KiB/MiB)',
    hint: 'memory kind, default 512KiB',
  },
  {
    flag: '--memory-usage-interval <ms>',
    description: 'process.memoryUsage() cadence in ms',
    hint: 'memory kind, default 250',
  },
  {
    flag: '--include-memory-samples',
    description: 'Include raw process.memoryUsage() samples in JSON output',
    hint: 'memory kind',
  },
  {
    flag: '--heap-snapshot-analysis',
    description: 'Capture start/end heap snapshots and summarize retained growth',
    hint: 'memory kind, heavy',
  },
  {
    flag: '--heap-snapshot-dir <dir>',
    description: 'Directory for .heapsnapshot files',
    hint: 'memory kind, default .lanterna-heapsnapshots',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const ASYNC_OPTIONS = [
  {
    flag: '--async-max-events <n>',
    description: 'Cap on retained async resource records',
    hint: 'async kind, default 50000',
  },
  {
    flag: '--async-stack-depth <n>',
    description: 'V8 async call-stack depth (max 64)',
    hint: 'async kind, default 32',
  },
  {
    flag: '--async-include-microtasks',
    description: 'Include TickObject / Microtask resources (very noisy)',
    hint: 'async kind',
  },
  {
    flag: '--async-concurrency-interval <ms>',
    description: 'Cadence for the inflight/active concurrency series',
    hint: 'async kind, default 100',
  },
  {
    flag: '--async-instrumentation <mode>',
    description: 'Extra async instrumentation mode (full is experimental)',
    hint: 'async kind, off|safe|full, default safe',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const OUTPUT_OPTIONS = [
  {
    flag: '--output, -o <path>',
    description: 'Write report output to a file',
  },
  {
    flag: '--format <format>',
    description: 'Output format',
    hint: 'json, text, markdown',
  },
  {
    flag: '--pretty',
    description: 'Pretty-print JSON output',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const PLUGIN_OPTIONS = [
  {
    flag: '--detectors <spec>',
    description: 'Load an additional detector plugin (package name or path). Repeatable',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const GENERAL_OPTIONS = [
  {
    flag: '-h, --help',
    description: 'Show this help',
  },
] as const satisfies readonly CliOptionDescriptor[];

export const OPTION_FLAGS = {
  duration: COMMON_CAPTURE_OPTIONS[0].flag,
  kind: COMMON_CAPTURE_OPTIONS[1].flag,
  sampleInterval: COMMON_CAPTURE_OPTIONS[2].flag,
  deep: RUN_CAPTURE_OPTIONS[0].flag,
  waitForUrl: RUN_CAPTURE_OPTIONS[1].flag,
  waitTimeout: RUN_CAPTURE_OPTIONS[2].flag,
  captureDelay: RUN_CAPTURE_OPTIONS[3].flag,
  workload: RUN_CAPTURE_OPTIONS[4].flag,
  pid: ATTACH_CAPTURE_OPTIONS[0].flag,
  inspectUrl: ATTACH_CAPTURE_OPTIONS[1].flag,
  heapSampleInterval: MEMORY_OPTIONS[0].flag,
  memoryUsageInterval: MEMORY_OPTIONS[1].flag,
  includeMemorySamples: MEMORY_OPTIONS[2].flag,
  heapSnapshotAnalysis: MEMORY_OPTIONS[3].flag,
  heapSnapshotDir: MEMORY_OPTIONS[4].flag,
  asyncMaxEvents: ASYNC_OPTIONS[0].flag,
  asyncStackDepth: ASYNC_OPTIONS[1].flag,
  asyncIncludeMicrotasks: ASYNC_OPTIONS[2].flag,
  asyncConcurrencyInterval: ASYNC_OPTIONS[3].flag,
  asyncInstrumentation: ASYNC_OPTIONS[4].flag,
  output: OUTPUT_OPTIONS[0].flag,
  format: OUTPUT_OPTIONS[1].flag,
  pretty: OUTPUT_OPTIONS[2].flag,
  detectors: PLUGIN_OPTIONS[0].flag,
} as const;
