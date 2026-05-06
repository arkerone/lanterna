# Workload Guidance

Use this when a Lanterna capture needs representative load. The workload must reproduce the user-visible symptom during the profiling window; otherwise the report can be idle, exercise the wrong route, or measure an unauthenticated error path.

## Interactive Workflow

Ask only the questions needed to build the next capture:

1. What symptom should the workload reproduce: latency, throughput drop, CPU saturation, event-loop delay, memory growth, OOM, async wait, or startup cost?
2. Which endpoint, job, queue consumer, cron task, or user flow shows the symptom?
3. What request details are required: method, URL, body, content type, query params, tenant/project id, cookies, bearer token, API key, custom headers, and accepted response status?
4. What is representative traffic: concurrency, request rate, duration, ramp-up, payload size, route mix, data cardinality, cache state, and external dependencies?
5. What metric will prove the issue improved: p95/p99 latency, throughput, CPU self time, event-loop delay, RSS/heap slope, GC pause time, or async wait time?

If auth or tenant context matters, ask for a safe short-lived token or a local test credential. Do not ask the user to paste production secrets into a persistent file. Prefer environment variables for headers in shell commands.

## Autocannon

Use autocannon for a single HTTP endpoint or a small set of requests where latency, throughput, and CPU are the main concern.

Simple GET:

```bash
npx -y autocannon -c 50 -d 30 http://localhost:3000/api/search?q=test
```

Bearer token and JSON body:

```bash
TOKEN=<token> npx -y autocannon -c 25 -d 30 \
  -m POST \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -b '{"query":"test","limit":50}' \
  http://localhost:3000/api/search
```

Lanterna with autocannon (two-step capture + render):

```bash
TOKEN=<token> lanterna run --duration 30s --wait-for-url http://localhost:3000/health \
  --workload 'npx -y autocannon -c 25 -d 30 -H "authorization: Bearer '"$TOKEN"'" http://localhost:3000/api/search?q=test' \
  --format json --output report.json -- node server.js
lanterna report report.json --format agent --output report.agent.md
```

Autocannon is weak for login flows, weighted route mixes, changing payloads, or setup/teardown-heavy scenarios. Use artillery or an existing load script for those.

## Artillery

Use artillery for multi-step user flows, auth-dependent behavior, weighted routes, dynamic payloads, and staged traffic.

Example `load.yml`:

```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 30
      arrivalRate: 10
  defaults:
    headers:
      authorization: "Bearer {{ $processEnvironment.TOKEN }}"
      content-type: "application/json"
scenarios:
  - name: "search flow"
    flow:
      - post:
          url: "/api/search"
          json:
            query: "test"
            limit: 50
```

Lanterna with artillery (two-step capture + render):

```bash
TOKEN=<token> lanterna run --duration 35s --wait-for-url http://localhost:3000/health \
  --workload "npx -y artillery run load.yml" \
  --format json --output report.json -- node server.js
lanterna report report.json --format agent --output report.agent.md
```

## Validation

Use the same workload before and after a fix. Change only one thing at a time: code, dependency version, Node flags, concurrency, or payload. If the first capture was mostly idle or missing auth headers, discard it as non-representative and rerun before diagnosing.
