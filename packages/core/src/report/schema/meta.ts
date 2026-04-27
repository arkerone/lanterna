import { z } from 'zod';

const captureDiagnosticStageSchema = z.enum([
  'probe-install',
  'probe-start',
  'probe-stop',
  'runtime-read',
  'analysis-contributor',
  'section-analyzer',
  'finding-analyzer',
  'finalize',
]);

const captureDiagnosticSchema = z.object({
  stage: captureDiagnosticStageSchema,
  message: z.string().min(1),
  kindId: z.string().min(1).optional(),
  analyzerId: z.string().min(1).optional(),
});

export const metaSchema = z.object({
  schemaVersion: z.string().min(1),
  nodeVersion: z.string().min(1),
  v8Version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
  durationMs: z.number(),
  cwd: z.string().min(1),
  command: z.array(z.string()),
  lanternaVersion: z.string().min(1),
  mode: z.enum(['spawn', 'attach', 'in-process']),
  profileKinds: z.array(z.string().min(1)),
  kinds: z.record(z.string(), z.unknown()),
  captureIntegrity: z.object({
    controlChannel: z.boolean(),
    controlChannelExpected: z.boolean(),
    eventLoopTimed: z.boolean(),
    gcTimed: z.boolean(),
    gcObserverAvailable: z.boolean(),
    controlChannelWriteErrors: z.number().int().nonnegative(),
    gcObserverSetupFailed: z.number().int().nonnegative(),
    heartbeatDropped: z.number().int().nonnegative(),
    diagnostics: z.array(captureDiagnosticSchema).optional(),
    kinds: z.record(z.string(), z.unknown()),
  }),
});
