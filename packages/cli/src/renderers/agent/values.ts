import type { AsyncStackFrameReport, AsyncTopOperation, Finding } from '@lanterna-profiler/core';
import { formatMs, formatPct } from '../formatting.js';

type SignalFrame = {
  selfPct?: number;
  totalPct?: number;
  score?: number;
};

export function signalFromPctFrame(frame: SignalFrame | undefined): string {
  if (typeof frame?.selfPct === 'number' && Number.isFinite(frame.selfPct)) {
    return `${formatPct(frame.selfPct)} self`;
  }
  return '—';
}

export function signalFromTotalPctFrame(frame: SignalFrame | undefined): string {
  if (typeof frame?.totalPct === 'number' && Number.isFinite(frame.totalPct)) {
    return `${formatPct(frame.totalPct)} total`;
  }
  return signalFromPctFrame(frame);
}

export function signalFromWeight(weightPct: number | undefined): string {
  if (typeof weightPct === 'number' && Number.isFinite(weightPct)) {
    return `${formatPct(weightPct)} stack weight`;
  }
  return '—';
}

export function signalFromDuration(durationMs: number | undefined): string {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) return formatMs(durationMs);
  return '—';
}

export function signalFromCpuPct(cpuPct: number | undefined): string {
  if (typeof cpuPct === 'number' && Number.isFinite(cpuPct)) return `${formatPct(cpuPct)} CPU`;
  return '—';
}

export function signalFromAsyncScore(frame: SignalFrame | undefined): string {
  if (typeof frame?.score === 'number' && Number.isFinite(frame.score)) {
    return `score ${formatRawNumber(frame.score)}`;
  }
  return '—';
}

export function signalFromAsyncHotFile(hotFile: {
  cpuPct?: number;
  totalDurationMs?: number;
  score?: number;
}): string {
  if (typeof hotFile.cpuPct === 'number' && Number.isFinite(hotFile.cpuPct)) {
    return `${formatPct(hotFile.cpuPct)} CPU`;
  }
  if (typeof hotFile.totalDurationMs === 'number' && Number.isFinite(hotFile.totalDurationMs)) {
    return `${formatMs(hotFile.totalDurationMs)} total`;
  }
  if (typeof hotFile.score === 'number' && Number.isFinite(hotFile.score)) {
    return `score ${formatRawNumber(hotFile.score)}`;
  }
  return '—';
}

export function preferredAsyncOperationFrame(
  operation: AsyncTopOperation,
): AsyncStackFrameReport | undefined {
  return (
    operation.primaryFrame ??
    operation.awaitFrame ??
    operation.executionFrame ??
    operation.cdpAsyncContextFrame ??
    operation.initFrame ??
    operation.creationFrame ??
    operation.promiseRegistrationFrame ??
    operation.promiseHandlerFrame
  );
}

export function asyncOperationFrames(operation: AsyncTopOperation): AsyncStackFrameReport[] {
  return [
    operation.initFrame,
    operation.primaryFrame,
    operation.awaitFrame,
    operation.executionFrame,
    operation.cdpAsyncContextFrame,
    operation.creationFrame,
    operation.promiseRegistrationFrame,
    operation.promiseHandlerFrame,
    ...operation.initStack,
  ].filter((frame): frame is AsyncStackFrameReport => Boolean(frame));
}

export function formatImpact(finding: Finding): string {
  const impact = finding.priority?.impactEstimateMs;
  if (typeof impact === 'number' && Number.isFinite(impact)) return formatMs(impact);
  return `${formatPct(finding.evidence.selfPct)} self`;
}

export function formatMeasurements(values: Record<string, number> | undefined): string {
  if (!values || Object.keys(values).length === 0) return 'none';
  return Object.entries(values)
    .map(([metricName, metricValue]) => `${metricName}=${formatRawNumber(metricValue)}`)
    .join(' ');
}

export function formatRemediation(remediation: Finding['remediation']): string {
  if (!remediation) return 'none';
  const entries = Object.entries(remediation)
    .filter(([, remediationValue]) => remediationValue !== undefined)
    .map(([key, remediationValue]) =>
      key === 'kind' ? `kind=${String(remediationValue)}` : `${key}=${String(remediationValue)}`,
    );
  return entries.join(' ');
}

export function formatScalarOrDash(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return formatRawNumber(value);
}

export function formatRawNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatRatio01(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'null';
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
