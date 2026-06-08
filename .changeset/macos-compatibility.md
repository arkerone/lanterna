---
"@lanterna-profiler/core": patch
"@lanterna-profiler/cli": patch
---

Improve macOS (darwin) compatibility for attach/discovery:

- Resolve the working directory of discovered processes on macOS via `lsof` (Linux still uses `/proc`); previously the `ps` picker never showed a cwd off Linux.
- Make direct-Node runtime detection tolerant of `ps-list`'s best-effort/truncated `path`/`name` on macOS by also considering the first token of the full command line, so attachable Node processes aren't missed.
- Scan both IPv4 (`127.0.0.1`) and IPv6 (`[::1]`) loopback when discovering inspector endpoints, deduping dual-stack hits, so attach-by-pid works against inspectors bound to IPv6.
