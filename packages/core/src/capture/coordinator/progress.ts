export type CaptureProgressEvent = {
  stage: 'start-capture' | 'capture-running' | 'finalize-capture';
  message: string;
};

export function emitCaptureProgress(sourceOptions: unknown, event: CaptureProgressEvent): void {
  if (!sourceOptions || typeof sourceOptions !== 'object') return;
  const onProgress = (sourceOptions as { onProgress?: unknown }).onProgress;
  if (typeof onProgress !== 'function') return;
  onProgress(event);
}
