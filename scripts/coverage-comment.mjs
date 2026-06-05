// Render coverage/coverage-summary.json (the vitest json-summary reporter output)
// as a Markdown table comparing each metric against the configured thresholds.
//
// Writes the table to:
//   - stdout
//   - coverage/summary.md  (uploaded with the coverage artifact, read by the PR-comment job)
//   - $GITHUB_STEP_SUMMARY (so it shows on every CI run with no extra permissions)
//
// Exits 0 even when below threshold — the coverage gate itself (vitest thresholds)
// is what fails the build; this script only reports.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const summaryPath = resolve(repoRoot, 'coverage/coverage-summary.json');

const THRESHOLDS = { statements: 70, branches: 60, functions: 70, lines: 70 };

function row(label, metric) {
  const pct = metric?.pct ?? 0;
  const covered = metric?.covered ?? 0;
  const total = metric?.total ?? 0;
  const threshold = THRESHOLDS[label];
  const ok = pct >= threshold;
  return `| ${label} | ${pct.toFixed(2)}% | ${threshold}% | ${covered}/${total} | ${ok ? '✅' : '❌'} |`;
}

function main() {
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  } catch (error) {
    console.error(`coverage summary not found at ${summaryPath}: ${error.message}`);
    process.exit(0);
  }

  const total = summary.total ?? {};
  const lines = [
    '<!-- lanterna-coverage -->',
    '## Coverage',
    '',
    '| Metric | Covered | Threshold | Count | Gate |',
    '| --- | ---: | ---: | ---: | :---: |',
    row('statements', total.statements),
    row('branches', total.branches),
    row('functions', total.functions),
    row('lines', total.lines),
    '',
    '_Global v8 coverage across `core`, `detectors`, and `cli`. The build fails if any metric drops below its threshold._',
  ];
  const markdown = `${lines.join('\n')}\n`;

  process.stdout.write(markdown);
  writeFileSync(resolve(repoRoot, 'coverage/summary.md'), markdown, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
}

main();
