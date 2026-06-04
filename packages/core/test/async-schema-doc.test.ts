import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asyncProfileReportSchema } from '../src/kinds/async/report-contract.js';

describe('async schema documentation', () => {
  it('keeps the generated async JSON Schema in sync with the Zod contract', () => {
    const generatedPath = resolve(
      import.meta.dirname,
      '../../../docs/generated/async-profile-report.schema.json',
    );
    const generated = JSON.parse(readFileSync(generatedPath, 'utf8'));

    expect(generated).toEqual(z.toJSONSchema(asyncProfileReportSchema));
  });
});
