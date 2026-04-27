# Analysis Output Reference

Use this when answering from a Lanterna report. Keep the answer source-backed and only include sections supported by `meta.profileKinds`.

## Recommended Shape

```md
## Lanterna Profile - <command or pid> (<durationMs>ms, kinds: <profileKinds>)

### Quality
CPU confidence: <profiles.cpu.quality.confidence> - <reasons or "no quality warnings">
Integrity caveats: <captureIntegrity issues or "none">

### Summary
CPU: <onCpuRatio * 100>% on-CPU | top category: <topCategory> | <samplesTotal> samples @ <sampleIntervalMicros>us
Memory: RSS <startMB> -> <endMB> MB (slope <slopeBytesPerSec>) | top allocator: `<fn>` <selfPct>% | <totalSampledBytes> bytes sampled

### Findings
#### [<SEVERITY>] <title>
Confidence: <finding.confidence> | proof: <finding.proofLevel>
Location: <file>:<line> in `<function>`
Why: <why this matters in this run>
Fix: <concrete remediation or confidence caveat>

### Top Hotspots
1. `<function>` - <selfPct>% self, <totalPct>% total

### Top Allocators
1. `<function>` - <selfPct>% bytes (<selfBytes> B)

### GC / Event Loop / Deopts / Memory Series
<only claims supported by available report signals>
```

## Rules

- Lead with quality when confidence is not `high`.
- Use `finding.confidence` and `finding.proofLevel` in the finding summary when present.
- Say "hypothesis" for `trace-only`, `heuristic`, weak correlation, or low profile confidence.
- Do not include CPU sections unless `meta.profileKinds` includes `cpu`.
- Do not include memory sections unless `meta.profileKinds` includes `memory`.
- Do not patch from a finding alone. Read the cited source first.

## Short Form

For quick status updates:

```md
Profile quality: <confidence> (<main reason>)
Top actionable finding: <severity> <title> at <file>:<line> (<confidence>, <proofLevel>)
Main caveat: <signal limitation or "none">
Next step: <source file/function to inspect or rerun recommendation>
```
