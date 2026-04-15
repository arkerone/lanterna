import { HEARTBEAT_RESOLUTION_MS } from '../../shared/config.js';
import { getAttachRuntimeHookSource } from './hook-core.js';

export const ATTACH_RUNTIME_HOOK_SOURCE = getAttachRuntimeHookSource({
  resolutionMs: HEARTBEAT_RESOLUTION_MS,
});
