import type { ChildProcess } from 'node:child_process';
import { INSPECTOR_STARTUP_TIMEOUT_MS } from '../../shared/config.js';
import { terminateChild } from './terminate.js';

export function waitForInspectorUrl(child: ChildProcess, stderrBuffer: string[]): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const stderr = child.stderr;
    if (!stderr) {
      reject(new Error('child has no stderr'));
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      rejectOnce(buildInspectorStartupError(
        stderrBuffer,
        `timed out waiting for inspector URL (${INSPECTOR_STARTUP_TIMEOUT_MS}ms). Is the target a node process?`,
      ));
    }, INSPECTOR_STARTUP_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      stderr.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminateChild(child);
      reject(error);
    };

    const resolveOnce = (webSocketDebuggerUrl: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveUrl(webSocketDebuggerUrl);
    };

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrBuffer.push(text);
      const match = /Debugger listening on (ws:\/\/[^\s]+)/.exec(text);
      if (match?.[1]) {
        resolveOnce(match[1]);
        return;
      }
      const unsupportedInspector = text.match(/bad option: --inspect-brk|--inspect-brk is not allowed|--require is not allowed/i);
      if (unsupportedInspector) {
        rejectOnce(buildInspectorStartupError(
          stderrBuffer,
          'unable to start Node inspector for target process. Lanterna requires Node inspector support.',
        ));
      }
    };

    const onError = (error: Error) => {
      rejectOnce(error);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      rejectOnce(buildInspectorStartupError(
        stderrBuffer,
        `target exited before inspector was ready (code=${code}, signal=${signal})`,
      ));
    };

    stderr.on('data', onData);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

function buildInspectorStartupError(stderrBuffer: string[], reason: string): Error {
  const stderr = stderrBuffer.join('').trim();
  return new Error(stderr ? `${reason}\n${stderr}` : reason);
}
