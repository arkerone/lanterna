import type { LanternaReport } from '@lanterna-profiler/core';
import type { RenderableFormat, ReportRenderer } from '../types.js';
import { appendFindings } from './findings.js';
import { appendFrontmatter } from './frontmatter.js';
import { appendKindReview } from './kind-review.js';
import { appendFilesToReadFirst } from './read-targets.js';

export class AgentReportRenderer implements ReportRenderer {
  readonly format: RenderableFormat = 'agent';

  render(report: LanternaReport): string {
    const lines: string[] = [];
    appendFrontmatter(lines, report);
    lines.push('');
    appendFindings(lines, report);
    lines.push('');
    appendKindReview(lines, report);
    lines.push('');
    appendFilesToReadFirst(lines, report);
    return `${lines.join('\n').trimEnd()}\n`;
  }
}
