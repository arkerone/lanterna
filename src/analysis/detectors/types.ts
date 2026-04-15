import type { AnalysisSnapshot } from '../core/types.js';
import type { Finding, Hotspot } from '../../report/types.js';
import type { HotspotAttribution } from '../model/hotspots.js';

export interface FindingContext {
  fullHotspots: Hotspot[];
  hotspotById: Map<string, Hotspot>;
  userAttributionById: Map<string, HotspotAttribution>;
}

export interface Detector {
  id: string;
  order?: number;
  detect(report: AnalysisSnapshot, context: FindingContext): Finding[];
}
