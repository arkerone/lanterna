import type { Finding, Hotspot, LanternaReport } from '../../report/types.js';
import type { HotspotAttribution } from '../hotspots.js';

export interface FindingContext {
  fullHotspots: Hotspot[];
  hotspotById: Map<string, Hotspot>;
  userAttributionById: Map<string, HotspotAttribution>;
}

export interface Detector {
  id: string;
  detect(report: LanternaReport, context: FindingContext): Finding[];
}
