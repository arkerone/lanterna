import type { AsyncCdpContext, AsyncStackFrame } from './types.js';

interface CdpCallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface CdpStackTrace {
  description?: string;
  callFrames?: CdpCallFrame[];
  parent?: CdpStackTrace;
  parentId?: unknown;
}

export type CdpAsyncContextSource = AsyncCdpContext['source'];

export function normalizeCdpAsyncStackTrace(
  source: CdpAsyncContextSource,
  stackTrace: unknown,
  capturedAtMs?: number,
): AsyncCdpContext | undefined {
  const root = asStackTrace(stackTrace);
  if (!root) return undefined;

  const asyncStack = normalizeAsyncParents(root.parent);
  const frames = [
    ...normalizeFrames(root.callFrames),
    ...asyncStack.flatMap((segment) => segment.frames),
  ];
  if (frames.length === 0 && asyncStack.length === 0) return undefined;

  return {
    source,
    proofLevel: 'cdp-debugger-async-stack',
    ...(capturedAtMs !== undefined ? { capturedAtMs } : {}),
    frames,
    asyncStack,
  };
}

export function firstCdpAsyncContextFrame(
  context: AsyncCdpContext | undefined,
): AsyncStackFrame | undefined {
  if (!context) return undefined;
  return context.frames[0] ?? context.asyncStack.find((segment) => segment.frames[0])?.frames[0];
}

function normalizeAsyncParents(parent: CdpStackTrace | undefined): AsyncCdpContext['asyncStack'] {
  const out: AsyncCdpContext['asyncStack'] = [];
  let current = parent;
  const seen = new Set<CdpStackTrace>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const frames = normalizeFrames(current.callFrames);
    if (frames.length > 0) {
      out.push({
        ...(current.description ? { description: current.description } : {}),
        frames,
      });
    }
    current = asStackTrace(current.parent);
  }
  return out;
}

function normalizeFrames(callFrames: CdpCallFrame[] | undefined): AsyncStackFrame[] {
  if (!Array.isArray(callFrames)) return [];
  const frames: AsyncStackFrame[] = [];
  for (const callFrame of callFrames) {
    const file = callFrame.url ?? '';
    if (!file) continue;
    frames.push({
      function: callFrame.functionName || '<anonymous>',
      file,
      line: Math.max(0, (callFrame.lineNumber ?? -1) + 1),
      column: Math.max(0, (callFrame.columnNumber ?? -1) + 1),
    });
  }
  return frames;
}

function asStackTrace(value: unknown): CdpStackTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as CdpStackTrace;
}
