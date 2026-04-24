/**
 * Error-path tests for the capture lifecycle.
 *
 * All tests here use real process spawning and OS signal sending — no mocks.
 * They exercise conditions that must reject fast (ENOENT, invalid args, ESRCH)
 * so the entire suite stays well under the default 20 s test timeout.
 */

import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { PreloadContribution, SpawnStartOptions } from '../src/capture/core/types.js';
import { SpawnSource } from '../src/capture/spawn.js';
import { openInspectorForPid } from '../src/inspector/discovery.js';
import { DEFAULT_SAMPLE_INTERVAL_MICROS } from '../src/shared/config.js';

const EMPTY_PRELOAD: PreloadContribution = {
  preloadScript: '/* empty */\n',
  attachScript: '/* empty */',
  controlFd: 3,
};

function startSpawnCapture(options: SpawnStartOptions) {
  return new SpawnSource().connect(options, EMPTY_PRELOAD);
}

async function listCurrentPreloadFiles(): Promise<Set<string>> {
  const files = await readdir(tmpdir());
  return new Set(files.filter((file) => file.startsWith(`lanterna-preload-${process.pid}-`)));
}

// ---------------------------------------------------------------------------
// startSpawnCapture — spawn-time failures
// ---------------------------------------------------------------------------

describe('startSpawnCapture', () => {
  it('rejects immediately when the command array is empty', async () => {
    await expect(
      startSpawnCapture({
        command: [],
        sampleIntervalMicros: DEFAULT_SAMPLE_INTERVAL_MICROS,
        deep: false,
      }),
    ).rejects.toThrow('command is empty');
  });

  it('rejects when the binary does not exist (ENOENT)', async () => {
    // spawn() emits an 'error' event before printing any inspector URL.
    await expect(
      startSpawnCapture({
        command: ['__lanterna_test_no_such_binary__'],
        sampleIntervalMicros: DEFAULT_SAMPLE_INTERVAL_MICROS,
        deep: false,
      }),
    ).rejects.toThrow();
  });

  // `sh` is not available on Windows, and NODE_OPTIONS has no effect on non-Node
  // binaries, so sh exits immediately without emitting any inspector URL.
  it.runIf(process.platform !== 'win32')(
    'rejects when the process exits before emitting an inspector URL',
    async () => {
      await expect(
        startSpawnCapture({
          command: ['sh', '-c', 'exit 1'],
          sampleIntervalMicros: DEFAULT_SAMPLE_INTERVAL_MICROS,
          deep: false,
        }),
      ).rejects.toThrow(/target exited before inspector was ready/);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'removes the temporary preload file when startup fails before connect returns',
    async () => {
      const before = await listCurrentPreloadFiles();

      await expect(
        startSpawnCapture({
          command: ['sh', '-c', 'exit 1'],
          sampleIntervalMicros: DEFAULT_SAMPLE_INTERVAL_MICROS,
          deep: false,
        }),
      ).rejects.toThrow(/target exited before inspector was ready/);

      const after = await listCurrentPreloadFiles();
      expect([...after].filter((file) => !before.has(file))).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// openInspectorForPid — pid resolution failures
// ---------------------------------------------------------------------------

describe('openInspectorForPid', () => {
  it('rejects for pid 0', async () => {
    await expect(openInspectorForPid(0)).rejects.toThrow('invalid --pid: 0');
  });

  it('rejects for a negative pid', async () => {
    await expect(openInspectorForPid(-1)).rejects.toThrow('invalid --pid: -1');
  });

  it('rejects for a non-integer pid', async () => {
    await expect(openInspectorForPid(1.5)).rejects.toThrow('invalid --pid: 1.5');
  });

  // Windows rejects --pid before any network or signal work.
  it.runIf(process.platform === 'win32')(
    'rejects with a platform-specific message on Windows',
    async () => {
      await expect(openInspectorForPid(1234)).rejects.toThrow(/not supported on Windows/);
    },
  );

  // On POSIX: after a fast port scan (all connection-refused), SIGUSR1 is sent
  // to a PID that cannot exist on any real system and fails with ESRCH.
  it.runIf(process.platform !== 'win32')(
    'rejects when SIGUSR1 cannot be delivered to a non-existent pid',
    async () => {
      const impossiblePid = 999_999_999;
      await expect(openInspectorForPid(impossiblePid)).rejects.toThrow(
        new RegExp(`failed to signal pid ${impossiblePid} with SIGUSR1`),
      );
    },
  );
});
