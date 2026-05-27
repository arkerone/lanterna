---
"@lanterna-profiler/cli": minor
---

Add `lanterna ps`, a command that lists the Node.js processes Lanterna can attach to (PID, attach mode, runtime, CPU/memory, cwd). It defaults to a colored table on a TTY and to JSON when piped (or with `--format json`), so agents and scripts can discover an attachable PID before running `lanterna attach --pid`. The `lanterna-profiler` skill now uses it to enumerate candidates and let the user pick which process to attach to.
