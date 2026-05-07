import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { HookInstaller } from '../framework.js';
import {
  createAwaitTransformCjsRuntimeSource,
  createAwaitTransformEsmRuntimeSource,
} from './await-transform.js';

export interface AsyncOperationsInstallerOptions {
  /** Cap on retained per-resource records. Defaults to 50 000. */
  maxRecords?: number;
  /** Sample cadence for the inflight/active series, in ms. Defaults to 100. */
  concurrencyIntervalMs?: number;
  /** Include TickObject / Microtask resources. Default false (very noisy). */
  includeMicrotasks?: boolean;
  /** How many JS stack frames to capture per init. Defaults to 8. 0 disables. */
  stackDepth?: number;
  /** How many run windows to retain per resource (for CPU attribution). Defaults to 8. */
  maxRunWindows?: number;
  /** Extra async instrumentation. `safe` patches common APIs. Defaults to safe. */
  instrumentationMode?: 'off' | 'safe' | 'full';
  /** True when hooks were installed after process startup in attach mode. */
  attachPartialCapture?: boolean;
}

/**
 * Installs an `async_hooks` collector inside the target process. Resource
 * lifecycles are aggregated into compact records exposed under
 * `globalThis.__LANTERNA_ASYNC__.read()` for CDP-side retrieval.
 *
 * On every `init`, captures a short JS stack (`Error.captureStackTrace`)
 * filtered to the user's code so detectors can point at the real call site.
 * On every `before`/`after` pair, records a `(startMs, endMs)` window so the
 * analysis contributor can attribute CPU samples to async resources.
 *
 * Overhead is non-trivial on async-heavy workloads — the kind is opt-in:
 * users have to pass `--kind async` for this installer to register.
 */
export function createAsyncOperationsInstaller(
  options: AsyncOperationsInstallerOptions = {},
): HookInstaller {
  const maxRecords = options.maxRecords ?? 50_000;
  const concurrencyIntervalMs = options.concurrencyIntervalMs ?? 100;
  const includeMicrotasks = Boolean(options.includeMicrotasks);
  const stackDepth = options.stackDepth ?? 8;
  const maxRunWindows = options.maxRunWindows ?? 8;
  const instrumentationMode = options.instrumentationMode ?? 'safe';
  const attachPartialCapture = Boolean(options.attachPartialCapture);
  const cjsAwaitTransformRuntimeSource = createAwaitTransformCjsRuntimeSource({
    oxcParserPath: awaitTransformDependencyPath('oxc-parser'),
    magicStringPath: awaitTransformDependencyPath('magic-string'),
  });
  return {
    id: 'async-operations',
    nodeOptions:
      instrumentationMode === 'full'
        ? [`--import=${createAwaitTransformLoaderRegisterUrl()}`]
        : undefined,
    source: `(${installAsyncOperations.toString()})(__lanterna, ${maxRecords}, ${concurrencyIntervalMs}, ${includeMicrotasks ? 'true' : 'false'}, ${stackDepth}, ${maxRunWindows}, ${JSON.stringify(instrumentationMode)}, ${attachPartialCapture ? 'true' : 'false'}, ${JSON.stringify(cjsAwaitTransformRuntimeSource)});`,
  };
}

const requireForAwaitTransform = createRequire(import.meta.url);

function awaitTransformDependencyPath(specifier: string): string {
  return requireForAwaitTransform.resolve(specifier);
}

function awaitTransformDependencyUrl(specifier: string): string {
  return pathToFileURL(awaitTransformDependencyPath(specifier)).href;
}

function createAwaitTransformLoaderRegisterUrl(): string {
  const registerSource = `
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(${JSON.stringify(createAwaitTransformLoaderUrl())}, pathToFileURL("./"));
`;
  return `data:text/javascript,${encodeURIComponent(registerSource)}`;
}

