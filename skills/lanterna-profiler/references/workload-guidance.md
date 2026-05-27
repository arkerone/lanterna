# Workload Guidance

Use this when a Lanterna capture needs representative load. The workload must reproduce the user-visible symptom during the profiling window; otherwise the report can be idle, exercise the wrong route, or measure an unauthenticated error path.

## Interactive Workflow

Ask only the questions needed to build the next capture:

1. What symptom should the workload reproduce: latency, throughput drop, CPU saturation, event-loop delay, memory growth, OOM, async wait, or startup cost?
2. Which endpoint, job, queue consumer, cron task, or user flow shows the symptom?
3. Who launches the workload: it is already active, the user will run it during capture, or the agent should launch/propose a command?
4. What request details are required: method, URL, body, content type, query params, tenant/project id, cookies, bearer token, API key, custom headers, and accepted response status?
5. What is representative traffic: concurrency, request rate, duration, ramp-up, payload size, route mix, data cardinality, cache state, and external dependencies?
6. What metric will prove the issue improved: p95/p99 latency, throughput, CPU self time, event-loop delay, RSS/heap slope, GC pause time, or async wait time?

If auth or tenant context matters, ask for a safe short-lived token or a local test credential. Do not ask the user to paste production secrets into a persistent file. Prefer environment variables for headers in shell commands.

## Duration Rule

The workload must stay active for the entire capture window. Always pick `workload_duration >= capture_duration` and align them explicitly:

- `$LANTERNA run --duration 30s ... --workload "autocannon -d 35 ..."` - workload runs about 5s longer than the capture (safe).
- `$LANTERNA run --duration 60s ... --workload "autocannon -d 30 ..."` - **broken**: the last 30s of the capture sees no traffic, so idle ratio and throughput conclusions are distorted.
- For batch / queue workloads where you cannot pre-set a duration, use `--duration <expected steady-state window>` and start the workload before the capture, or use `lanterna attach` once the target is in steady state.

Prefer a workload that runs slightly longer than the capture, or use a readiness-gated server capture (`--wait-for-url`) so traffic starts after the target is ready. If the final seconds are idle, discard the report or rerun; do not diagnose CPU idle ratio, throughput, or "no hotspot" conclusions from a capture with an idle tail.

## Non-HTTP Workloads

HTTP tools are only for HTTP servers. For CLI jobs, batch jobs, queue consumers, cron tasks, and workers, make the workload match the production work shape instead of defaulting to autocannon or artillery.

- CLI / batch jobs: drive the target with stable fixture files, representative dataset size and cardinality, the same args/env as production, and the cache state that matches the symptom (cold start, warm cache, or rebuilt cache).

```bash
$LANTERNA run --kind cpu --kind memory --duration 45s \
  --format json --output report.json -- \
  node scripts/rebuild-index.js --input fixtures/catalog-large.ndjson --batch-size 1000
```

- Queue consumers: pre-seed enough messages before capture, or run a producer during capture. If a producer runs as `--workload`, its active duration must be at least as long as Lanterna's `--duration`.

```bash
node scripts/seed-queue.js --queue orders.profiler --count 50000 --payload fixtures/order.json
$LANTERNA run --duration 60s --format json --output report.json -- node worker.js --queue orders.profiler

$LANTERNA run --duration 60s \
  --workload "node scripts/produce-orders.js --queue orders.profiler --rate 200/s --duration 70s" \
  --format json --output report.json -- node worker.js --queue orders.profiler
```

- Kafka: replay realistic records with the same topic shape, partition distribution, message size, consumer group behavior, offset reset policy, and target rate. Use a fresh group or reset offsets if preloaded messages may already be consumed.

```bash
KAFKA_BROKERS=localhost:9092
kcat -b "$KAFKA_BROKERS" -t orders.profiler -P -l fixtures/orders.ndjson

KAFKA_GROUP_ID=lanterna-profiler-001 KAFKA_OFFSET_RESET=earliest \
  $LANTERNA run --duration 60s --format json --output report.json -- \
  node worker.js --topic orders.profiler
```

For replay-driven tests, prefer a producer script that can hold a target rate for longer than the capture window:

```bash
$LANTERNA run --duration 60s \
  --workload "node scripts/replay-kafka.js --topic orders.profiler --rate 500/s --duration 70s --fixture fixtures/orders.ndjson" \
  --format json --output report.json -- node worker.js --topic orders.profiler
```

- RabbitMQ / Redis Streams / SQS: create an isolated test queue/stream, seed a backlog or run a producer, and verify routing keys, stream/group names, visibility timeout, ack/delete semantics, batch size, retry policy, and payload size. The consumer should be busy for the whole capture and should process the expensive message type or job path that matches the symptom.

