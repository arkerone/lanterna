// Single source of truth for the example suite.
//
// `EXAMPLES` are the pathological workloads (each must PRODUCE its finding).
// `FIXED_EXAMPLES` are the corrected variants (each must NOT produce the finding).
// The vitest suites (`packages/cli/test/examples.e2e.test.ts` and
// `examples.coverage.test.ts`) drive the local CLI from these lists; the table in
// `examples/README.md` mirrors them.
//
// Matching is by finding-id PREFIX (`finding.id.startsWith(stem)`), because many
// ids are dynamic (e.g. `json-on-hot-path:JSON.stringify`, `long-await:42`,
// `memory-growth:rss`, `alloc-in-hot-path:<id>`).

/**
 * @typedef {Object} ExampleSpec
 * @property {string} dir            Folder under examples/ (also the app.js location).
 * @property {string} title          Short human description of the pathology.
 * @property {string[]} kinds        Profile kinds to capture (--kind).
 * @property {boolean} [deep]        Pass --deep (deopt tracing).
 * @property {number} durationMs     Capture duration.
 * @property {string[]} expect       Finding-id stems that must appear.
 * @property {Record<string,string>} [severity]   stem -> expected severity (at least one match).
 * @property {Record<string,string>} [confidence] stem -> expected confidence (at least one match).
 * @property {boolean} [bestEffort]  If true, a missing `expect` warns instead of failing.
 * @property {string} [waitForUrl]   Readiness URL (server examples).
 * @property {string} [workload]     Load-generation command run during capture.
 */

/**
 * @typedef {Object} FixedSpec
 * @property {string} dir            Folder under examples/.
 * @property {string} app            App file to run (the corrected variant).
 * @property {string[]} kinds        Profile kinds to capture.
 * @property {boolean} [deep]        Pass --deep.
 * @property {number} durationMs     Capture duration.
 * @property {string[]} forbid       Finding-id stems that must NOT appear.
 */

/** @type {ExampleSpec[]} */
export const EXAMPLES = [
  // — CPU —
  {
    dir: 'cpu-hotspot',
    title: 'Synchronous pbkdf2 crypto on a hot path',
    kinds: ['cpu'],
    durationMs: 8000,
    expect: ['sync-crypto-on-hot-path'],
    severity: { 'sync-crypto-on-hot-path': 'critical' },
    confidence: { 'sync-crypto-on-hot-path': 'high' },
  },
  {
    dir: 'cpu-user-hotspot',
    title: 'Pure user-code function dominates self CPU',
    kinds: ['cpu'],
    durationMs: 8000,
    expect: ['cpu-hotspot'],
  },
  {
    dir: 'json-on-hot-path',
    title: 'Per-request JSON serialize + parse',
    kinds: ['cpu'],
    durationMs: 8000,
    expect: ['json-on-hot-path'],
  },
  {
    dir: 'node-modules-hotspot',
    title: 'A dependency dominates the CPU profile',
    kinds: ['cpu'],
    durationMs: 8000,
    expect: ['node-modules-hotspot'],
  },
  {
    dir: 'require-in-hot-path',
    title: 'Module graph re-resolved per request',
    kinds: ['cpu'],
    durationMs: 8000,
    expect: ['require-in-hot-path'],
  },
  {
    dir: 'excessive-gc',
    title: 'High allocation churn keeps the GC busy',
    kinds: ['cpu'],
    durationMs: 8000,
    expect: ['excessive-gc'],
  },
  {
    dir: 'deopt-loop',
    title: 'Repeated V8 deoptimization of a hot function',
    kinds: ['cpu'],
    deep: true,
    durationMs: 10000,
    expect: ['deopt-loop'],
    bestEffort: true,
  },
  {
    dir: 'event-loop-stall',
    title: 'Periodic synchronous read+parse stalls the loop',
    kinds: ['cpu'],
    durationMs: 8000,
    expect: ['event-loop-stall', 'blocking-io'],
  },

  // — Memory —
  {
    dir: 'memory-leak',
    title: 'Unbounded response cache',
    kinds: ['memory'],
    durationMs: 8000,
    expect: ['memory-growth', 'large-allocator'],
    severity: { 'memory-growth': 'critical' },
    confidence: { 'memory-growth': 'high', 'large-allocator': 'high' },
  },
  {
    dir: 'external-buffer',
    title: 'Off-heap Buffer memory dwarfs the V8 heap',
    kinds: ['memory'],
    durationMs: 8000,
    expect: ['external-buffer-pressure'],
    severity: { 'external-buffer-pressure': 'critical' },
    confidence: { 'external-buffer-pressure': 'medium' },
  },

  // — Async —
  {
    dir: 'long-await',
    title: 'Async operations without a timeout',
    kinds: ['cpu', 'async'],
    durationMs: 8000,
    expect: ['long-await'],
  },
  {
    dir: 'orphan-async',
    title: 'Async resources created but never cleaned up',
    kinds: ['async'],
    durationMs: 6000,
    expect: ['orphan-async-resource'],
  },
  {
    dir: 'microtask-flood',
    title: 'Unbounded async fan-out saturates the loop',
    kinds: ['async'],
    durationMs: 6000,
    expect: ['microtask-flood'],
  },
  {
    dir: 'deep-async-chain',
    title: 'Recursion through awaited promises',
    kinds: ['cpu', 'async'],
    durationMs: 8000,
    expect: ['deep-async-chain'],
    bestEffort: true,
  },

  // — Cross-kind —
  {
    dir: 'async-latency',
    title: 'Five async latency causes (event-loop-blocked, …)',
    kinds: ['cpu', 'async'],
    durationMs: 12000,
    expect: ['event-loop-blocked-async'],
  },
  {
    dir: 'hot-async-context',
    title: 'Most CPU runs under one async chain root',
    kinds: ['cpu', 'async'],
    durationMs: 10000,
    expect: ['hot-async-context'],
    bestEffort: true,
  },
  {
    dir: 'alloc-in-hot-path',
    title: 'One frame is CPU-hot AND a top allocator',
    kinds: ['cpu', 'memory'],
    durationMs: 8000,
    expect: ['alloc-in-hot-path'],
    severity: { 'alloc-in-hot-path': 'critical' },
    confidence: { 'alloc-in-hot-path': 'high' },
  },

  // — Realistic multi-finding server —
  {
    dir: 'realistic-server',
    title: 'HTTP API with layered pathologies (under load)',
    kinds: ['cpu', 'memory'],
    durationMs: 12000,
    expect: ['json-on-hot-path'],
    waitForUrl: 'http://127.0.0.1:7070/health',
    workload: 'node examples/load/http-load.mjs http://127.0.0.1:7070/process 32 11000',
  },
];

