import { resolveAttachTarget } from '../attach-target.js';
import type { AttachProfileOptions } from '../parse.js';
import { executeProfileCommand } from './profile-command.js';

export async function attachCommand(options: AttachProfileOptions): Promise<void> {
  const resolvedOptions = await resolveAttachTarget(options);
  const targetLabel =
    resolvedOptions.inspectUrl !== undefined
      ? 'the provided inspector endpoint'
      : `pid ${resolvedOptions.pid ?? 'unknown'}`;
  await executeProfileCommand({
    mode: 'attach',
    options: resolvedOptions,
    initialMessage: `Preparing attach workflow for ${targetLabel}...`,
    successMessage: 'Lanterna attach capture complete',
    failureMessage: 'Lanterna attach capture failed',
  });
}
