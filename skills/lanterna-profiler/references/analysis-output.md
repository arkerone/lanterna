# Analysis Output Reference

Use this when answering from a Lanterna agent report. The answer should expose the investigation state: symptom, signal quality, hypotheses, evidence, confidence, and the next measurement. Do not turn the report into a generic summary.

Start from `$LANTERNA report report.json --format agent --output report.agent.md` (set `$LANTERNA` per the SKILL prefix block). Read frontmatter, `## Findings`, each `## Finding N`, every present `## Kind Review`, and `## Files To Read First`. Read implicated source files before making source-backed recommendations. Use frontmatter `rerun_required`, `blocking_caveats`, `degrading_caveats`, and any `decision = rerun` finding to decide whether a better capture is needed. Use the JSON only for a targeted field missing from the agent report (full retainer paths, source-map failures, complete memory series).

Every answer, including quick replies, must surface the frontmatter gate: available `kinds`, relevant quality fields, `memory_signal` when memory is discussed, source-map quality when locations matter, `rerun_required`, caveats, and the confidence limit those signals impose.

## Choosing The Form

- Use **Quick Form** when exactly one finding is `decision = actionable`, `confidence = high`, the cited source has been read, `rerun_required: false`, the needed kind is present, and there are no `blocking_caveats` / `degrading_caveats` that change the conclusion.
- Use **Substantive Answer Shape** otherwise: multiple findings competing, unclear root cause, hypotheses needing validation, degraded or partial signal, or when the user asked for a written-up investigation (issue, PR description, post-mortem).

## Substantive Answer Shape

```md
## Executive Summary
- <main symptom or workload under investigation>
- <strongest lead and whether it is actionable, hypothesis, or rerun-only>
- <confidence level and the main reason>

## Report Gate
<mode/pid/command/duration/cwd as relevant, kinds, quality, memory signal, source-map status, rerun_required, blocking/degrading caveats, and confidence limits>

## Observed Symptoms
<metrics, idle/workload notes, user-visible symptom, and baseline if known>

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
- **Rerun-only**: `rerun_required: true`, a non-empty `blocking_caveats` list, a `decision = rerun` finding, or a missing kind required for the user's symptom. Do not claim root cause or propose a patch.
- Never increase confidence above the report's caveats. A good-looking source explanation does not rescue a non-representative capture.

## Evidence Rules

- Lead with quality when confidence is not high.
- Combine frontmatter quality, rerun status, caveats, finding decision/proof/confidence, kind review details, source-map status, `Files To Read First` decision, and `user_caller` confidence before deciding whether a lead is actionable, a hypothesis, or rerun-only.
- Include the specific report observation: finding id, decision, proof, metric, threshold, hotspot, allocator, async operation, caveat, or kind review line.
- For CPU reports, separate the self-heavy culprit from caller context when both are present: `top_cpu_culprit` answers which function body burned CPU; `top_request_entry` / `top_user_hotspot` explains the request or caller path.
- Treat `cpu-hotspot:*` according to `evidence.extra.mode`: `self` can be actionable direct CPU evidence when quality and source inspection support it; `inclusive-entry` is a caller/context hypothesis until callees or hot stacks confirm the expensive body.
- For `event-loop-stall` with `hotspot-fallback`, say event-loop lag was observed but causality is weaker; use the fallback frame as the next source lead or rerun target.
- Include code observations only after reading the relevant files. Name the file/function and why it confirms or weakens the lead.
- Keep `user_caller` confidence, support percentage, and generated/source-map fallback visible when those details affect actionability.
- Treat `decision = actionable` as eligible for a recommendation only after source inspection.
- Treat `decision = hypothesis`, `trace-only`, weak correlation, or low profile confidence as a hypothesis requiring validation.
- Treat `decision = rerun`, mostly idle CPU, missing required kind, or blocking caveats as a stop condition.

## Quick Form

```md
Profile quality: <kinds, relevant quality fields, memory_signal/source-map status if relevant>
Rerun status: <rerun_required and blocking/degrading caveats>
Top lead: <finding/hotspot/allocator/async operation> (<decision>, <confidence>)
Evidence: <one or two report/code observations>
Confidence: <high/medium/low/rerun-only with frontmatter-imposed limit>
Next step: <source file/function to inspect or exact rerun command>
```

## Validation Guidance

- Validate fixes with the same representative workload whenever possible.
- Compare before/after metrics that match the symptom: p95/p99 latency, throughput, CPU self time, event-loop delay, RSS/heap slope, GC pause time, async wait time, or startup duration.
- If the user asks for a patch before source is read, first inspect the listed files; if unavailable, ask for them.
- If the report lacks the kind needed for the symptom, request a focused rerun with the needed `--kind`.