/**
 * Negative tests: the corrected variant of each pathology. Running these proves
 * the documented fix works AND that the detector is not a false-positive machine.
 *
 * @type {FixedSpec[]}
 */
export const FIXED_EXAMPLES = [
  {
    dir: 'cpu-hotspot',
    app: 'app.fixed.js',
    kinds: ['cpu'],
    durationMs: 7000,
    forbid: ['sync-crypto-on-hot-path'],
  },
  {
    dir: 'json-on-hot-path',
    app: 'app.fixed.js',
    kinds: ['cpu'],
    durationMs: 7000,
    forbid: ['json-on-hot-path'],
  },
  {
    dir: 'node-modules-hotspot',
    app: 'app.fixed.js',
    kinds: ['cpu'],
    durationMs: 7000,
    forbid: ['node-modules-hotspot'],
  },
  {
    dir: 'require-in-hot-path',
    app: 'app.fixed.js',
    kinds: ['cpu'],
    durationMs: 7000,
    forbid: ['require-in-hot-path'],
  },
  {
    dir: 'excessive-gc',
    app: 'app.fixed.js',
    kinds: ['cpu'],
    durationMs: 7000,
    forbid: ['excessive-gc'],
  },
  {
    dir: 'event-loop-stall',
    app: 'app.fixed.js',
    kinds: ['cpu'],
    durationMs: 7000,
    forbid: ['blocking-io', 'event-loop-stall'],
  },
  {
    dir: 'memory-leak',
    app: 'app.fixed.js',
    kinds: ['memory'],
    durationMs: 7000,
    forbid: ['memory-growth', 'large-allocator'],
  },
  {
    dir: 'external-buffer',
    app: 'app.fixed.js',
    kinds: ['memory'],
    durationMs: 7000,
    forbid: ['external-buffer-pressure'],
  },
  {
    dir: 'long-await',
    app: 'app.fixed.js',
    kinds: ['cpu', 'async'],
    durationMs: 7000,
    forbid: ['long-await'],
  },
  {
    dir: 'orphan-async',
    app: 'app.fixed.js',
    kinds: ['async'],
    durationMs: 7000,
    forbid: ['orphan-async-resource'],
  },
  {
    dir: 'microtask-flood',
    app: 'app.fixed.js',
    kinds: ['async'],
    durationMs: 7000,
    forbid: ['microtask-flood'],
  },
  {
    dir: 'alloc-in-hot-path',
    app: 'app.fixed.js',
    kinds: ['cpu', 'memory'],
    durationMs: 7000,
    forbid: ['alloc-in-hot-path'],
  },
];
