import type { ChildProcess } from 'node:child_process';
import {
  TERMINATE_GRACE_MS,
  TERMINATE_SIGKILL_FALLBACK_MS,
  TERMINATE_SIGTERM_WAIT_MS,
} from '../../shared/config.js';

export async function terminateSpawnedChild(
  child: ChildProcess,
  appCompleted: boolean,
  exited: boolean,
  exitPromise: Promise<void>,
): Promise<void> {
  if (!exited && !hasChildExited(child)) {
    await waitForExitOrDelay(exitPromise, TERMINATE_GRACE_MS);
  }

  if (!hasChildExited(child) && !appCompleted) {
    child.kill('SIGTERM');
    await waitForExitOrDelay(exitPromise, TERMINATE_SIGTERM_WAIT_MS);
    if (!hasChildExited(child)) {
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

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExitOrDelay(exitPromise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
