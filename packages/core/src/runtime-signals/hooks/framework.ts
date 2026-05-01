export interface HookInstaller {
  id: string;
  /** Extra Node flags needed before user code starts (for example ESM loaders). */
  nodeOptions?: string[];
  /**
   * Source fragment appended inside the composed preload script body. The
   * fragment runs with the framework helpers bound under `__lanterna.*` and
   * can register globals, schedule timers, observe perf entries, etc.
   *
   * Must be a self-contained expression — no closures over the author's file.
   * Serialized verbatim into NODE_OPTIONS --require script.
   */
  source: string;
}

export interface ComposePreloadOptions {
  resolutionMs: number;
  controlFdEnvVar?: string;
  emitLifecycle?: boolean;
}

/**
 * Composes the core runtime-hook framework with the given installer fragments
 * into a single preload script source. The framework provides:
 *
 * - `__lanterna.performance` — cached performance API
 * - `__lanterna.controlChannel.emit(event)` — best-effort control-channel write
 * - `__lanterna.registerGlobal(name, value)` — install a global
 * - `__lanterna.addResetHook(fn)` — register a hook called on capture reset
 * - `__lanterna.resolutionMs` — heartbeat resolution in ms
 * - `__lanterna.integrity` — shared integrity counters
 * - `__lanterna.getBuiltin(name)` — get a node builtin safely
 *
 * Plus the always-on pieces: control-channel, heartbeat loop, lifecycle events.
 */
export function composePreloadScript(
  installers: HookInstaller[],
  options: ComposePreloadOptions,
): string {
  const controlFdEnvVar = options.controlFdEnvVar ?? 'LANTERNA_CONTROL_FD';
  const frameworkOptions = {
    resolutionMs: options.resolutionMs,
    controlFd: '__LANTERNA_CONTROL_FD__',
    emitLifecycle: Boolean(options.emitLifecycle),
  };
  const frameworkJson = JSON.stringify(frameworkOptions).replace(
    '"__LANTERNA_CONTROL_FD__"',
    `Number(process.env.${controlFdEnvVar} || '-1')`,
  );
  const installerFragments = installers
    .map(
      (entry) =>
        `/* installer ${entry.id} */\n__lanterna.registerInstaller(${JSON.stringify(
          entry.id,
        )}, function install(){\n${entry.source}\n});`,
    )
    .join('\n');

  return `'use strict';\n(${installLanternaFramework.toString()})(${frameworkJson}, function register(__lanterna){\n${installerFragments}\n});\n`;
}

/**
 * Returns a source snippet suitable for CDP evaluation that installs the
 * framework and runs the given installer fragments.
 */
export function composeAttachScript(
  installers: HookInstaller[],
  options: Omit<ComposePreloadOptions, 'emitLifecycle'>,
): string {
  const frameworkOptions = {
    resolutionMs: options.resolutionMs,
    controlFd: -1,
    emitLifecycle: false,
  };
  const installerFragments = installers
    .map(
      (entry) =>
        `/* installer ${entry.id} */\n__lanterna.registerInstaller(${JSON.stringify(
          entry.id,
        )}, function install(){\n${entry.source}\n});`,
    )
    .join('\n');
  return `(${installLanternaFramework.toString()})(${JSON.stringify(frameworkOptions)}, function register(__lanterna){\n${installerFragments}\n})`;
}

// ---------------------------------------------------------------------------
// Framework body — serialized by Function.toString() into the preload script.
// Keep self-contained: no closures over this file's scope, no imports.
// ---------------------------------------------------------------------------

interface FrameworkOptions {
  resolutionMs?: number;
  controlFd?: number;
  emitLifecycle?: boolean;
}

interface FrameworkIntegrityCounters {
  controlChannelWriteErrors: number;
  gcObserverSetupFailed: number;
  heartbeatDropped: number;
}

interface FrameworkApi {
  performance: typeof globalThis.performance;
  resolutionMs: number;
  emitLifecycle: boolean;
  controlChannel: {
    emit(event: object): boolean;
    readonly active: boolean;
  };
  integrity: FrameworkIntegrityCounters;
  registerGlobal(name: string, value: unknown): void;
  addResetHook(fn: () => void): void;
  registerInstaller(id: string, install: () => void): void;
  getBuiltin<T extends object>(name: string): T | null;
  markGcObserverFailure(): void;
}

