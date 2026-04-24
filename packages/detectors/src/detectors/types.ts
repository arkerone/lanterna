import type {
  AnalysisSnapshot,
  CpuProfileReport,
  Finding,
  Hotspot,
  HotspotAttribution,
  LanternaReport,
  ReportMeta,
} from '@lanterna-profiler/core';

export interface FindingContext {
  fullHotspots: Hotspot[];
  hotspotById: Map<string, Hotspot>;
  userAttributionById: Map<string, HotspotAttribution>;
}

/**
 * Shape passed to CPU detectors. A thin view over the CPU analysis snapshot,
 * shaped like the v1 report so detectors stay readable (`report.hotspots`,
 * `report.gc`, etc.).
 */
export interface CpuDetectorReport extends CpuProfileReport {
  meta: ReportMeta;
  findings: Finding[];
}

export interface Detector {
  id: string;
  order?: number;
  detect(report: CpuDetectorReport, context: FindingContext): Finding[];
}

// Back-compat re-export for integrations that imported this name.
export type { AnalysisSnapshot, LanternaReport };
