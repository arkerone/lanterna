import { analyzeCapture } from './analysis/index.js';
import { startAttachCapture } from './capture/attach.js';
import { startSpawnCapture } from './capture/spawn.js';
import { buildLanternaReport } from './report/index.js';
import { sleep } from './shared/sleep.js';
import type { LanternaReport } from './report/types.js';

export interface RunProfileOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  pretty: boolean;
  deep: boolean;
  sampleIntervalMicros: number;
}

export interface AttachProfileOptions {
  pid?: number;
  inspectUrl?: string;
  durationMs: number;
  output?: string;
  pretty: boolean;
  sampleIntervalMicros: number;
}

export async function runProfile(options: RunProfileOptions): Promise<LanternaReport> {
  const handle = await startSpawnCapture({
    command: options.command,
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
  });

  if (options.durationMs !== undefined) {
    await Promise.race([sleep(options.durationMs), handle.waitForExit()]);
  } else {
    await handle.waitForExit();
  }

  const rawCapture = await handle.stop();
  const analysis = analyzeCapture(rawCapture, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
    command: options.command,
    mode: 'spawn',
  });

  return buildLanternaReport(rawCapture, analysis, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
    command: options.command,
    mode: 'spawn',
  });
}

export async function attachProfile(options: AttachProfileOptions): Promise<LanternaReport> {
  const handle = await startAttachCapture({
    pid: options.pid,
    inspectUrl: options.inspectUrl,
    sampleIntervalMicros: options.sampleIntervalMicros,
  });

  await Promise.race([sleep(options.durationMs), handle.waitForExit()]);

  const rawCapture = await handle.stop();
  const analysis = analyzeCapture(rawCapture, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: false,
    command: [],
    mode: 'attach',
  });

  return buildLanternaReport(rawCapture, analysis, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: false,
    command: [],
    mode: 'attach',
  });
}
