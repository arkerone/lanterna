import type { RunProfileOptions } from '../parse.js';
import { executeProfileCommand } from './profile-command.js';

export async function runCommand(options: RunProfileOptions): Promise<void> {
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
