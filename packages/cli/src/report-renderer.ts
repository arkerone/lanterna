import type {
  CpuProfileReport,
  CpuSummary,
  DeoptEntry,
  EventLoopReport,
  Finding,
  FindingMeasurements,
  FindingPriority,
  FindingRemediation,
  GcReport,
  ReportHeapSnapshotAnalysisReport as HeapSnapshotAnalysisReport,
  HotStack,
  HotStackCluster,
  Hotspot,
  LanternaReport,
  MemoryHotAllocator,
  MemoryProfileReport,
  MemorySeriesStats,
  MemoryUsageSample,
  ProfileQuality,
  ReportMeta,
} from '@lanterna-profiler/core';
import type { OutputFormat } from './parse.js';

export function renderReport(
  report: LanternaReport,
  options: { format: Exclude<OutputFormat, 'json'> },
): string {
  return options.format === 'markdown' ? renderMarkdown(report) : renderText(report);
}

function renderText(report: LanternaReport): string {
  const lines: string[] = [];
  lines.push('Lanterna Report');
  lines.push('');
  pushMetaText(lines, report.meta);
  lines.push('');

  const cpu = report.profiles?.cpu;
  if (cpu) {
    lines.push('CPU');
    pushCpuText(lines, cpu, '  ');
    lines.push('');
  }

  const memory = report.profiles?.memory;
  if (memory) {
    lines.push('Memory');
    pushMemoryText(lines, memory, '  ');
    lines.push('');
  }

  lines.push('Findings');
  pushFindingsText(lines, report.findings ?? [], '  ');

  if (report.extensions && Object.keys(report.extensions).length > 0) {
    lines.push('');
    lines.push('Extensions');
    for (const [name, value] of Object.entries(report.extensions)) {
      lines.push(`  ${name}:`);
      for (const line of jsonLines(value)) lines.push(`    ${line}`);
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderMarkdown(report: LanternaReport): string {
  const lines: string[] = [];
  lines.push('# Lanterna Report');
  lines.push('');
  pushMetaMarkdown(lines, report.meta);
  lines.push('');

  const cpu = report.profiles?.cpu;
  if (cpu) {
    lines.push('## CPU');
    lines.push('');
    pushCpuMarkdown(lines, cpu);
    lines.push('');
  }

  const memory = report.profiles?.memory;
  if (memory) {
    lines.push('## Memory');
    lines.push('');
    pushMemoryMarkdown(lines, memory);
    lines.push('');
  }

  lines.push('## Findings');
  lines.push('');
  pushFindingsMarkdown(lines, report.findings ?? []);

  if (report.extensions && Object.keys(report.extensions).length > 0) {
    lines.push('');
    lines.push('## Extensions');
    lines.push('');
    for (const [name, value] of Object.entries(report.extensions)) {
      lines.push(`### ${name}`);
      lines.push('');
      lines.push('```json');
      for (const line of jsonLines(value)) lines.push(line);
      lines.push('```');
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function pushMetaText(lines: string[], meta: ReportMeta | undefined): void {
  if (!meta) {
    lines.push('Meta: (unknown)');
    return;
  }
  lines.push('Meta:');
  lines.push(`  Mode: ${meta.mode}`);
  lines.push(`  Started: ${meta.startedAt}`);
  lines.push(`  Duration: ${formatMs(meta.durationMs)}`);
  lines.push(`  Command: ${formatCommand(meta.command)}`);
  lines.push(`  Cwd: ${meta.cwd}`);
  lines.push(`  Pid: ${meta.pid}`);
  lines.push(`  Node: ${meta.nodeVersion} (V8 ${meta.v8Version})`);
  lines.push(`  Platform: ${meta.platform}/${meta.arch}`);
  lines.push(`  Lanterna: ${meta.lanternaVersion} (schema ${meta.schemaVersion})`);
  lines.push(`  Kinds: ${formatList(meta.profileKinds)}`);
  const integrity = meta.captureIntegrity;
  if (integrity) {
    lines.push('  Capture integrity:');
    lines.push(
      `    Control channel: ${formatBool(integrity.controlChannel)}${integrity.controlChannelExpected ? '' : ' (not expected)'}`,
    );
    lines.push(`    Event loop timed: ${formatBool(integrity.eventLoopTimed)}`);
    lines.push(
      `    GC timed: ${formatBool(integrity.gcTimed)} (observer: ${formatBool(integrity.gcObserverAvailable)})`,
    );
    if (integrity.controlChannelWriteErrors > 0) {
      lines.push(`    Control-channel write errors: ${integrity.controlChannelWriteErrors}`);
    }
    if (integrity.gcObserverSetupFailed > 0) {
      lines.push(`    GC observer setup failed: ${integrity.gcObserverSetupFailed}`);
    }
    if (integrity.heartbeatDropped > 0) {
      lines.push(`    Heartbeats dropped: ${integrity.heartbeatDropped}`);
    }
    if (integrity.diagnostics && integrity.diagnostics.length > 0) {
      lines.push('    Diagnostics:');
      for (const diag of integrity.diagnostics) {
        lines.push(`      - ${formatDiagnostic(diag)}`);
      }
    }
  }
}

function pushMetaMarkdown(lines: string[], meta: ReportMeta | undefined): void {
  if (!meta) {
    lines.push('_No meta available._');
    return;
  }
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Mode | ${escapePipe(meta.mode)} |`);
  lines.push(`| Started | ${escapePipe(meta.startedAt)} |`);
  lines.push(`| Duration | ${formatMs(meta.durationMs)} |`);
  lines.push(`| Command | \`${escapeBackticks(formatCommand(meta.command))}\` |`);
  lines.push(`| Cwd | \`${escapeBackticks(meta.cwd)}\` |`);
  lines.push(`| Pid | ${meta.pid} |`);
  lines.push(`| Node | ${escapePipe(meta.nodeVersion)} (V8 ${escapePipe(meta.v8Version)}) |`);
  lines.push(`| Platform | ${escapePipe(`${meta.platform}/${meta.arch}`)} |`);
  lines.push(
    `| Lanterna | ${escapePipe(meta.lanternaVersion)} (schema ${escapePipe(meta.schemaVersion)}) |`,
  );
  lines.push(`| Kinds | ${escapePipe(formatList(meta.profileKinds))} |`);

  const integrity = meta.captureIntegrity;
  if (integrity) {
    lines.push('');
    lines.push('### Capture integrity');
    lines.push('');
    lines.push(
      `- Control channel: ${formatBool(integrity.controlChannel)}${integrity.controlChannelExpected ? '' : ' (not expected)'}`,
    );
    lines.push(`- Event loop timed: ${formatBool(integrity.eventLoopTimed)}`);
    lines.push(
      `- GC timed: ${formatBool(integrity.gcTimed)} (observer: ${formatBool(integrity.gcObserverAvailable)})`,
    );
    if (integrity.controlChannelWriteErrors > 0) {
      lines.push(`- Control-channel write errors: ${integrity.controlChannelWriteErrors}`);
    }
    if (integrity.gcObserverSetupFailed > 0) {
      lines.push(`- GC observer setup failed: ${integrity.gcObserverSetupFailed}`);
    }
    if (integrity.heartbeatDropped > 0) {
      lines.push(`- Heartbeats dropped: ${integrity.heartbeatDropped}`);
    }
    if (integrity.diagnostics && integrity.diagnostics.length > 0) {
      lines.push('');
      lines.push('Diagnostics:');
      for (const diag of integrity.diagnostics) {
        lines.push(`- ${escapePipe(formatDiagnostic(diag))}`);
      }
    }
  }
}

function pushCpuText(lines: string[], cpu: CpuProfileReport, indent: string): void {
  pushQualityText(lines, cpu.quality, indent);
  pushCpuSummaryText(lines, cpu.summary, indent);
  pushEventLoopText(lines, cpu.eventLoop, indent);
  pushGcText(lines, cpu.gc, indent);
  lines.push(`${indent}Hotspots:`);
  pushHotspotsText(lines, cpu.hotspots ?? [], `${indent}  `);
  if (cpu.hotStacks && cpu.hotStacks.length > 0) {
    lines.push(`${indent}Hot stacks:`);
    pushHotStacksText(lines, cpu.hotStacks, `${indent}  `);
  }
  if (cpu.hotStackClusters && cpu.hotStackClusters.length > 0) {
    lines.push(`${indent}Hot stack clusters:`);
    pushHotStackClustersText(lines, cpu.hotStackClusters, `${indent}  `);
  }
  if (cpu.deopts && cpu.deopts.length > 0) {
    lines.push(`${indent}Deopts:`);
    pushDeoptsText(lines, cpu.deopts, `${indent}  `);
  }
}

function pushCpuMarkdown(lines: string[], cpu: CpuProfileReport): void {
  lines.push('### Quality');
  lines.push('');
  pushQualityMarkdown(lines, cpu.quality);
  lines.push('');
  lines.push('### Summary');
  lines.push('');
  pushCpuSummaryMarkdown(lines, cpu.summary);
  lines.push('');
  lines.push('### Event loop');
  lines.push('');
  pushEventLoopMarkdown(lines, cpu.eventLoop);
  lines.push('');
  lines.push('### Garbage collection');
  lines.push('');
  pushGcMarkdown(lines, cpu.gc);
  lines.push('');
  lines.push('### Hotspots');
  lines.push('');
  pushHotspotsMarkdown(lines, cpu.hotspots ?? []);
  if (cpu.hotStacks && cpu.hotStacks.length > 0) {
    lines.push('');
    lines.push('### Hot stacks');
    lines.push('');
    pushHotStacksMarkdown(lines, cpu.hotStacks);
  }
  if (cpu.hotStackClusters && cpu.hotStackClusters.length > 0) {
    lines.push('');
    lines.push('### Hot stack clusters');
    lines.push('');
    pushHotStackClustersMarkdown(lines, cpu.hotStackClusters);
  }
  if (cpu.deopts && cpu.deopts.length > 0) {
    lines.push('');
    lines.push('### Deopts');
    lines.push('');
    pushDeoptsMarkdown(lines, cpu.deopts);
  }
}

function pushQualityText(lines: string[], quality: ProfileQuality, indent: string): void {
  lines.push(`${indent}Quality:`);
  lines.push(`${indent}  Confidence: ${quality.confidence}`);
  lines.push(
    `${indent}  Samples: ${quality.sampleCount} (timed: ${formatBool(quality.samplesTimed)}, basis: ${quality.durationBasis})`,
  );
  lines.push(`${indent}  Idle ratio: ${formatRatio(quality.idleRatio)}`);
  if (quality.reasons.length > 0) {
    lines.push(`${indent}  Reasons:`);
    for (const reason of quality.reasons) lines.push(`${indent}    - ${reason}`);
  }
  if (quality.recommendations.length > 0) {
    lines.push(`${indent}  Recommendations:`);
    for (const rec of quality.recommendations) lines.push(`${indent}    - ${rec}`);
  }
}

function pushQualityMarkdown(lines: string[], quality: ProfileQuality): void {
  lines.push(`- Confidence: ${quality.confidence}`);
  lines.push(
    `- Samples: ${quality.sampleCount} (timed: ${formatBool(quality.samplesTimed)}, basis: ${quality.durationBasis})`,
  );
  lines.push(`- Idle ratio: ${formatRatio(quality.idleRatio)}`);
  if (quality.reasons.length > 0) {
    lines.push('- Reasons:');
    for (const reason of quality.reasons) lines.push(`  - ${reason}`);
  }
  if (quality.recommendations.length > 0) {
    lines.push('- Recommendations:');
    for (const rec of quality.recommendations) lines.push(`  - ${rec}`);
  }
}

function pushCpuSummaryText(lines: string[], summary: CpuSummary, indent: string): void {
  lines.push(`${indent}Summary:`);
  lines.push(`${indent}  Total CPU: ${formatMs(summary.totalCpuMs)}`);
  lines.push(
    `${indent}  On CPU: ${formatRatio(summary.onCpuRatio)} (idle ${formatRatio(summary.idleRatio)})`,
  );
  lines.push(
    `${indent}  Mix: user ${formatRatio(summary.userCodeRatio)} | node_modules ${formatRatio(summary.nodeModulesRatio)} | builtin ${formatRatio(summary.builtinRatio)} | native ${formatRatio(summary.nativeRatio)} | gc ${formatRatio(summary.gcRatio)}`,
  );
  lines.push(`${indent}  Top category: ${summary.topCategory}`);
  lines.push(`${indent}  Dominant blocking kind: ${summary.dominantBlockingKind ?? 'none'}`);
  if (summary.topUserHotspot) {
    const h = summary.topUserHotspot;
    lines.push(
      `${indent}  Top user hotspot: ${h.function} (${formatLocation(h.file, h.line)}) — self ${formatPct(h.selfPct)}, total ${formatPct(h.totalPct)}`,
    );
    if (h.eventLoopCorrelation) {
      lines.push(
        `${indent}    Event-loop correlation: overlap ${formatPct(h.eventLoopCorrelation.overlapPct)}, sample ${formatPct(h.eventLoopCorrelation.samplePct)}`,
      );
    }
    if (h.alternativeHotspots && h.alternativeHotspots.length > 0) {
      lines.push(`${indent}    Alternative hotspots:`);
      for (const alt of h.alternativeHotspots) {
        lines.push(
          `${indent}      - ${alt.function} (${formatLocation(alt.file, alt.line)}) self ${formatPct(alt.selfPct)}, total ${formatPct(alt.totalPct)}`,
        );
      }
    }
  }
}

function pushCpuSummaryMarkdown(lines: string[], summary: CpuSummary): void {
  lines.push(`- Total CPU: ${formatMs(summary.totalCpuMs)}`);
  lines.push(
    `- On CPU: ${formatRatio(summary.onCpuRatio)} (idle ${formatRatio(summary.idleRatio)})`,
  );
  lines.push('- Mix:');
  lines.push(`  - user: ${formatRatio(summary.userCodeRatio)}`);
  lines.push(`  - node_modules: ${formatRatio(summary.nodeModulesRatio)}`);
  lines.push(`  - builtin: ${formatRatio(summary.builtinRatio)}`);
  lines.push(`  - native: ${formatRatio(summary.nativeRatio)}`);
  lines.push(`  - gc: ${formatRatio(summary.gcRatio)}`);
  lines.push(`- Top category: ${summary.topCategory}`);
  lines.push(`- Dominant blocking kind: ${summary.dominantBlockingKind ?? 'none'}`);
  if (summary.topUserHotspot) {
    const h = summary.topUserHotspot;
    lines.push(
      `- Top user hotspot: \`${escapeBackticks(h.function)}\` at \`${escapeBackticks(formatLocation(h.file, h.line))}\` — self ${formatPct(h.selfPct)}, total ${formatPct(h.totalPct)}`,
    );
    if (h.eventLoopCorrelation) {
      lines.push(
        `  - Event-loop correlation: overlap ${formatPct(h.eventLoopCorrelation.overlapPct)}, sample ${formatPct(h.eventLoopCorrelation.samplePct)}`,
      );
    }
    if (h.alternativeHotspots && h.alternativeHotspots.length > 0) {
      lines.push('  - Alternative hotspots:');
      for (const alt of h.alternativeHotspots) {
        lines.push(
          `    - \`${escapeBackticks(alt.function)}\` at \`${escapeBackticks(formatLocation(alt.file, alt.line))}\` self ${formatPct(alt.selfPct)}, total ${formatPct(alt.totalPct)}`,
        );
      }
    }
  }
}

function pushEventLoopText(lines: string[], el: EventLoopReport, indent: string): void {
  lines.push(`${indent}Event loop:`);
  if (!el.available) {
    lines.push(`${indent}  Available: no`);
    return;
  }
  lines.push(
    `${indent}  Lag: max ${formatMs(el.maxLagMs)} | p99 ${formatMs(el.p99LagMs)} | p50 ${formatMs(el.p50LagMs)} | mean ${formatMs(el.meanLagMs)}`,
  );
  lines.push(
    `${indent}  Samples: ${el.sampleCount} (basis: ${el.measurementBasis}, confidence: ${el.confidence})`,
  );
  if (el.histogram) {
    lines.push(
      `${indent}  Histogram: max ${formatMs(el.histogram.maxLagMs)} | p99 ${formatMs(el.histogram.p99LagMs)} | p50 ${formatMs(el.histogram.p50LagMs)} | mean ${formatMs(el.histogram.meanLagMs)}`,
    );
  }
  if (el.stallIntervals.length > 0) {
    lines.push(`${indent}  Stalls:`);
    for (const stall of el.stallIntervals) {
      lines.push(
        `${indent}    - ${formatMs(stall.startMs)} → ${formatMs(stall.endMs)} (max lag ${formatMs(stall.maxLagMs)})`,
      );
    }
  }
  if (el.correlatedHotspots && el.correlatedHotspots.length > 0) {
    lines.push(`${indent}  Correlated hotspots:`);
    for (const ch of el.correlatedHotspots) {
      lines.push(
        `${indent}    - #${ch.rank} ${ch.function} (${formatLocation(ch.file, ch.line)}) overlap ${formatPct(ch.overlapPct)}, sample ${formatPct(ch.samplePct)}, ${ch.confidence}`,
      );
    }
  }
  if (el.correlationCoverage) {
    const c = el.correlationCoverage;
    lines.push(
      `${indent}  Correlation coverage: ${c.samplesAttributed}/${c.samplesInWindows} attributed across ${c.windowCount} windows (rate ${formatPct(c.attributionRate * 100)})`,
    );
  }
}

function pushEventLoopMarkdown(lines: string[], el: EventLoopReport): void {
  if (!el.available) {
    lines.push('_Event loop measurements unavailable._');
    return;
  }
  lines.push(`- Max lag: ${formatMs(el.maxLagMs)}`);
  lines.push(`- p99 lag: ${formatMs(el.p99LagMs)}`);
  lines.push(`- p50 lag: ${formatMs(el.p50LagMs)}`);
  lines.push(`- Mean lag: ${formatMs(el.meanLagMs)}`);
  lines.push(
    `- Samples: ${el.sampleCount} (basis: ${el.measurementBasis}, confidence: ${el.confidence})`,
  );
  if (el.histogram) {
    lines.push(
      `- Histogram: max ${formatMs(el.histogram.maxLagMs)}, p99 ${formatMs(el.histogram.p99LagMs)}, p50 ${formatMs(el.histogram.p50LagMs)}, mean ${formatMs(el.histogram.meanLagMs)}`,
    );
  }
  if (el.stallIntervals.length > 0) {
    lines.push('');
    lines.push('| Start | End | Max lag |');
    lines.push('| ---: | ---: | ---: |');
    for (const stall of el.stallIntervals) {
      lines.push(
        `| ${formatMs(stall.startMs)} | ${formatMs(stall.endMs)} | ${formatMs(stall.maxLagMs)} |`,
      );
    }
  }
  if (el.correlatedHotspots && el.correlatedHotspots.length > 0) {
    lines.push('');
    lines.push('Correlated hotspots:');
    lines.push('');
    lines.push('| # | Function | Location | Overlap | Sample | Confidence |');
    lines.push('| ---: | --- | --- | ---: | ---: | --- |');
    for (const ch of el.correlatedHotspots) {
      lines.push(
        `| ${ch.rank} | ${escapePipe(ch.function)} | \`${escapeBackticks(formatLocation(ch.file, ch.line))}\` | ${formatPct(ch.overlapPct)} | ${formatPct(ch.samplePct)} | ${ch.confidence} |`,
      );
    }
  }
  if (el.correlationCoverage) {
    const c = el.correlationCoverage;
    lines.push(
      `- Correlation coverage: ${c.samplesAttributed}/${c.samplesInWindows} attributed across ${c.windowCount} windows (rate ${formatPct(c.attributionRate * 100)})`,
    );
  }
}

function pushGcText(lines: string[], gc: GcReport, indent: string): void {
  lines.push(`${indent}GC:`);
  lines.push(
    `${indent}  Total pause: ${formatMs(gc.totalPauseMs)} | longest: ${formatMs(gc.longestPauseMs)}`,
  );
  lines.push(
    `${indent}  Counts: scavenge ${gc.count.scavenge}, markSweep ${gc.count.markSweep}, incremental ${gc.count.incremental}, other ${gc.count.other}`,
  );
  if (gc.pausesOver10ms.length > 0) {
    lines.push(`${indent}  Pauses >10ms:`);
    for (const pause of gc.pausesOver10ms) {
      lines.push(
        `${indent}    - at ${formatMs(pause.atMs)}: ${pause.kind} for ${formatMs(pause.durationMs)}`,
      );
    }
  }
  if (gc.correlatedHotspots && gc.correlatedHotspots.length > 0) {
    lines.push(`${indent}  Correlated hotspots:`);
    for (const ch of gc.correlatedHotspots) {
      lines.push(
        `${indent}    - #${ch.rank} ${ch.function} (${formatLocation(ch.file, ch.line)}) overlap ${formatPct(ch.overlapPct)}, sample ${formatPct(ch.samplePct)}, ${ch.confidence}`,
      );
    }
  }
  if (gc.correlationCoverage) {
    const c = gc.correlationCoverage;
    lines.push(
      `${indent}  Correlation coverage: ${c.samplesAttributed}/${c.samplesInWindows} across ${c.windowCount} windows (rate ${formatPct(c.attributionRate * 100)})`,
    );
  }
}

function pushGcMarkdown(lines: string[], gc: GcReport): void {
  lines.push(`- Total pause: ${formatMs(gc.totalPauseMs)}`);
  lines.push(`- Longest pause: ${formatMs(gc.longestPauseMs)}`);
  lines.push(
    `- Counts: scavenge ${gc.count.scavenge}, markSweep ${gc.count.markSweep}, incremental ${gc.count.incremental}, other ${gc.count.other}`,
  );
  if (gc.pausesOver10ms.length > 0) {
    lines.push('');
    lines.push('Pauses >10ms:');
    lines.push('');
    lines.push('| At | Kind | Duration |');
    lines.push('| ---: | --- | ---: |');
    for (const pause of gc.pausesOver10ms) {
      lines.push(
        `| ${formatMs(pause.atMs)} | ${escapePipe(pause.kind)} | ${formatMs(pause.durationMs)} |`,
      );
    }
  }
  if (gc.correlatedHotspots && gc.correlatedHotspots.length > 0) {
    lines.push('');
    lines.push('Correlated hotspots:');
    lines.push('');
    lines.push('| # | Function | Location | Overlap | Sample | Confidence |');
    lines.push('| ---: | --- | --- | ---: | ---: | --- |');
    for (const ch of gc.correlatedHotspots) {
      lines.push(
        `| ${ch.rank} | ${escapePipe(ch.function)} | \`${escapeBackticks(formatLocation(ch.file, ch.line))}\` | ${formatPct(ch.overlapPct)} | ${formatPct(ch.samplePct)} | ${ch.confidence} |`,
      );
    }
  }
  if (gc.correlationCoverage) {
    const c = gc.correlationCoverage;
    lines.push(
      `- Correlation coverage: ${c.samplesAttributed}/${c.samplesInWindows} across ${c.windowCount} windows (rate ${formatPct(c.attributionRate * 100)})`,
    );
  }
}

function pushHotspotsText(lines: string[], hotspots: Hotspot[], indent: string): void {
  if (hotspots.length === 0) {
    lines.push(`${indent}None`);
    return;
  }
  for (const h of hotspots) {
    lines.push(
      `${indent}- ${h.function} (${formatLocation(h.file, h.line)}) [${h.category}${h.package ? `, ${h.package}` : ''}, ${h.optimizationState}]`,
    );
    lines.push(
      `${indent}    self ${formatMs(h.selfMs)} (${formatPct(h.selfPct)}), total ${formatMs(h.totalMs)} (${formatPct(h.totalPct)})`,
    );
    if (h.callers.length > 0) {
      lines.push(
        `${indent}    Callers: ${h.callers.map((c) => `${c.id}@${formatPct(c.pct)}`).join(', ')}`,
      );
    }
    if (h.callees.length > 0) {
      lines.push(
        `${indent}    Callees: ${h.callees.map((c) => `${c.id}@${formatPct(c.pct)}`).join(', ')}`,
      );
    }
  }
}

function pushHotspotsMarkdown(lines: string[], hotspots: Hotspot[]): void {
  if (hotspots.length === 0) {
    lines.push('_No CPU hotspots._');
    return;
  }
  lines.push('| Function | Location | Category | Self | Total | Opt |');
  lines.push('| --- | --- | --- | ---: | ---: | --- |');
  for (const h of hotspots) {
    const category = h.package ? `${h.category} (${h.package})` : h.category;
    lines.push(
      `| ${escapePipe(h.function)} | \`${escapeBackticks(formatLocation(h.file, h.line))}\` | ${escapePipe(category)} | ${formatMs(h.selfMs)} (${formatPct(h.selfPct)}) | ${formatMs(h.totalMs)} (${formatPct(h.totalPct)}) | ${h.optimizationState} |`,
    );
  }
}

function pushHotStacksText(lines: string[], stacks: HotStack[], indent: string): void {
  for (const [i, stack] of stacks.entries()) {
    lines.push(`${indent}#${i + 1} weight ${formatPct(stack.weightPct)}`);
    for (const frame of stack.frames) {
      lines.push(
        `${indent}    ${frame.function} (${formatLocation(frame.file, frame.line)}) [${frame.category}]`,
      );
    }
  }
}

function pushHotStacksMarkdown(lines: string[], stacks: HotStack[]): void {
  for (const [i, stack] of stacks.entries()) {
    lines.push(`#### Stack ${i + 1} — weight ${formatPct(stack.weightPct)}`);
    lines.push('');
    for (const frame of stack.frames) {
      lines.push(
        `- \`${escapeBackticks(frame.function)}\` at \`${escapeBackticks(formatLocation(frame.file, frame.line))}\` [${frame.category}]`,
      );
    }
    lines.push('');
  }
}

function pushHotStackClustersText(
  lines: string[],
  clusters: HotStackCluster[],
  indent: string,
): void {
  for (const [i, cluster] of clusters.entries()) {
    lines.push(
      `${indent}#${i + 1} anchor ${cluster.anchor.function} (${formatLocation(cluster.anchor.file, cluster.anchor.line)}) — weight ${formatPct(cluster.weightPct)}, ${cluster.stackCount} stacks (members: ${cluster.memberIndices.join(', ')})`,
    );
  }
}

function pushHotStackClustersMarkdown(lines: string[], clusters: HotStackCluster[]): void {
  lines.push('| # | Anchor | Location | Weight | Stacks | Members |');
  lines.push('| ---: | --- | --- | ---: | ---: | --- |');
  for (const [i, cluster] of clusters.entries()) {
    lines.push(
      `| ${i + 1} | ${escapePipe(cluster.anchor.function)} | \`${escapeBackticks(formatLocation(cluster.anchor.file, cluster.anchor.line))}\` | ${formatPct(cluster.weightPct)} | ${cluster.stackCount} | ${cluster.memberIndices.join(', ')} |`,
    );
  }
}

function pushDeoptsText(lines: string[], deopts: DeoptEntry[], indent: string): void {
  for (const d of deopts) {
    lines.push(
      `${indent}- ${d.function} (${formatLocation(d.file, d.line)}) ×${d.count} — ${d.bailoutType}: ${d.reason}`,
    );
    if (d.explanation) lines.push(`${indent}    ${d.explanation}`);
  }
}

function pushDeoptsMarkdown(lines: string[], deopts: DeoptEntry[]): void {
  lines.push('| Function | Location | Count | Bailout | Reason |');
  lines.push('| --- | --- | ---: | --- | --- |');
  for (const d of deopts) {
    lines.push(
      `| ${escapePipe(d.function)} | \`${escapeBackticks(formatLocation(d.file, d.line))}\` | ${d.count} | ${escapePipe(d.bailoutType)} | ${escapePipe(d.reason)} |`,
    );
  }
  const withExplanation = deopts.filter((d) => d.explanation);
  if (withExplanation.length > 0) {
    lines.push('');
    for (const d of withExplanation) {
      lines.push(`- \`${escapeBackticks(d.function)}\`: ${d.explanation}`);
    }
  }
}

function pushMemoryText(lines: string[], memory: MemoryProfileReport, indent: string): void {
  const s = memory.summary;
  lines.push(`${indent}Summary:`);
  lines.push(`${indent}  Total sampled: ${formatBytes(s.totalSampledBytes)}`);
  lines.push(`${indent}  Sampling interval: ${formatBytes(s.samplingIntervalBytes)}`);
  if (s.externalRatio !== undefined) {
    lines.push(`${indent}  External / heapUsed ratio: ${s.externalRatio.toFixed(2)}`);
  }
  for (const [name, series] of seriesEntries(s)) {
    lines.push(`${indent}  ${name}: ${formatSeries(series)}`);
  }
  if (s.topAllocator) {
    const a = s.topAllocator;
    lines.push(
      `${indent}  Top allocator: ${a.function} (${formatLocation(a.file, a.line)}) self ${formatPct(a.selfPct)}, total ${formatPct(a.totalPct)}`,
    );
  }

  const usage = memory.memoryUsage;
  lines.push(`${indent}Memory usage:`);
  lines.push(
    `${indent}  Available: ${formatBool(usage.available)} | samples: ${usage.sampleCount} | interval: ${formatMs(usage.sampleIntervalMs)}`,
  );
  if (usage.firstSample) lines.push(`${indent}  First: ${formatMemorySample(usage.firstSample)}`);
  if (usage.lastSample) lines.push(`${indent}  Last:  ${formatMemorySample(usage.lastSample)}`);

  lines.push(`${indent}Hot allocators:`);
  pushAllocatorsText(lines, memory.hotAllocators ?? [], `${indent}  `);

  if (memory.heapSnapshotAnalysis) {
    lines.push(`${indent}Heap snapshot analysis:`);
    pushHeapSnapshotText(lines, memory.heapSnapshotAnalysis, `${indent}  `);
  }
}

function pushMemoryMarkdown(lines: string[], memory: MemoryProfileReport): void {
  lines.push('### Summary');
  lines.push('');
  const s = memory.summary;
  lines.push(`- Total sampled: ${formatBytes(s.totalSampledBytes)}`);
  lines.push(`- Sampling interval: ${formatBytes(s.samplingIntervalBytes)}`);
  if (s.externalRatio !== undefined) {
    lines.push(`- External / heapUsed ratio: ${s.externalRatio.toFixed(2)}`);
  }
  if (s.topAllocator) {
    const a = s.topAllocator;
    lines.push(
      `- Top allocator: \`${escapeBackticks(a.function)}\` at \`${escapeBackticks(formatLocation(a.file, a.line))}\` self ${formatPct(a.selfPct)}, total ${formatPct(a.totalPct)}`,
    );
  }
  const seriesRows = seriesEntries(s);
  if (seriesRows.length > 0) {
    lines.push('');
    lines.push('| Series | Start | End | Min | Max | Mean | p95 | Slope |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const [name, series] of seriesRows) {
      lines.push(
        `| ${name} | ${formatBytes(series.startBytes)} | ${formatBytes(series.endBytes)} | ${formatBytes(series.minBytes)} | ${formatBytes(series.maxBytes)} | ${formatBytes(series.meanBytes)} | ${formatBytes(series.p95Bytes)} | ${series.slopeBytesPerSec.toFixed(0)} B/s |`,
      );
    }
  }

  const usage = memory.memoryUsage;
  lines.push('');
  lines.push('### Memory usage');
  lines.push('');
  lines.push(`- Available: ${formatBool(usage.available)}`);
  lines.push(`- Samples: ${usage.sampleCount}`);
  lines.push(`- Interval: ${formatMs(usage.sampleIntervalMs)}`);
  if (usage.firstSample) lines.push(`- First sample: ${formatMemorySample(usage.firstSample)}`);
  if (usage.lastSample) lines.push(`- Last sample: ${formatMemorySample(usage.lastSample)}`);

  lines.push('');
  lines.push('### Hot allocators');
  lines.push('');
  pushAllocatorsMarkdown(lines, memory.hotAllocators ?? []);

  if (memory.heapSnapshotAnalysis) {
    lines.push('');
    lines.push('### Heap snapshot analysis');
    lines.push('');
    pushHeapSnapshotMarkdown(lines, memory.heapSnapshotAnalysis);
  }
}

function pushAllocatorsText(
  lines: string[],
  allocators: MemoryHotAllocator[],
  indent: string,
): void {
  if (allocators.length === 0) {
    lines.push(`${indent}None`);
    return;
  }
  for (const a of allocators) {
    lines.push(
      `${indent}- ${a.function} (${formatLocation(a.file, a.line)}) [${a.category}${a.package ? `, ${a.package}` : ''}]`,
    );
    lines.push(
      `${indent}    self ${formatBytes(a.selfBytes)} (${formatPct(a.selfPct)}), total ${formatBytes(a.totalBytes)} (${formatPct(a.totalPct)})`,
    );
  }
}

function pushAllocatorsMarkdown(lines: string[], allocators: MemoryHotAllocator[]): void {
  if (allocators.length === 0) {
    lines.push('_No memory allocators._');
    return;
  }
  lines.push('| Function | Location | Category | Self | Total |');
  lines.push('| --- | --- | --- | ---: | ---: |');
  for (const a of allocators) {
    const category = a.package ? `${a.category} (${a.package})` : a.category;
    lines.push(
      `| ${escapePipe(a.function)} | \`${escapeBackticks(formatLocation(a.file, a.line))}\` | ${escapePipe(category)} | ${formatBytes(a.selfBytes)} (${formatPct(a.selfPct)}) | ${formatBytes(a.totalBytes)} (${formatPct(a.totalPct)}) |`,
    );
  }
}

function pushHeapSnapshotText(
  lines: string[],
  hs: HeapSnapshotAnalysisReport,
  indent: string,
): void {
  lines.push(`${indent}Available: ${formatBool(hs.available)} (mode: ${hs.mode})`);
  lines.push(`${indent}Start: ${hs.start.path}`);
  lines.push(`${indent}End:   ${hs.end.path}`);
  lines.push(
    `${indent}Total retained growth: ${formatBytes(hs.summary.totalRetainedGrowthBytes)}${hs.summary.topGrowingConstructor ? ` (top: ${hs.summary.topGrowingConstructor})` : ''}`,
  );
  if (hs.growthByConstructor.length > 0) {
    lines.push(`${indent}Growth by constructor:`);
    for (const g of hs.growthByConstructor) {
      lines.push(
        `${indent}  - ${g.name}: count Δ ${g.countDelta}, self Δ ${formatBytes(g.selfSizeDeltaBytes)}, retained Δ ${formatBytes(g.retainedSizeDeltaBytes)}`,
      );
    }
  }
  if (hs.retainerPaths.length > 0) {
    lines.push(`${indent}Retainer paths:`);
    for (const r of hs.retainerPaths) {
      lines.push(
        `${indent}  - ${r.constructorName} retained ${formatBytes(r.retainedBytes)} [${r.suspectedPattern}, ${r.confidence}]`,
      );
      for (const step of r.path) lines.push(`${indent}      ↳ ${step}`);
    }
  }
  if (hs.warnings.length > 0) {
    lines.push(`${indent}Warnings:`);
    for (const w of hs.warnings) lines.push(`${indent}  - ${w}`);
  }
}

function pushHeapSnapshotMarkdown(lines: string[], hs: HeapSnapshotAnalysisReport): void {
  lines.push(`- Available: ${formatBool(hs.available)} (mode: ${hs.mode})`);
  lines.push(`- Start: \`${escapeBackticks(hs.start.path)}\``);
  lines.push(`- End: \`${escapeBackticks(hs.end.path)}\``);
  lines.push(
    `- Total retained growth: ${formatBytes(hs.summary.totalRetainedGrowthBytes)}${hs.summary.topGrowingConstructor ? ` (top: \`${escapeBackticks(hs.summary.topGrowingConstructor)}\`)` : ''}`,
  );
  if (hs.growthByConstructor.length > 0) {
    lines.push('');
    lines.push('Growth by constructor:');
    lines.push('');
    lines.push('| Constructor | Count Δ | Self Δ | Retained Δ |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const g of hs.growthByConstructor) {
      lines.push(
        `| ${escapePipe(g.name)} | ${g.countDelta} | ${formatBytes(g.selfSizeDeltaBytes)} | ${formatBytes(g.retainedSizeDeltaBytes)} |`,
      );
    }
  }
  if (hs.retainerPaths.length > 0) {
    lines.push('');
    lines.push('Retainer paths:');
    lines.push('');
    for (const r of hs.retainerPaths) {
      lines.push(
        `- \`${escapeBackticks(r.constructorName)}\` retained ${formatBytes(r.retainedBytes)} [${r.suspectedPattern}, ${r.confidence}]`,
      );
      for (const step of r.path) lines.push(`  - \`${escapeBackticks(step)}\``);
    }
  }
  if (hs.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of hs.warnings) lines.push(`- ${w}`);
  }
}

function pushFindingsText(lines: string[], findings: Finding[], indent: string): void {
  if (findings.length === 0) {
    lines.push(`${indent}No findings`);
    return;
  }
  for (const f of findings) {
    lines.push(`${indent}[${f.severity}] ${f.title}`);
    lines.push(`${indent}  Id: ${f.id}`);
    lines.push(`${indent}  Kind: ${f.profileKind} | category: ${f.category}`);
    if (f.confidence) lines.push(`${indent}  Confidence: ${f.confidence}`);
    if (f.proofLevel) lines.push(`${indent}  Proof: ${f.proofLevel}`);
    lines.push(`${indent}  Why: ${f.why}`);
    lines.push(`${indent}  Suggestion: ${f.suggestion}`);
    lines.push(
      `${indent}  Evidence: ${f.evidence.function} (${formatLocation(f.evidence.file, f.evidence.line)}) self ${formatPct(f.evidence.selfPct)}`,
    );
    if (f.evidence.extra) {
      lines.push(`${indent}    Extra:`);
      for (const line of formatExtraLines(f.evidence.extra)) {
        lines.push(`${indent}      ${line}`);
      }
    }
    if (f.measurements) pushMeasurementsText(lines, f.measurements, `${indent}  `);
    if (f.priority) pushPriorityText(lines, f.priority, `${indent}  `);
    if (f.remediation) pushRemediationText(lines, f.remediation, `${indent}  `);
    if (f.references.length > 0) {
      lines.push(`${indent}  References:`);
      for (const ref of f.references) lines.push(`${indent}    - ${ref}`);
    }
  }
}

function pushFindingsMarkdown(lines: string[], findings: Finding[]): void {
  if (findings.length === 0) {
    lines.push('_No findings._');
    return;
  }
  for (const f of findings) {
    lines.push(`### ${f.title}`);
    lines.push('');
    lines.push(`- Severity: ${f.severity}`);
    lines.push(`- Id: \`${escapeBackticks(f.id)}\``);
    lines.push(`- Kind: ${f.profileKind}`);
    lines.push(`- Category: ${f.category}`);
    if (f.confidence) lines.push(`- Confidence: ${f.confidence}`);
    if (f.proofLevel) lines.push(`- Proof: ${f.proofLevel}`);
    lines.push(`- Why: ${f.why}`);
    lines.push(`- Suggestion: ${f.suggestion}`);
    lines.push(
      `- Evidence: \`${escapeBackticks(f.evidence.function)}\` at \`${escapeBackticks(formatLocation(f.evidence.file, f.evidence.line))}\` (self ${formatPct(f.evidence.selfPct)})`,
    );
    if (f.evidence.extra) {
      lines.push('- Extra:');
      for (const line of formatExtraLines(f.evidence.extra)) {
        lines.push(`  - ${line}`);
      }
    }
    if (f.measurements) pushMeasurementsMarkdown(lines, f.measurements);
    if (f.priority) pushPriorityMarkdown(lines, f.priority);
    if (f.remediation) pushRemediationMarkdown(lines, f.remediation);
    if (f.references.length > 0) {
      lines.push('- References:');
      for (const ref of f.references) lines.push(`  - ${ref}`);
    }
    lines.push('');
  }
}

function pushMeasurementsText(
  lines: string[],
  measurements: FindingMeasurements,
  indent: string,
): void {
  const observed = Object.entries(measurements.observed);
  const thresholds = Object.entries(measurements.thresholds);
  if (observed.length === 0 && thresholds.length === 0) return;
  lines.push(`${indent}Measurements:`);
  for (const [key, value] of observed) {
    const threshold = measurements.thresholds[key];
    const suffix = threshold !== undefined ? ` (threshold ${formatNumber(threshold)})` : '';
    lines.push(`${indent}  ${key}: ${formatNumber(value)}${suffix}`);
  }
  for (const [key, value] of thresholds) {
    if (key in measurements.observed) continue;
    lines.push(`${indent}  ${key}: threshold ${formatNumber(value)}`);
  }
}

function pushMeasurementsMarkdown(lines: string[], measurements: FindingMeasurements): void {
  const observed = Object.entries(measurements.observed);
  const thresholds = Object.entries(measurements.thresholds);
  if (observed.length === 0 && thresholds.length === 0) return;
  lines.push('- Measurements:');
  for (const [key, value] of observed) {
    const threshold = measurements.thresholds[key];
    const suffix = threshold !== undefined ? ` (threshold ${formatNumber(threshold)})` : '';
    lines.push(`  - \`${escapeBackticks(key)}\`: ${formatNumber(value)}${suffix}`);
  }
  for (const [key, value] of thresholds) {
    if (key in measurements.observed) continue;
    lines.push(`  - \`${escapeBackticks(key)}\`: threshold ${formatNumber(value)}`);
  }
}

function pushPriorityText(lines: string[], priority: FindingPriority, indent: string): void {
  const impact =
    priority.impactEstimateMs !== undefined
      ? `, impact ~${formatMs(priority.impactEstimateMs)}`
      : '';
  lines.push(
    `${indent}Priority: score ${priority.score}, action confidence ${priority.actionConfidence}${impact}`,
  );
}

function pushPriorityMarkdown(lines: string[], priority: FindingPriority): void {
  const impact =
    priority.impactEstimateMs !== undefined
      ? `, impact ~${formatMs(priority.impactEstimateMs)}`
      : '';
  lines.push(
    `- Priority: score ${priority.score}, action confidence ${priority.actionConfidence}${impact}`,
  );
}

function pushRemediationText(
  lines: string[],
  remediation: FindingRemediation,
  indent: string,
): void {
  const parts = [`kind: ${remediation.kind}`];
  if (remediation.replace) parts.push(`replace: ${remediation.replace}`);
  if (remediation.with) parts.push(`with: ${remediation.with}`);
  if (remediation.module) parts.push(`module: ${remediation.module}`);
  if (remediation.docs) parts.push(`docs: ${remediation.docs}`);
  lines.push(`${indent}Remediation: ${parts.join(' | ')}`);
  if (remediation.notes) lines.push(`${indent}  Notes: ${remediation.notes}`);
}

function pushRemediationMarkdown(lines: string[], remediation: FindingRemediation): void {
  lines.push(`- Remediation:`);
  lines.push(`  - Kind: ${remediation.kind}`);
  if (remediation.replace) lines.push(`  - Replace: \`${escapeBackticks(remediation.replace)}\``);
  if (remediation.with) lines.push(`  - With: \`${escapeBackticks(remediation.with)}\``);
  if (remediation.module) lines.push(`  - Module: \`${escapeBackticks(remediation.module)}\``);
  if (remediation.docs) lines.push(`  - Docs: ${remediation.docs}`);
  if (remediation.notes) lines.push(`  - Notes: ${remediation.notes}`);
}

function formatExtraLines(extra: unknown): string[] {
  if (!extra || typeof extra !== 'object') return [String(extra)];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (key === 'candidateHotspots' && Array.isArray(value)) {
      lines.push(`candidateHotspots:`);
      for (const ch of value as Array<Record<string, unknown>>) {
        const fn = String(ch.function ?? '?');
        const file = String(ch.file ?? '?');
        const line = Number(ch.line ?? 0);
        const overlapPct = Number(ch.overlapPct ?? 0);
        const samplePct = Number(ch.samplePct ?? 0);
        const rank = Number(ch.rank ?? 0);
        const confidence = String(ch.confidence ?? '?');
        lines.push(
          `  - #${rank} ${fn} (${formatLocation(file, line)}) overlap ${formatPct(overlapPct)}, sample ${formatPct(samplePct)}, ${confidence}`,
        );
      }
      continue;
    }
    if (key === 'eventLoopCorrelation' && value && typeof value === 'object') {
      const c = value as { overlapPct?: number; samplePct?: number };
      lines.push(
        `eventLoopCorrelation: overlap ${formatPct(c.overlapPct)}, sample ${formatPct(c.samplePct)}`,
      );
      continue;
    }
    if (key === 'alternativeHotspots' && Array.isArray(value)) {
      lines.push('alternativeHotspots:');
      for (const alt of value as Array<Record<string, unknown>>) {
        lines.push(
          `  - ${String(alt.function)} (${formatLocation(String(alt.file), Number(alt.line))}) self ${formatPct(Number(alt.selfPct))}, total ${formatPct(Number(alt.totalPct))}`,
        );
      }
      continue;
    }
    if (key === 'stallIntervals' && Array.isArray(value)) {
      lines.push('stallIntervals:');
      for (const s of value as Array<Record<string, unknown>>) {
        lines.push(
          `  - ${formatMs(Number(s.startMs))} → ${formatMs(Number(s.endMs))} (max ${formatMs(Number(s.maxLagMs))})`,
        );
      }
      continue;
    }
    if (key === 'histogram' && value && typeof value === 'object') {
      const h = value as Record<string, number>;
      lines.push(
        `histogram: max ${formatMs(h.maxLagMs)}, p99 ${formatMs(h.p99LagMs)}, p50 ${formatMs(h.p50LagMs)}, mean ${formatMs(h.meanLagMs)}`,
      );
      continue;
    }
    if (key === 'counts' && value && typeof value === 'object') {
      const c = value as Record<string, number>;
      lines.push(
        `counts: scavenge ${c.scavenge ?? 0}, markSweep ${c.markSweep ?? 0}, incremental ${c.incremental ?? 0}, other ${c.other ?? 0}`,
      );
      continue;
    }
    if (key === 'userAttribution' && value && typeof value === 'object') {
      const u = value as Record<string, unknown>;
      lines.push(
        `userAttribution: ${String(u.function)} (${formatLocation(String(u.file), Number(u.line))}) sample ${formatPct(Number(u.samplePct))}, support ${formatPct(Number(u.supportPct))}, ${String(u.confidence)}`,
      );
      continue;
    }
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`${key}: [${(value as unknown[]).map((v) => formatScalar(v)).join(', ')}]`);
      continue;
    }
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return lines;
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function jsonLines(value: unknown): string[] {
  return JSON.stringify(value, null, 2).split('\n');
}

function seriesEntries(
  summary: MemoryProfileReport['summary'],
): Array<[string, MemorySeriesStats]> {
  const entries: Array<[string, MemorySeriesStats]> = [];
  if (summary.rss) entries.push(['rss', summary.rss]);
  if (summary.heapUsed) entries.push(['heapUsed', summary.heapUsed]);
  if (summary.external) entries.push(['external', summary.external]);
  if (summary.arrayBuffers) entries.push(['arrayBuffers', summary.arrayBuffers]);
  return entries;
}

function formatSeries(series: MemorySeriesStats): string {
  return `start ${formatBytes(series.startBytes)}, end ${formatBytes(series.endBytes)}, min ${formatBytes(series.minBytes)}, max ${formatBytes(series.maxBytes)}, mean ${formatBytes(series.meanBytes)}, p95 ${formatBytes(series.p95Bytes)}, slope ${series.slopeBytesPerSec.toFixed(0)} B/s`;
}

function formatMemorySample(sample: MemoryUsageSample): string {
  return `at ${formatMs(sample.atMs)} | rss ${formatBytes(sample.rss)}, heapTotal ${formatBytes(sample.heapTotal)}, heapUsed ${formatBytes(sample.heapUsed)}, external ${formatBytes(sample.external)}, arrayBuffers ${formatBytes(sample.arrayBuffers)}`;
}

function formatDiagnostic(diag: unknown): string {
  if (diag && typeof diag === 'object') {
    const d = diag as Record<string, unknown>;
    const stage = d.stage ? String(d.stage) : '?';
    const message = d.message ? String(d.message) : JSON.stringify(diag);
    return `[${stage}] ${message}`;
  }
  return String(diag);
}

function formatBool(value: boolean | undefined): string {
  if (value === undefined) return 'unknown';
  return value ? 'yes' : 'no';
}

function formatCommand(command: string[] | undefined): string {
  return command && command.length > 0 ? command.join(' ') : '(unknown)';
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : '(none)';
}

function formatMs(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${Math.round(value)}ms`;
}

function formatRatio(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return formatPct(value * 100);
}

function formatPct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'unknown';
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
}

function formatLocation(file: string, line: number): string {
  return `${file}:${line}`;
}

function escapePipe(value: string): string {
  return value.replaceAll('|', '\\|');
}

function escapeBackticks(value: string): string {
  return value.replaceAll('`', '\\`');
}
