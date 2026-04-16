import type { AnalysisSnapshot } from '@lanterna/core';
import type { Finding, Hotspot } from '@lanterna/core';
import type { HotspotAttribution } from '@lanterna/core';

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
