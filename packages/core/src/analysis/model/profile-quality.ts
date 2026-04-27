import type { ProfileQuality } from '../../report/types.js';

const HIGH_CONFIDENCE_MIN_SAMPLES = 1000;
const MEDIUM_CONFIDENCE_MIN_SAMPLES = 250;
const HIGH_CONFIDENCE_MIN_DURATION_MS = 1000;
const HIGH_IDLE_RATIO = 0.8;

export interface CpuQualityInput {
  sampleCount: number;
  durationMs: number;
  idleRatio: number;
  samplesTimed: boolean;
}

export function buildCpuProfileQuality(input: CpuQualityInput): ProfileQuality {
  const reasons: string[] = [];
  const recommendations = new Set<string>();

  if (input.sampleCount < MEDIUM_CONFIDENCE_MIN_SAMPLES) {
    reasons.push(`only ${input.sampleCount} CPU samples captured`);
    recommendations.add('Rerun with --duration 5s or capture during sustained load.');
  } else if (input.sampleCount < HIGH_CONFIDENCE_MIN_SAMPLES) {
    reasons.push(
      `${input.sampleCount} CPU samples captured; high confidence starts at ${HIGH_CONFIDENCE_MIN_SAMPLES}`,
    );
    recommendations.add('Use a longer capture when comparing close hotspots.');
  }

  if (input.durationMs < HIGH_CONFIDENCE_MIN_DURATION_MS) {
    reasons.push(
      `capture duration was ${Math.round(input.durationMs)}ms; high confidence starts at ${HIGH_CONFIDENCE_MIN_DURATION_MS}ms`,
    );
    recommendations.add('Rerun with --duration 5s or capture during sustained load.');
  }

  if (input.idleRatio >= HIGH_IDLE_RATIO) {
    reasons.push(`process was ${(input.idleRatio * 100).toFixed(0)}% idle`);
    recommendations.add('Generate representative load during the capture window.');
  }

  if (!input.samplesTimed) {
    reasons.push('CPU samples are not timestamped; hotspot timing uses the configured interval');
    recommendations.add('Treat correlated stalls and hotspot milliseconds as approximate.');
  }

  return {
    confidence: scoreCpuConfidence(input),
    sampleCount: input.sampleCount,
    durationMs: input.durationMs,
    idleRatio: input.idleRatio,
    samplesTimed: input.samplesTimed,
    durationBasis: input.samplesTimed ? 'timeDeltas' : 'sampleInterval',
    reasons,
    recommendations: Array.from(recommendations),
  };
}

function scoreCpuConfidence(input: CpuQualityInput): ProfileQuality['confidence'] {
  if (
    input.sampleCount >= HIGH_CONFIDENCE_MIN_SAMPLES &&
    input.durationMs >= HIGH_CONFIDENCE_MIN_DURATION_MS &&
    input.samplesTimed &&
    input.idleRatio < HIGH_IDLE_RATIO
  ) {
    return 'high';
  }
  if (input.sampleCount >= MEDIUM_CONFIDENCE_MIN_SAMPLES && input.idleRatio < 0.9) {
    return 'medium';
  }
  return 'low';
}
