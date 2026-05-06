# Analysis Output Reference

Use this when answering from a Lanterna report. Keep the answer source-backed and only include sections supported by the agent report's frontmatter kinds.

When creating an issue or PR summary from a report, start with `lanterna report <file> --format agent --output report.agent.md`. Read frontmatter -> `## Findings` table -> `## Finding N` blocks -> `## Kind Review` -> `## Files To Read First`, then read implicated source files before writing source-backed conclusions. Do not start from raw JSON; use JSON only for a targeted field missing from the agent report.

## Recommended Shape

```md
## Lanterna Profile - <command or pid> (<durationMs>ms, kinds: <profileKinds>)

### Quality
CPU confidence: <frontmatter cpu_quality> - <frontmatter degrading_caveats or "no quality warnings">
Integrity caveats: <frontmatter integrity + blocking_caveats or "none">
Source maps: <frontmatter sourcemap_coverage or "disabled">


### Summary
CPU: <`## Kind Review` CPU summary and top hotspot>
Memory: <`## Kind Review` memory usage/top allocator>
Async: <`## Kind Review` async quality/top operation/hot file/cpu chain>

### Findings
#### [<SEVERITY>] <title>
Confidence: <finding.confidence> | proof: <finding.proofLevel>
Location: <agent Source with generated fallback> in `<function>`
User caller: <agent User caller line with confidence/support/basis when rendered, or "none">
Decision: <actionable | hypothesis | rerun required>
Evidence: <`Finding N` block: observed, thresholds, impact, sampled percentages>
Caveats: <source-map coverage, degraded signal, medium/low userCaller, missing proof, or "none">
Why: <why this matters in this run>
Fix: <concrete remediation or confidence caveat>

### Kind Review Leads
Use the `## Kind Review` section. Include only kinds present in frontmatter.

### GC / Event Loop / Deopts / Memory Series / Async
<only claims supported by available report signals>
```

## Rules

- Lead with quality when confidence is not `high`.
- Use `finding.confidence` and `finding.proofLevel` in the finding summary when present.
- Include `User caller` from the agent report when present. Prefer the rendered source location and keep confidence, support percentage, and basis visible when available. If a kind aggregate should have `userCaller` but the agent report omits it, then perform a targeted JSON lookup for that one field.
- Treat `userCaller.confidence === "high"` as potentially actionable only when the finding, proof level, and signal gate are also actionable. Treat `medium` and `low` user callers as inspection leads.
- Cite evidence and caveats together: measurements, thresholds, support percentage, proof level, source-map coverage, and any integrity degradation.
- Say "hypothesis" for `trace-only`, `heuristic`, weak correlation, or low profile confidence.
- Do not include CPU sections unless the agent frontmatter section lists `cpu`.
- Do not include memory sections unless the agent frontmatter section lists `memory`.
- Do not include async sections unless the agent frontmatter section lists `async`.
- Do not patch from a finding alone. Read the cited source first.

## Short Form

For quick status updates:

```md
Profile quality: <confidence> (<main reason>)
Top actionable finding: <severity> <title> at <file>:<line> (<confidence>, <proofLevel>)
User caller: <fn> at <location> (<confidence>, support <supportPct>%, <basis>) or none
Main caveat: <signal limitation or "none">
Next step: <source file/function to inspect or rerun recommendation>
```