## Autocannon

Use autocannon only for HTTP servers: a single endpoint or a small set of requests where latency, throughput, and CPU are the main concern.

Simple GET:

```bash
npx -y autocannon -c 50 -d 30 http://localhost:3000/api/search?q=test
```

Bearer token and JSON body. Set `TOKEN` on its own line first so the parent shell can expand `$TOKEN` inside header arguments; an inline `TOKEN=<value> npx ...` only sets the variable for the child process, after the parent has already expanded the literal `$TOKEN`. Export it when a child process may read secrets from the environment. Use a short-lived local/test token and do not write production tokens to files:

```bash
TOKEN=<token>
export TOKEN
npx -y autocannon -c 25 -d 30 \
  -m POST \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -b '{"query":"test","limit":50}' \
  http://localhost:3000/api/search
```

Lanterna with autocannon (two-step capture + render; set `$LANTERNA` per the SKILL prefix block, and set `TOKEN` first for the same reason):

```bash
LANTERNA="$(command -v lanterna >/dev/null 2>&1 && echo lanterna || echo 'npx -y @lanterna-profiler/cli')"
TOKEN=<token>
export TOKEN
$LANTERNA run --duration 30s --wait-for-url http://localhost:3000/health \
  --workload "npx -y autocannon -c 25 -d 35 -H 'authorization: Bearer $TOKEN' http://localhost:3000/api/search?q=test" \
  --format json --output report.json -- node server.js
$LANTERNA report report.json --format agent --output report.agent.md
```

Autocannon is weak for login flows, weighted route mixes, changing payloads, or setup/teardown-heavy scenarios. Use artillery or an existing load script for those.

## Artillery

Use artillery for multi-step user flows, auth-dependent behavior, weighted routes, dynamic payloads, and staged traffic.

Example `load.yml`:

```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 10
      arrivalRate: 2
      rampTo: 10
      name: "warm up"
    - duration: 45
      arrivalRate: 10
      name: "steady"
    - duration: 15
      arrivalRate: 10
      rampTo: 20
      name: "burst"
  payload:
    path: "users.csv"
    fields: ["email", "password", "query", "itemId"]
    skipHeader: true
  defaults:
    headers:
      content-type: "application/json"
scenarios:
  - name: "browse after login"
    weight: 7
    flow:
      - post:
          url: "/api/login"
          json:
            email: "{{ email }}"
            password: "{{ password }}"
          capture:
            - json: "$.token"
              as: "token"
      - get:
          url: "/api/search"
          qs:
            q: "{{ query }}"
          headers:
            authorization: "Bearer {{ token }}"
      - get:
          url: "/api/items/{{ itemId }}"
          headers:
            authorization: "Bearer {{ token }}"
  - name: "write path"
    weight: 3
    flow:
      - post:
          url: "/api/login"
          json:
            email: "{{ email }}"
            password: "{{ password }}"
          capture:
            - json: "$.token"
              as: "token"
      - post:
          url: "/api/cart"
          headers:
            authorization: "Bearer {{ token }}"
          json:
            itemId: "{{ itemId }}"
            quantity: 1
      - post:
          url: "/api/orders"
          headers:
            authorization: "Bearer {{ token }}"
```

Use local test credentials in `users.csv`; keep production tokens and secrets in environment variables, not YAML or payload files. If login is not part of the symptom, replace the login steps with a processor hook or pre-issued test token from the environment so auth setup does not dominate the profile.

Lanterna with artillery (two-step capture + render; reuse `$LANTERNA` from the autocannon snippet above or re-run the prefix line):

```bash
$LANTERNA run --duration 60s --wait-for-url http://localhost:3000/health \
  --workload "npx -y artillery run load.yml" \
  --format json --output report.json -- node server.js
$LANTERNA report report.json --format agent --output report.agent.md
```

## Troubleshooting Bad Captures

Check these failure modes before trusting a report:

- 401 / 403 responses or all requests error: auth, headers, token freshness, cookies, tenant context, or accepted status codes are wrong.
- No requests observed / mostly idle CPU: the workload did not run, hit the wrong host or port, never passed readiness, finished before capture, or used a shorter duration than Lanterna.
- Only static/runtime/dependency frames: the workload is too shallow, mostly serving static assets, stuck in startup, or missing the expensive route/job.
- Queue consumer idle: no messages were available, the queue/topic/group is wrong, offsets were already consumed, or producer rate is too low.
- Hang / no completion: the workload command never exits, the target never becomes ready, or an external dependency is blocked.

## Validation

Use the same workload before and after a fix. Change only one thing at a time: code, dependency version, Node flags, concurrency, or payload. If the first capture was mostly idle or missing auth headers, discard it as non-representative and rerun before diagnosing.
