import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { asyncProfileReportSchema } from '../packages/core/dist/kinds/async/report-contract.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(repoRoot, 'docs/generated/async-profile-report.schema.json');
const output = `${JSON.stringify(z.toJSONSchema(asyncProfileReportSchema), null, 2)}\n`;
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8').catch(() => undefined);
  if (current !== output) {
    console.error(
      'docs/generated/async-profile-report.schema.json is out of sync. Run npm run docs:generate.',
    );
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}
