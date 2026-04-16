import type { ChildProcess } from 'node:child_process';
import {
  TERMINATE_GRACE_MS,
  TERMINATE_SIGKILL_FALLBACK_MS,
  TERMINATE_SIGTERM_WAIT_MS,
} from '../../shared/config.js';
import { sleep } from '../../shared/sleep.js';

export async function terminateSpawnedChild(
  child: ChildProcess,
  appCompleted: boolean,
  exited: boolean,
  exitPromise: Promise<void>,
): Promise<void> {
  if (!exited) {
    await Promise.race([exitPromise, sleep(TERMINATE_GRACE_MS)]);
  }

  if (!exited && !appCompleted) {
    child.kill('SIGTERM');
    await Promise.race([exitPromise, sleep(TERMINATE_SIGTERM_WAIT_MS)]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
}

export function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }, TERMINATE_SIGKILL_FALLBACK_MS).unref();
}
