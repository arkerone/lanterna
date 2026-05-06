import type { LanternaReport } from '@lanterna-profiler/core';
import { AgentReportRenderer } from './agent-renderer.js';
import { MarkdownReportRenderer } from './markdown-renderer.js';
import { TextReportRenderer } from './text-renderer.js';
import type { RenderableFormat, RenderContext, ReportRenderer } from './types.js';

const renderers: ReadonlyMap<RenderableFormat, ReportRenderer> = new Map<
  RenderableFormat,
  ReportRenderer
>([
  ['text', new TextReportRenderer()],
  ['markdown', new MarkdownReportRenderer()],
  ['agent', new AgentReportRenderer()],
]);

export function getReportRenderer(format: RenderableFormat): ReportRenderer {
  const renderer = renderers.get(format);
  if (!renderer) throw new Error(`No renderer registered for format: ${format}`);
  return renderer;
}

export function renderReport(
  report: LanternaReport,
  options: { format: RenderableFormat; context?: RenderContext },
): string {
  return getReportRenderer(options.format).render(report, options.context);
}

export { AgentReportRenderer } from './agent-renderer.js';
export { MarkdownReportRenderer } from './markdown-renderer.js';
export { TextReportRenderer } from './text-renderer.js';
export type { RenderableFormat, RenderContext, ReportRenderer } from './types.js';
