export { analyzeCapture } from './analysis/index.js';
export { attachProfile, runProfile } from './profile.js';
export { buildLanternaReport, serializeReport } from './report/index.js';
export type {
  LanternaReport,
  Finding,
  FindingCategory,
  FindingSeverity,
  Hotspot,
  HotStack,
  GcReport,
  EventLoopReport,
  DeoptEntry,
  ReportSummary,
  ReportMeta,
  ExtensionEntry,
  FrameCategory,
} from './report/types.js';