function createAwaitTransformLoaderUrl(): string {
  const loaderSource = `
import { readFile } from "node:fs/promises";
${createAwaitTransformEsmRuntimeSource({
  oxcParserUrl: awaitTransformDependencyUrl('oxc-parser'),
  magicStringUrl: awaitTransformDependencyUrl('magic-string'),
})}
const SHOULD_SKIP_RE = /\\/node_modules\\/|lanterna-preload-/;
function shouldTransform(url) {
  return url.startsWith('file:') && !SHOULD_SKIP_RE.test(url) && (url.endsWith('.js') || url.endsWith('.mjs') || url.endsWith('.cjs') || url.endsWith('.ts'));
}
function sourceTypeForUrl(url) {
  if (url.endsWith('.cjs')) return 'commonjs';
  return 'module';
}
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!shouldTransform(url)) return result;
  let source = result.source;
  if (source == null && result.format === 'commonjs') {
    source = await readFile(new URL(url), 'utf8');
  }
  if (source == null) return result;
  source = typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
  const transformed = transformAwaitExpressions(source, { file: url, sourceType: sourceTypeForUrl(url) });
  if (transformed.code === source) return result;
  return { ...result, source: transformed.code };
}
`;
  return `data:text/javascript,${encodeURIComponent(loaderSource)}`;
}

interface AsyncInstallerApi {
  performance: typeof globalThis.performance;
  registerGlobal(name: string, value: unknown): void;
  addResetHook(fn: () => void): void;
  addDisposeHook?(fn: () => void): void;
  releaseInstaller?(id: string): void;
  getBuiltin<T extends object>(name: string): T | null;
}

interface AsyncHooksBuiltin {
  createHook?: (callbacks: {
    init?: (asyncId: number, type: string, triggerAsyncId: number) => void;
    before?: (asyncId: number) => void;
    after?: (asyncId: number) => void;
    destroy?: (asyncId: number) => void;
    promiseResolve?: (asyncId: number) => void;
  }) => { enable: () => void; disable: () => void };
  executionAsyncId?: () => number;
}

interface RawFrame {
  function: string;
  file: string;
  line: number;
  column: number;
}

interface RawWindow {
  startMs: number;
  endMs: number;
}

interface RawRecord {
  asyncId: number;
  triggerAsyncId: number;
  kind: string;
  rawType: string;
  initAtMs: number;
  resolvedAtMs: number | undefined;
  destroyedAtMs: number | undefined;
  durationMs: number | undefined;
  runMs: number;
  runCount: number;
  orphan: boolean;
  initStack: RawFrame[];
  runWindows: RawWindow[];
  promiseRegistrationStack?: RawFrame[];
  promiseHandlerStack?: RawFrame[];
  awaitStack?: RawFrame[];
  safeRegistrationStack?: RawFrame[];
  safeHandlerStack?: RawFrame[];
}

