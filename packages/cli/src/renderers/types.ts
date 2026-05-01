import type { LanternaReport } from '@lanterna-profiler/core';
import type { OutputFormat } from '../parse.js';

/** Output formats that go through a {@link ReportRenderer}. JSON is handled separately. */
export type RenderableFormat = Exclude<OutputFormat, 'json'>;

/**
 * Optional context passed to a renderer. Reserved for future
 * per-render options (color, max width, locale, ...).
 */
export type RenderContext = Record<PropertyKey, never>;

/**
 * Contract every renderer must satisfy. Implementations live in their
 * own files (text, markdown, ...) and are registered in `index.ts`.
 */
export interface ReportRenderer {
  readonly format: RenderableFormat;
  render(report: LanternaReport, context?: RenderContext): string;
}
