import type { RawCapture } from '../../capture/core/types.js';
import type { Finding, LanternaReport } from '../../report/types.js';
import type { TimedSample } from '../model/correlations.js';
import type { EnrichedTree, HotspotAnalysis } from '../model/hotspots.js';

export interface AnalysisOptions {
  sampleIntervalMicros: number;
  deep: boolean;
  command: string[];
  mode?: LanternaReport['meta']['mode'];
}

export type ExtensionEntry = unknown;
export type ExtensionMap = Record<string, ExtensionEntry>;

export interface AnalysisResult extends Omit<LanternaReport, 'meta' | 'extensions'> {
  extensions?: ExtensionMap;
}

export interface AnalysisSnapshot extends Omit<LanternaReport, 'extensions'> {
  extensions: ExtensionMap;
}

export interface AnalysisContext {
  readonly rawCapture: RawCapture;
  readonly options: AnalysisOptions;
  getTree(): EnrichedTree;
  getHotspotAnalysis(): HotspotAnalysis;
  getTimedSamples(): TimedSample[];
}

export interface BaseAnalyzer {
  id: string;
  order?: number;
}

export interface SectionAnalyzer<TSection = ExtensionEntry> extends BaseAnalyzer {
  kind: 'section';
  namespace: string;
  run(context: AnalysisContext, snapshot: Readonly<AnalysisSnapshot>): TSection;
}

export interface FindingAnalyzer extends BaseAnalyzer {
  kind: 'finding';
  run(context: AnalysisContext, snapshot: Readonly<AnalysisSnapshot>): Finding[];
}
