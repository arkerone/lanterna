import { fileURLToPath } from 'node:url';
import type { SourceMapResolver } from '../../../analysis/sourcemap/resolver.js';
import type {
  AsyncProfileReport,
  AsyncStackFrameReport,
  UserCallerAttribution,
} from '../../../report/types.js';
import type { AsyncCdpContext, AsyncKindData, AsyncStackFrame } from '../types.js';

export interface AsyncFrameReporter {
  toReportFrame(frame: AsyncStackFrame): AsyncStackFrameReport;
  toReportCdpContext(context: AsyncCdpContext): AsyncProfileReport['cdpAsyncContexts'][number];
  normalizeFrameFile(file: string): string;
  userCallerFromAsyncFrame(
    frame: AsyncStackFrameReport | undefined,
    options: Pick<UserCallerAttribution, 'profilePct' | 'supportPct' | 'confidence' | 'basis'>,
  ): UserCallerAttribution | undefined;
}

export function createAsyncFrameReporter(resolver?: SourceMapResolver): AsyncFrameReporter {
  const normalizeFrameFile = (file: string): string => {
    if (!file.startsWith('file://')) return file;
    try {
      return fileURLToPath(file);
    } catch {
      return file;
    }
  };

  const toReportFrame = (frame: AsyncStackFrame): AsyncStackFrameReport => {
    const source = resolver?.resolve(frame.file, frame.line, frame.column);
    const reportFrame: AsyncStackFrameReport = {
      function: frame.function,
      file: normalizeFrameFile(frame.file),
      line: frame.line,
      column: frame.column,
    };
    if (source) reportFrame.source = source;
    return reportFrame;
  };

  const toReportCdpContext = (
    context: AsyncCdpContext,
  ): AsyncProfileReport['cdpAsyncContexts'][number] => ({
    source: context.source,
    proofLevel: context.proofLevel,
    ...(context.capturedAtMs !== undefined ? { capturedAtMs: context.capturedAtMs } : {}),
    frames: context.frames.map(toReportFrame),
    asyncStack: context.asyncStack.map((segment) => ({
      ...(segment.description ? { description: segment.description } : {}),
      frames: segment.frames.map(toReportFrame),
    })),
  });

  const userCallerFromAsyncFrame = (
    frame: AsyncStackFrameReport | undefined,
    options: Pick<UserCallerAttribution, 'profilePct' | 'supportPct' | 'confidence' | 'basis'>,
  ): UserCallerAttribution | undefined => {
    if (!frame) return undefined;
    const caller: UserCallerAttribution = {
      function: frame.function,
      file: frame.file,
      line: frame.line,
      column: frame.column,
      profilePct: options.profilePct,
      supportPct: options.supportPct,
      confidence: options.confidence,
      basis: options.basis,
    };
    if (frame.source) caller.source = frame.source;
    return caller;
  };

  return {
    normalizeFrameFile,
    toReportCdpContext,
    toReportFrame,
    userCallerFromAsyncFrame,
  };
}

export function collectAsyncFrameUrls(data: AsyncKindData): Set<string> {
  const urls = new Set<string>();
  const addStack = (stack: AsyncStackFrame[] | undefined): void => {
    if (!stack) return;
    for (const frame of stack) if (frame.file) urls.add(frame.file);
  };
  for (const rec of data.records) {
    addStack(rec.initStack);
    addStack(rec.promiseRegistrationStack);
    addStack(rec.promiseHandlerStack);
    addStack(rec.awaitStack);
    addStack(rec.safeRegistrationStack);
    addStack(rec.safeHandlerStack);
    addStack(rec.executionStack);
  }
  for (const ctx of data.cdpAsyncContexts ?? []) {
    addStack(ctx.frames);
    for (const segment of ctx.asyncStack) addStack(segment.frames);
  }
  return urls;
}
