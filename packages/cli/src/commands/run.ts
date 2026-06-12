import { basename } from 'node:path';
import type { RunProfileOptions } from '../parse.js';
import { executeProfileCommand } from './profile-command.js';

// Package-manager wrappers are themselves Node processes: the first inspector
// endpoint to come up belongs to the wrapper, so Lanterna would profile npm
// instead of the application it launches.
const PACKAGE_MANAGER_WRAPPERS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'corepack']);

export async function runCommand(options: RunProfileOptions): Promise<void> {
  warnForPackageManagerWrapper(options.command);
  const commandLabel = options.command.join(' ');
  let targetDiagnostics = '';
  const captureTargetDiagnostic = (chunk: string) => {
    targetDiagnostics += chunk;
  };
  await executeProfileCommand({
    mode: 'run',
    options,
    initialMessage: `Preparing run workflow for ${commandLabel}...`,
    successMessage: 'Lanterna profile complete',
    failureMessage: 'Lanterna profiling failed',
    readStderrSoFar: () => targetDiagnostics,
    onTargetDiagnosticChunk: captureTargetDiagnostic,
  });
}

function warnForPackageManagerWrapper(command: string[]): void {
  const first = command[0];
  if (!first) return;
  const executable = basename(first)
    .toLowerCase()
    .replace(/\.(cmd|exe|bat)$/, '');
  if (!PACKAGE_MANAGER_WRAPPERS.has(executable)) return;
  process.stderr.write(
    `lanterna: \`${executable}\` is a package-manager wrapper — Lanterna will attach to the wrapper process, not your application. ` +
      'Point it at the Node entry directly, e.g. `lanterna run -- node server.js`.\n',
  );
}
