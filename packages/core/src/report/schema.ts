import { type ZodType, z } from 'zod';
import type { ProfileKind } from '../kinds/core/types.js';
import { findingSchema } from './schema/findings.js';
import { metaSchema } from './schema/meta.js';

/**
 * Assembles the Lanterna report Zod schema from the kinds active in the run.
 * Each kind contributes its section schema at `profiles[sectionKey]`.
 */
export function buildReportSchema(
  kinds: ReadonlyArray<Pick<ProfileKind, 'reportSectionKey' | 'reportSchema'>>,
): ZodType {
  const profileShape: Record<string, ZodType> = {};
  for (const kind of kinds) {
    if (profileShape[kind.reportSectionKey] !== undefined) {
      throw new Error(`duplicate profile kind report section key: ${kind.reportSectionKey}`);
    }
    profileShape[kind.reportSectionKey] = kind.reportSchema.optional();
  }
  const profilesSchema = z.object(profileShape).catchall(z.unknown());

  return z.object({
    meta: metaSchema,
    profiles: profilesSchema,
    findings: z.array(findingSchema),
    extensions: z.record(z.string(), z.unknown()).optional(),
  });
}
