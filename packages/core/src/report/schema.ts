import { z } from 'zod';
import { cpuProfileReportSchema } from './schema/cpu-profile.js';
import { findingSchema } from './schema/findings.js';
import { metaSchema } from './schema/meta.js';

const profilesSchema = z
  .object({
    cpu: cpuProfileReportSchema.optional(),
  })
  .catchall(z.unknown());

export const lanternaReportSchema = z.object({
  meta: metaSchema,
  profiles: profilesSchema,
  findings: z.array(findingSchema),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