// Serialized into the preload script. Keep self-contained.
function installAsyncOperations(
  api: AsyncInstallerApi,
  maxRecords: number,
  concurrencyIntervalMs: number,
  includeMicrotasks: boolean,
  stackDepth: number,
  maxRunWindows: number,
  instrumentationMode: 'off' | 'safe' | 'full',
  attachPartialCapture: boolean,
  cjsAwaitTransformRuntimeSource: string,
): void {
  const asyncHooks = api.getBuiltin<AsyncHooksBuiltin>('async_hooks');
  if (!asyncHooks || typeof asyncHooks.createHook !== 'function') {
    const disable = () => {
      api.releaseInstaller?.('async-operations');
    };
    api.addDisposeHook?.(disable);
    api.registerGlobal('__LANTERNA_ASYNC__', {
      read: () => ({
        available: false,
        reason: 'async_hooks module unavailable',
        maxRecords,
        records: [],
        concurrency: [],
        integrity: {
          recordsDropped: 0,
          initCount: 0,
          destroyCount: 0,
          resolveCount: 0,
          orphanCount: 0,
        },
        filteredCounts: {},
        instrumentationMode,
        attachPartialCapture,
        clockSyncUncertaintyMs: 0,
      }),
      disable,
    });
    return;
  }

  // Measure performance.now() tick resolution. NOTE this is a lower bound
  // on jitter between consecutive in-target observations — it does NOT
  // capture the offset between the V8 sampling profiler's zero-point
  // (Profiler.start) and the async installer's zero-point (captureStartMs
  // below). Those two events fire at slightly different instants in the
  // same V8 process; the skew is typically tens of ms. Cross-clock
  // attribution in `kinds/async/analysis.ts` accepts that imprecision —
  // run windows are ms-granularity by design.
  const measureClockResolutionMs = (): number => {
    let smallest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 200; i += 1) {
      const a = api.performance.now();
      let b = api.performance.now();
      let guard = 0;
      while (b === a && guard < 100) {
        b = api.performance.now();
        guard += 1;
      }
      const delta = b - a;
      if (delta > 0 && delta < smallest) smallest = delta;
    }
    return Number.isFinite(smallest) ? smallest : 0;
  };
  const clockSyncUncertaintyMs = measureClockResolutionMs();

  let captureStartMs = api.performance.now();
  const records = new Map<number, RawRecord>();
  const completedRecords = new Set<number>();
  // Open run-window timestamps keyed by asyncId (set on `before`, consumed on `after`).
  const openRuns = new Map<number, number>();
  const concurrency: Array<{ atMs: number; active: number; inflight: number }> = [];
  const filteredCounts: Record<string, number> = {};
  let recordsDropped = 0;
  let initCount = 0;
  let destroyCount = 0;
  let resolveCount = 0;
  let activeCount = 0;
  let inflightCount = 0;
  const restoredApis: Array<() => void> = [];
  let disabled = false;
  // `await` transform pushes the call-site stack here, keyed by the
  // triggerAsyncId observed at await time (the parent context creating the
  // resulting promise). The promise's own `init` then finds its entry by
  // triggerAsyncId, so an unrelated init firing in between cannot steal the
  // stack (which the previous FIFO-only design allowed).
  const pendingAwaitStacks: Array<{ stack: RawFrame[]; triggerId: number }> = [];
  const PENDING_AWAIT_CAP = 256;
  const transformStats = {
    transformed: 0,
    skipped: 0,
    failed: 0,
    partial: false,
    awaitCalls: 0,
  };

  // Frames we always drop — they're inside the profiler itself or Node's
  // async_hooks plumbing, not the user's code.
  const NOISE_FRAME_RE =
    /(?:^|\/)node:|^node_modules\/|^internal\/|lanterna-preload-|data:text\/javascript|async_hooks|installAsyncOperations|__lanterna|installLanternaFramework/;

  const captureStack = (): RawFrame[] => {
    if (stackDepth <= 0) return [];
    const previousPrepare = Error.prepareStackTrace;
    const previousLimit = Error.stackTraceLimit;
    let callsites: NodeJS.CallSite[] = [];
    try {
      Error.stackTraceLimit = Math.max(previousLimit, stackDepth + 12);
      Error.prepareStackTrace = (_error, structuredStackTrace) => structuredStackTrace;
      const holder: { stack?: NodeJS.CallSite[] } = {};
      Error.captureStackTrace(holder, captureStack);
      callsites = Array.isArray(holder.stack) ? holder.stack : [];
    } finally {
      Error.prepareStackTrace = previousPrepare;
      Error.stackTraceLimit = previousLimit;
    }
    const out: RawFrame[] = [];
    for (const callsite of callsites) {
      if (out.length >= stackDepth) break;
      const fn = callsite.getFunctionName() ?? callsite.getMethodName() ?? '<anonymous>';
      const file = callsite.getFileName() ?? '';
      if (!file) continue;
      if (NOISE_FRAME_RE.test(file) || NOISE_FRAME_RE.test(fn)) continue;
      out.push({
        function: fn,
        file,
        line: callsite.getLineNumber() ?? 0,
        column: callsite.getColumnNumber() ?? 0,
      });
    }
    return out;
  };

  const classify = (rawType: string): { kind: string; filtered: boolean } => {
    const t = rawType.toUpperCase();
    if (t === 'PROMISE') return { kind: 'promise', filtered: false };
    if (t === 'TIMERWRAP' || t === 'TIMEOUT' || t === 'INTERVAL') {
      return { kind: 'timer', filtered: false };
    }
    if (t === 'IMMEDIATE') return { kind: 'immediate', filtered: false };
    if (t.startsWith('TCP')) return { kind: 'tcp', filtered: false };
    if (t.startsWith('UDP')) return { kind: 'udp', filtered: false };
    if (t.startsWith('FS') || t === 'STATWATCHER') return { kind: 'fs', filtered: false };
    if (t.startsWith('HTTP2')) return { kind: 'http2', filtered: false };
    if (t.startsWith('HTTP')) return { kind: 'http', filtered: false };
    if (t.startsWith('TLS')) return { kind: 'tls', filtered: false };
    if (t === 'GETADDRINFOREQWRAP' || t === 'GETNAMEINFOREQWRAP' || t === 'QUERYWRAP') {
      return { kind: 'dns', filtered: false };
    }
    if (t === 'PIPEWRAP' || t === 'PIPECONNECTWRAP') return { kind: 'pipe', filtered: false };
    if (t === 'PROCESSWRAP' || t === 'SHUTDOWNWRAP') return { kind: 'process', filtered: false };
    if (t === 'TICKOBJECT') return { kind: 'tickobject', filtered: !includeMicrotasks };
    if (t === 'MICROTASK') return { kind: 'microtask', filtered: !includeMicrotasks };
    return { kind: 'other', filtered: false };
  };

  const hook = asyncHooks.createHook({
    init(asyncId: number, type: string, triggerAsyncId: number) {
      initCount += 1;
      const { kind, filtered } = classify(type);
      if (filtered) {
        filteredCounts[type] = (filteredCounts[type] ?? 0) + 1;
        return;
      }
      if (records.size >= maxRecords) {
        // Evict the oldest already-completed record (Set preserves insertion
        // order) so a long-running capture keeps room for fresh data instead
        // of blindly dropping new observations.
        const oldestCompleted = completedRecords.values().next();
        if (!oldestCompleted.done) {
          const evictId = oldestCompleted.value;
          completedRecords.delete(evictId);
          records.delete(evictId);
        } else {
          recordsDropped += 1;
          return;
        }
      }
      const now = api.performance.now() - captureStartMs;
      records.set(asyncId, {
        asyncId,
        triggerAsyncId,
        kind,
        rawType: type,
        initAtMs: now,
        resolvedAtMs: undefined,
        destroyedAtMs: undefined,
        durationMs: undefined,
        runMs: 0,
        runCount: 0,
        orphan: false,
        initStack: captureStack(),
        runWindows: [],
      });
      const rec = records.get(asyncId);
      if (kind === 'promise' && rec && pendingAwaitStacks.length > 0) {
        const idx = pendingAwaitStacks.findIndex((p) => p.triggerId === triggerAsyncId);
        if (idx >= 0) {
          const [entry] = pendingAwaitStacks.splice(idx, 1);
          if (entry && entry.stack.length > 0) rec.awaitStack = entry.stack;
        }
      }
      inflightCount += 1;
    },
    before(asyncId: number) {
      const rec = records.get(asyncId);
      if (!rec) return;
      const now = api.performance.now() - captureStartMs;
      openRuns.set(asyncId, now);
      activeCount += 1;
    },
    after(asyncId: number) {
      const rec = records.get(asyncId);
      const start = openRuns.get(asyncId);
      if (!rec || start === undefined) return;
      const now = api.performance.now() - captureStartMs;
      const elapsed = Math.max(0, now - start);
      rec.runMs += elapsed;
      rec.runCount += 1;
      // Keep up to N windows; oldest wins so we don't lose the early ones
      // (those typically map to the call site that triggered the work).
      if (rec.runWindows.length < maxRunWindows) {
        rec.runWindows.push({ startMs: start, endMs: now });
      }
      openRuns.delete(asyncId);
      if (activeCount > 0) activeCount -= 1;
    },
    destroy(asyncId: number) {
      destroyCount += 1;
      const rec = records.get(asyncId);
      if (!rec) return;
      const now = api.performance.now() - captureStartMs;
      rec.destroyedAtMs = now;
      if (rec.durationMs === undefined) rec.durationMs = now - rec.initAtMs;
      if (!completedRecords.has(asyncId)) {
        completedRecords.add(asyncId);
        if (inflightCount > 0) inflightCount -= 1;
      }
    },
    promiseResolve(asyncId: number) {
      resolveCount += 1;
      const rec = records.get(asyncId);
      if (!rec) return;
      const now = api.performance.now() - captureStartMs;
      rec.resolvedAtMs = now;
      if (rec.durationMs === undefined) rec.durationMs = now - rec.initAtMs;
      if (!completedRecords.has(asyncId)) {
        completedRecords.add(asyncId);
        if (inflightCount > 0) inflightCount -= 1;
      }
    },
  });
  hook.enable();

  const assignPromiseInstrumentation = (
    asyncId: number,
    key:
      | 'promiseRegistrationStack'
      | 'promiseHandlerStack'
      | 'awaitStack'
      | 'safeRegistrationStack'
      | 'safeHandlerStack',
    stack: RawFrame[],
  ) => {
    const rec = records.get(asyncId);
    if (!rec || stack.length === 0) return;
    (rec as RawRecord & Record<typeof key, RawFrame[]>)[key] = stack;
  };

  if (instrumentationMode !== 'off') {
    const executionAsyncId =
      typeof asyncHooks.executionAsyncId === 'function' ? asyncHooks.executionAsyncId : undefined;
    const assignCurrent = (
      key:
        | 'promiseRegistrationStack'
        | 'promiseHandlerStack'
        | 'awaitStack'
        | 'safeRegistrationStack'
        | 'safeHandlerStack',
      stack: RawFrame[],
    ) => {
      const id = executionAsyncId?.() ?? 0;
      assignPromiseInstrumentation(id, key, stack);
    };
    const originalThen = Promise.prototype.then;
    const originalCatch = Promise.prototype.catch;
    const originalFinally = Promise.prototype.finally;
    // biome-ignore lint/suspicious/noThenProperty: safe instrumentation intentionally wraps Promise callbacks.
    Promise.prototype.then = function patchedThen<TResult1 = unknown, TResult2 = never>(
      this: Promise<unknown>,
      onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      const registrationStack = captureStack();
      const wrap = <TResult>(
        handler: ((value: unknown) => TResult | PromiseLike<TResult>) | null | undefined,
      ) => {
        if (typeof handler !== 'function') return handler;
        return function wrappedPromiseHandler(
          this: unknown,
          value: unknown,
        ): TResult | PromiseLike<TResult> {
          assignCurrent('promiseRegistrationStack', registrationStack);
          assignCurrent('promiseHandlerStack', captureStack());
          return handler.call(this, value);
        };
      };
      return originalThen.call(this, wrap(onFulfilled), wrap(onRejected)) as Promise<
        TResult1 | TResult2
      >;
    };
    Promise.prototype.catch = function patchedCatch(onRejected) {
      return Promise.prototype.then.call(this, undefined, onRejected);
    };
    Promise.prototype.finally = function patchedFinally(onFinally) {
      const registrationStack = captureStack();
      const wrapped =
        typeof onFinally === 'function'
          ? function wrappedFinallyHandler(this: unknown) {
              assignCurrent('promiseRegistrationStack', registrationStack);
              assignCurrent('promiseHandlerStack', captureStack());
              return onFinally.call(this);
            }
          : onFinally;
      return originalFinally.call(this, wrapped);
    };
    restoredApis.push(() => {
      // biome-ignore lint/suspicious/noThenProperty: restore the native Promise implementation.
      Promise.prototype.then = originalThen;
      Promise.prototype.catch = originalCatch;
      Promise.prototype.finally = originalFinally;
    });

    const patchTimer = (name: 'setTimeout' | 'setInterval' | 'setImmediate') => {
      const original = globalThis[name];
      if (typeof original !== 'function') return;
      const patched = function patchedTimer(
        this: unknown,
        handler: TimerHandler,
        ...args: unknown[]
      ) {
        const registrationStack = captureStack();
        const wrapped =
          typeof handler === 'function'
            ? function wrappedTimerHandler(this: unknown, ...handlerArgs: unknown[]) {
                assignCurrent('safeRegistrationStack', registrationStack);
                assignCurrent('safeHandlerStack', captureStack());
                return handler.apply(this, handlerArgs);
              }
            : handler;
        return (original as (...timerArgs: unknown[]) => unknown).call(this, wrapped, ...args);
      };
      // Monkey-patch the timer API on `globalThis` and remember the original so
      // dispose() can restore it. The cast loosens `globalThis` to a string-keyed
      // map because the indexed assignment isn't expressible against the typed
      // global namespace; the value shape is constrained by `typeof original`.
      (globalThis as unknown as Record<typeof name, unknown>)[name] = patched as typeof original;
      restoredApis.push(() => {
        (globalThis as unknown as Record<typeof name, unknown>)[name] = original;
      });
    };
    patchTimer('setTimeout');
    patchTimer('setInterval');
    patchTimer('setImmediate');

    const originalFetch = globalThis.fetch;
    if (typeof originalFetch === 'function') {
      globalThis.fetch = function patchedFetch(
        this: unknown,
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) {
        const registrationStack = captureStack();
        assignCurrent('safeRegistrationStack', registrationStack);
        return originalFetch.call(this, input, init).then(
          (value) => {
            assignCurrent('safeHandlerStack', captureStack());
            return value;
          },
          (error) => {
            assignCurrent('safeHandlerStack', captureStack());
            throw error;
          },
        );
      } as typeof fetch;
      restoredApis.push(() => {
        globalThis.fetch = originalFetch;
      });
    }

    const patchCallbackLast = (
      owner: Record<string, unknown> | null,
      name: string,
      registerIndex?: (args: unknown[]) => number,
    ) => {
      if (!owner || typeof owner[name] !== 'function') return;
      const original = owner[name] as (...args: unknown[]) => unknown;
      owner[name] = function patchedCallbackApi(this: unknown, ...args: unknown[]) {
        const idx = registerIndex ? registerIndex(args) : args.length - 1;
        const callback = args[idx];
        if (typeof callback === 'function') {
          const registrationStack = captureStack();
          args[idx] = function wrappedCallback(this: unknown, ...callbackArgs: unknown[]) {
            assignCurrent('safeRegistrationStack', registrationStack);
            assignCurrent('safeHandlerStack', captureStack());
            return (callback as (...cbArgs: unknown[]) => unknown).apply(this, callbackArgs);
          };
        }
        return original.apply(this, args);
      };
      restoredApis.push(() => {
        owner[name] = original;
      });
    };

    const fs = api.getBuiltin<Record<string, unknown>>('fs');
    for (const name of ['readFile', 'writeFile', 'appendFile', 'readdir', 'stat', 'lstat']) {
      patchCallbackLast(fs, name);
    }

    const patchRequest = (owner: Record<string, unknown> | null) => {
      patchCallbackLast(owner, 'request', (args) => {
        const last = args.length - 1;
        return typeof args[last] === 'function' ? last : -1;
      });
    };
    patchRequest(api.getBuiltin<Record<string, unknown>>('http'));
    patchRequest(api.getBuiltin<Record<string, unknown>>('https'));

    if (instrumentationMode === 'full') {
      const wrapAwait = (value: unknown, frame?: RawFrame) => {
        transformStats.awaitCalls += 1;
        const awaitStack = frame ? [frame] : captureStack();
        const triggerId = executionAsyncId?.() ?? 0;
        if (pendingAwaitStacks.length >= PENDING_AWAIT_CAP) pendingAwaitStacks.shift();
        pendingAwaitStacks.push({ stack: awaitStack, triggerId });
        return Promise.resolve(value).then(
          (resolved) => {
            assignCurrent('awaitStack', awaitStack);
            return resolved;
          },
          (error) => {
            assignCurrent('awaitStack', awaitStack);
            throw error;
          },
        );
      };
      api.registerGlobal('__LANTERNA_ASYNC_AWAIT__', wrapAwait);
      installAwaitTransformLoader();
    }

    function installAwaitTransformLoader() {
      type CjsModuleForTransform = {
        _compile: (source: string, filename: string) => void;
      };
      const moduleBuiltin = api.getBuiltin<{
        Module?: {
          prototype?: {
            _compile?: (this: CjsModuleForTransform, source: string, filename: string) => void;
          };
        };
        prototype?: {
          _compile?: (this: CjsModuleForTransform, source: string, filename: string) => void;
        };
        _extensions?: Record<string, (mod: CjsModuleForTransform, filename: string) => void>;
      }>('module');
      const fsBuiltin = api.getBuiltin<{
        readFileSync?: (path: string, encoding: string) => string;
      }>('fs');
      const modulePrototype = moduleBuiltin?.Module?.prototype ?? moduleBuiltin?.prototype;
      const extensions = moduleBuiltin?._extensions;
      if (!modulePrototype && !extensions) {
        transformStats.skipped += 1;
        return;
      }
      if (typeof require !== 'function') {
        transformStats.skipped += 1;
        return;
      }
      const transformAwaitExpressions = new Function(
        'require',
        `${cjsAwaitTransformRuntimeSource}\nreturn transformAwaitExpressions;`,
      )(require) as (
        source: string,
        options: { file: string; sourceType?: 'script' | 'module' | 'commonjs' | 'unambiguous' },
      ) => {
        code: string;
        stats: {
          transformed: number;
          skipped: number;
          failed: number;
          partial: boolean;
          awaitCalls: number;
        };
      };
      const extensionNames = ['.js', '.mjs', '.cjs', '.ts'];
      const shouldTransform = (filename: string) => {
        if (!filename) return false;
        if (filename.includes('/node_modules/')) return false;
        if (filename.includes('lanterna-preload-')) return false;
        if (filename.startsWith('node:')) return false;
        return (
          filename.endsWith('.js') ||
          filename.endsWith('.mjs') ||
          filename.endsWith('.cjs') ||
          filename.endsWith('.ts')
        );
      };
      const sourceTypeForFilename = (filename: string) =>
        filename.endsWith('.cjs') || filename.endsWith('.js') ? 'commonjs' : 'module';
      const addTransformStats = (stats: {
        transformed: number;
        skipped: number;
        failed: number;
        partial: boolean;
      }) => {
        transformStats.transformed += stats.transformed;
        transformStats.skipped += stats.skipped;
        transformStats.failed += stats.failed;
        transformStats.partial = transformStats.partial || stats.partial;
      };
      const transformCompileSource = (source: string, filename: string) => {
        if (!shouldTransform(filename)) {
          transformStats.skipped += 1;
          return source;
        }
        if (source.includes('__LANTERNA_ASYNC_AWAIT__')) {
          transformStats.skipped += 1;
          return source;
        }
        try {
          const transformed = transformAwaitExpressions(source, {
            file: filename,
            sourceType: sourceTypeForFilename(filename),
          });
          addTransformStats(transformed.stats);
          return transformed.code;
        } catch {
          transformStats.failed += 1;
          transformStats.partial = true;
          return source;
        }
      };
      if (modulePrototype && typeof modulePrototype._compile === 'function') {
        const originalCompile = modulePrototype._compile;
        modulePrototype._compile = function lanternaAwaitCompile(
          this: CjsModuleForTransform,
          source: string,
          filename: string,
        ): void {
          originalCompile.call(this, transformCompileSource(source, filename), filename);
        };
        restoredApis.push(() => {
          modulePrototype._compile = originalCompile;
        });
        return;
      }

      if (!extensions || typeof fsBuiltin?.readFileSync !== 'function') {
        transformStats.skipped += 1;
        return;
      }
      const originals = new Map<string, (mod: CjsModuleForTransform, filename: string) => void>();
      for (const extensionName of extensionNames) {
        const original = extensions[extensionName];
        if (typeof original === 'function') originals.set(extensionName, original);
      }
      const originalJs = originals.get('.js');
      if (!originalJs) {
        transformStats.skipped += 1;
        return;
      }
      const patchedExtension = function lanternaAwaitTransform(
        mod: CjsModuleForTransform,
        filename: string,
      ): void {
        const originalExtension =
          originals.get(filename.slice(filename.lastIndexOf('.'))) ?? originalJs;
        if (!shouldTransform(filename)) {
          transformStats.skipped += 1;
          originalExtension(mod, filename);
          return;
        }
        try {
          const source = fsBuiltin.readFileSync?.(filename, 'utf8');
          if (typeof source !== 'string') {
            originalExtension(mod, filename);
            return;
          }
          mod._compile(transformCompileSource(source, filename), filename);
          return;
        } catch {
          transformStats.failed += 1;
          transformStats.partial = true;
          originalExtension(mod, filename);
        }
      };
      for (const extensionName of extensionNames) {
        extensions[extensionName] = patchedExtension;
      }
      restoredApis.push(() => {
        for (const extensionName of extensionNames) {
          const original = originals.get(extensionName);
          if (original) extensions[extensionName] = original;
          else delete extensions[extensionName];
        }
      });
    }
  }

  const sampleConcurrency = () => {
    const atMs = api.performance.now() - captureStartMs;
    concurrency.push({ atMs, active: activeCount, inflight: inflightCount });
  };
  sampleConcurrency();
  const concurrencyTimer = setInterval(sampleConcurrency, concurrencyIntervalMs);
  if (typeof concurrencyTimer.unref === 'function') concurrencyTimer.unref();

  api.addResetHook(() => {
    captureStartMs = api.performance.now();
    records.clear();
    completedRecords.clear();
    openRuns.clear();
    concurrency.length = 0;
    pendingAwaitStacks.length = 0;
    for (const key of Object.keys(filteredCounts)) delete filteredCounts[key];
    recordsDropped = 0;
    initCount = 0;
    destroyCount = 0;
    resolveCount = 0;
    activeCount = 0;
    inflightCount = 0;
  });

  const clearRetainedState = () => {
    records.clear();
    completedRecords.clear();
    openRuns.clear();
    concurrency.length = 0;
    pendingAwaitStacks.length = 0;
    for (const key of Object.keys(filteredCounts)) delete filteredCounts[key];
    recordsDropped = 0;
    initCount = 0;
    destroyCount = 0;
    resolveCount = 0;
    activeCount = 0;
    inflightCount = 0;
  };

  const disable = () => {
    if (disabled) return;
    disabled = true;
    hook.disable();
    clearInterval(concurrencyTimer);
    for (const restore of restoredApis) restore();
    restoredApis.length = 0;
    clearRetainedState();
    // ESM module hooks registered via node:module register() cannot be
    // unregistered, so transformed modules loaded after disable would still
    // call __LANTERNA_ASYNC_AWAIT__. Replace it with a passthrough so we
    // don't keep accumulating dead state.
    (globalThis as Record<string, unknown>).__LANTERNA_ASYNC_AWAIT__ = (value: unknown) => value;
    api.releaseInstaller?.('async-operations');
  };

  api.addDisposeHook?.(disable);

  api.registerGlobal('__LANTERNA_ASYNC__', {
    read: () => {
      let orphanCount = 0;
      const out: RawRecord[] = [];
      for (const rec of records.values()) {
        const isOrphan = rec.destroyedAtMs === undefined && rec.resolvedAtMs === undefined;
        if (isOrphan) orphanCount += 1;
        out.push({
          ...rec,
          orphan: isOrphan,
        });
      }
      const snapshot = {
        available: true,
        maxRecords,
        records: out,
        concurrency: concurrency.slice(),
        integrity: {
          recordsDropped,
          initCount,
          destroyCount,
          resolveCount,
          orphanCount,
        },
        filteredCounts: { ...filteredCounts },
        instrumentationMode,
        attachPartialCapture,
        clockSyncUncertaintyMs,
        transformStats: { ...transformStats },
      };
      clearRetainedState();
      return snapshot;
    },
    disable,
  });
}