interface FrameworkResult {
  installed: boolean;
  reason?: string;
  capabilities: {
    eventLoop: boolean;
    gc: boolean;
    lifecycle: boolean;
  };
  integrity: FrameworkIntegrityCounters;
  resolutionMs?: number;
}

declare global {
  var __LANTERNA_FRAMEWORK__:
    | {
        ensureInstalled(): FrameworkResult;
        readonly api: FrameworkApi;
      }
    | undefined;
  var __LANTERNA_ATTACH_RUNTIME__:
    | {
        ensureInstalled(): FrameworkResult;
      }
    | undefined;
}

export function installLanternaFramework(
  options: FrameworkOptions,
  register: (api: FrameworkApi) => void,
): FrameworkResult {
  const existing = globalThis.__LANTERNA_FRAMEWORK__;
  if (existing && typeof existing.ensureInstalled === 'function') {
    register(existing.api);
    return existing.ensureInstalled();
  }

  const getBuiltin = <T extends object>(name: string): T | null => {
    const processWithBuiltins = process as typeof process & {
      getBuiltinModule?: (name: string) => unknown;
    };
    let builtin: unknown;
    if (typeof processWithBuiltins.getBuiltinModule === 'function') {
      builtin =
        processWithBuiltins.getBuiltinModule(name) ||
        processWithBuiltins.getBuiltinModule(`node:${name}`);
    } else if (typeof require === 'function') {
      builtin = require(`node:${name}`) as unknown;
    }
    return builtin && (typeof builtin === 'object' || typeof builtin === 'function')
      ? (builtin as T)
      : null;
  };

  interface PerfHooksBuiltin {
    performance?: typeof globalThis.performance;
  }
  interface FsBuiltin {
    writeSync?: (fd: number, data: string) => unknown;
  }

  const perfHooks = getBuiltin<PerfHooksBuiltin>('perf_hooks');
  const performanceApi = globalThis.performance || perfHooks?.performance;
  const controlFd = Number.isInteger(options.controlFd) ? Number(options.controlFd) : -1;
  const emitLifecycle = Boolean(options.emitLifecycle);
  const resolutionMs = Number(options.resolutionMs) || 20;

  if (!performanceApi) {
    const counters = {
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
    };
    return {
      installed: false,
      reason: 'performance API unavailable',
      capabilities: { eventLoop: false, gc: false, lifecycle: false },
      integrity: counters,
    };
  }

  const fs = controlFd >= 0 ? getBuiltin<FsBuiltin>('fs') : null;
  const integrity: FrameworkIntegrityCounters = {
    controlChannelWriteErrors: 0,
    gcObserverSetupFailed: 0,
    heartbeatDropped: 0,
  };

  const emit = (event: object): boolean => {
    if (!fs || controlFd < 0 || typeof fs.writeSync !== 'function') return false;
    try {
      fs.writeSync(controlFd, `${JSON.stringify(event)}\n`);
      return true;
    } catch {
      integrity.controlChannelWriteErrors += 1;
      return false;
    }
  };

  const controlChannel = {
    emit,
    get active() {
      return Boolean(fs) && controlFd >= 0;
    },
  };

  const resetHooks: Array<() => void> = [];
  const installedInstallers = new Set<string>();
  const addResetHook = (fn: () => void) => {
    resetHooks.push(fn);
  };

  const registerGlobal = (name: string, value: unknown) => {
    (globalThis as Record<string, unknown>)[name] = value;
  };

  const markGcObserverFailure = () => {
    integrity.gcObserverSetupFailed += 1;
  };

  const registerInstaller = (id: string, install: () => void) => {
    if (installedInstallers.has(id)) return;
    install();
    installedInstallers.add(id);
  };

  const api: FrameworkApi = {
    performance: performanceApi,
    resolutionMs,
    emitLifecycle,
    controlChannel,
    integrity,
    registerGlobal,
    addResetHook,
    registerInstaller,
    getBuiltin,
    markGcObserverFailure,
  };

  // Capabilities are populated by installers via a shared bag.
  const capabilities = { eventLoop: false, gc: false, lifecycle: emitLifecycle };
  (api as unknown as { capabilities: typeof capabilities }).capabilities = capabilities;

  // Heartbeat loop — drives capture-start + heartbeat emissions used by
  // installers that observe event-loop lag (runtime-signals). Stays on even if
  // no installer consumes it: the cost is negligible.
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let nextExpectedHeartbeatMs = 0;
  const heartbeatSamples: Array<{ atMs: number; lagMs: number }> = [];
  (api as unknown as { heartbeatSamples: typeof heartbeatSamples }).heartbeatSamples =
    heartbeatSamples;

  const scheduleHeartbeat = () => {
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      const now = performanceApi.now();
      const lagMs = Math.max(0, now - nextExpectedHeartbeatMs);
      const sample = { atMs: now, lagMs };
      heartbeatSamples.push(sample);
      const sent = emit({ type: 'heartbeat', ...sample });
      if (!sent && fs && controlFd >= 0) integrity.heartbeatDropped += 1;
      nextExpectedHeartbeatMs = now + resolutionMs;
      scheduleHeartbeat();
    }, resolutionMs);
    if (typeof heartbeatTimer?.unref === 'function') heartbeatTimer.unref();
  };

  const startCapture = () => {
    heartbeatSamples.length = 0;
    for (const fn of resetHooks) {
      try {
        fn();
      } catch {
        /* isolate installers */
      }
    }
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    nextExpectedHeartbeatMs = performanceApi.now() + resolutionMs;
    scheduleHeartbeat();
    emit({ type: 'capture-start', atMs: 0, resolutionMs });
  };

  (api as unknown as { startCapture: typeof startCapture }).startCapture = startCapture;

  // Give installers a chance to register before we start the capture clock and
  // emit hook-ready. An installer throwing doesn't stop the others.
  try {
    register(api);
  } catch (error) {
    return {
      installed: false,
      reason: `installer failed: ${(error as Error).message ?? 'unknown'}`,
      capabilities,
      integrity,
    };
  }

  emit({
    type: 'hook-ready',
    eventLoopResolutionMs: resolutionMs,
    capabilities,
    integrity,
  });
  startCapture();

  if (emitLifecycle) {
    let completionSent = false;
    const sendCompletion = (source: string, code?: number | null) => {
      if (completionSent) return;
      completionSent = true;
      emit({
        type: 'app-complete',
        atMs: performanceApi.now(),
        source,
        code: code ?? null,
        integrity: { ...integrity },
      });
      // Hold briefly so the profiler has time to drain before shutdown.
      setTimeout(() => {}, 250);
    };
    const originalExit = process.exit.bind(process);
    (process as unknown as { exit: (code?: number) => void }).exit = function patchedExit(
      code?: number,
    ) {
      sendCompletion('process.exit', code);
      return originalExit(code);
    };
    process.once('beforeExit', (code) => sendCompletion('beforeExit', code));
    process.once('exit', (code) => sendCompletion('exit', code));
    process.once('uncaughtExceptionMonitor', (err) => {
      emit({
        type: 'crash',
        atMs: performanceApi.now(),
        kind: 'uncaughtException',
        message: String(
          err && typeof err === 'object' && 'message' in err
            ? (err as { message: unknown }).message
            : err,
        ),
      });
    });
    process.once('unhandledRejection', (reason) => {
      emit({
        type: 'crash',
        atMs: performanceApi.now(),
        kind: 'unhandledRejection',
        message: String(reason),
      });
    });
  }

  const result: FrameworkResult = {
    installed: true,
    capabilities,
    integrity,
    resolutionMs,
  };

  globalThis.__LANTERNA_FRAMEWORK__ = {
    ensureInstalled: () => ({ ...result, integrity: { ...integrity }, capabilities }),
    api,
  };
  globalThis.__LANTERNA_ATTACH_RUNTIME__ = {
    ensureInstalled: () => ({ ...result, integrity: { ...integrity }, capabilities }),
  };

  return result;
}
