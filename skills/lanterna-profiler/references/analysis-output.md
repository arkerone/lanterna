# Analysis Output Reference

Use this when answering from a Lanterna agent report. The answer should expose the investigation state: symptom, signal quality, hypotheses, evidence, confidence, and the next measurement. Do not turn the report into a generic summary.

Start from `lanterna report report.json --format agent --output report.agent.md`. Read frontmatter, `## Findings`, each `## Finding N`, every present `## Kind Review`, `## Files To Read First`, and `## Next Steps`. Read implicated source files before making source-backed recommendations. Use the JSON only for a targeted field missing from the agent report (full retainer paths, source-map failures, complete memory series).

## Choosing The Form

- Use **Quick Form** when exactly one finding is `decision = actionable`, `confidence = high`, the cited source has been read, and there are no `blocking_caveats` / `degrading_caveats` that change the conclusion.
- Use **Substantive Answer Shape** otherwise: multiple findings competing, unclear root cause, hypotheses needing validation, degraded or partial signal, or when the user asked for a written-up investigation (issue, PR description, post-mortem).

## Substantive Answer Shape

```md
## Executive Summary
- <main symptom or workload under investigation>
- <strongest lead and whether it is actionable, hypothesis, or rerun-only>
- <confidence level and the main reason>

## Observed Symptoms
<metrics, kind availability, quality, integrity, caveats, idle/workload notes>

## Hypotheses
| Hypothesis | Evidence | Confidence | Needs validation |
|---|---|---|---|
| <testable cause> | <report/code observations> | <high/medium/low> | <measurement/source check> |

## Evidence
<findings, kind review observations, source observations, and caveats>

## Recommended Actions
<actionable changes, each tied to report evidence or code evidence; label unproven items as hypotheses>

## Rerun / Validation
<commands, workload, expected signal, and before/after metrics>

## Files Or Functions To Inspect
<paths/functions from report and source inspection>

## Next Questions
<only targeted questions that change the next step>
```

## Confidence Rules

- **High**: report quality is sufficient, no blocking caveats, finding is actionable or direct, and relevant editable source confirms the hot path.
- **Medium**: signal is useful but degraded, source confirmation is partial, the user caller is medium confidence, or causality depends on a reasonable but unmeasured link.
- **Low**: capture is short, idle, low-sample, attach-limited, source maps are weak, event-loop timing is unavailable, or the finding is a heuristic.
- Never increase confidence above the report's caveats. A good-looking source explanation does not rescue a non-representative capture.

## Evidence Rules

- Lead with quality when confidence is not high.
- Include the specific report observation: finding id, decision, proof, metric, threshold, hotspot, allocator, async operation, caveat, or kind review line.
- Include code observations only after reading the relevant files. Name the file/function and why it confirms or weakens the lead.
- Keep `user_caller` confidence, support percentage, and generated/source-map fallback visible when those details affect actionability.
- Treat `decision = actionable` as eligible for a recommendation only after source inspection.
- Treat `decision = hypothesis`, `trace-only`, weak correlation, or low profile confidence as a hypothesis requiring validation.
- Treat `decision = rerun`, mostly idle CPU, missing required kind, or blocking caveats as a stop condition.

## Quick Form

```md
Profile quality: <quality and caveat>
Top lead: <finding/hotspot/allocator/async operation> (<decision>, <confidence>)
Evidence: <one or two report/code observations>
Confidence: <high/medium/low with reason>
Next step: <source file/function to inspect or exact rerun command>
```

## Validation Guidance

- Validate fixes with the same representative workload whenever possible.
- Compare before/after metrics that match the symptom: p95/p99 latency, throughput, CPU self time, event-loop delay, RSS/heap slope, GC pause time, async wait time, or startup duration.
- If the user asks for a patch before source is read, first inspect the listed files; if unavailable, ask for them.
- If the report lacks the kind needed for the symptom, request a focused rerun with the needed `--kind`.
