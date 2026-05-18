# Node.js Common Performance Pitfalls

Reference for the lanterna-profiler skill. Use when interpreting findings and writing suggestions.

---

## Blocking the event loop

Node.js is single-threaded. Any synchronous work on the main thread stalls **every** concurrent request, timer, and I/O callback.

**Anti-patterns:**
- `crypto.*Sync` (pbkdf2Sync, scryptSync, randomBytesSync)
- `fs.*Sync` (readFileSync, writeFileSync, statSync, existsSync, readdirSync)
- `child_process.execSync` / `spawnSync`
- `zlib.*Sync`
- Long synchronous loops (JSON.parse of huge payloads, heavy regex)

**Fix pattern:**
```js
import { pbkdf2, pbkdf2Sync } from 'node:crypto';
import { promisify } from 'node:util';
import Piscina from 'piscina';

const pbkdf2Async = promisify(pbkdf2);

// BAD
const syncHash = pbkdf2Sync(pw, salt, 100_000, 64, 'sha512');

// GOOD — async
const asyncHash = await pbkdf2Async(pw, salt, 100_000, 64, 'sha512');

// BETTER for >100 req/s — worker thread pool
const pool = new Piscina({ filename: new URL('./workers/hash.js', import.meta.url).href });
const pooledHash = await pool.run({ pw, salt });
```

---

## Plain user-code CPU hotspots

`cpu-hotspot:*` means Lanterna did not match a known API anti-pattern. When `evidence.extra.mode === "self"`, the reported user function itself is burning CPU. When `mode === "inclusive-entry"`, the reported function is the caller/context for downstream CPU and its callees need inspection first.

**Common causes:**
- nested loops over request-size data;
- repeated sorting, filtering, regex, or scoring per request;
- recomputing stable values instead of caching;
- parsing or transforming large payloads in one synchronous block;
- doing CPU-bound work that belongs in a worker pool.

**Fix pattern:**
```js
// BAD — recomputes for every request
function score(items, query) {
  return items
    .map((item) => expensiveScore(item, query))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

// GOOD — reduce input, cache stable pieces, or offload the expensive part
const normalized = new Map();
function normalizedItem(item) {
  if (!normalized.has(item.id)) normalized.set(item.id, precompute(item));
  return normalized.get(item.id);
}
```

---

## Garbage collection pressure

Too many short-lived allocations trigger frequent minor GCs (scavenge). Too many surviving objects → major GC (mark-compact) pauses.

**Causes:**
- Unbounded caches (`new Map()` that grows forever)
- Per-request object churn (`{...spread}` in hot paths)
- String concatenation in loops (`str += item` creates a new string each iteration)
- `JSON.parse(JSON.stringify(x))` for deep clone
- Large `Buffer.concat([...])` in streams

**Fix pattern:**
```js
// BAD — unbounded cache
const cache = new Map();
cache.set(key, value); // grows forever

// GOOD — bounded LRU
import { LRUCache } from 'lru-cache';
const cache = new LRUCache({ max: 500, ttl: 5 * 60 * 1000 });

// BAD — string concat in loop
let s = '';
for (const item of arr) s += item; // O(n²) allocations

// GOOD — join at the end
const s = arr.join('');

// BAD — JSON clone
const copy = JSON.parse(JSON.stringify(obj));
// GOOD
const copy = structuredClone(obj);
```

---

## V8 deoptimisations

V8 JIT-compiles hot functions based on observed types. If the types change, it deoptimises and recompiles ("deopt loop").

**Common reasons:**
| Reason | Cause | Fix |
|---|---|---|
| `not a Smi` | Mixed integer/float/non-number | Keep inputs as integers or use typed arrays |
| `wrong map` | Object shape changed (different properties or order) | Initialise all properties in the constructor, same order |
| `minus zero` | `-0` result | `value \|\| 0` or `Math.abs(value)` |
| `out of bounds` | Array access beyond length | Guard with length check |
| `insufficient type feedback` | Polymorphic call site | Specialise by type before calling |

**Fix pattern:**
```js
// BAD — different shapes cause wrong map deopt
function process(v) { return v.x + v.y; }
process({ x: 1, y: 2 });
process({ y: 2, x: 1 });   // different property order!

// GOOD — stable shape
function process(v) { return v.x + v.y; }
process({ x: 1, y: 2 });
process({ x: 3, y: 4 });   // same shape every time
```

---

## Require / import in hot path

`require()` resolves the module graph, reads files, and executes module code. This is expensive and is meant to happen once at startup.

**Fix pattern:**
```js
// BAD — require inside a request handler
app.get('/route', (req, res) => {
  const { parse } = require('some-lib'); // resolves every call!
  res.json(parse(req.body));
});

// GOOD — hoist to module level
import { parse } from 'some-lib';
app.get('/route', (req, res) => res.json(parse(req.body)));

// GOOD — lazy singleton if load is too slow at startup
let _parse;
function getParse() {
  return (_parse ??= require('some-lib').parse);
}
```

---

## Worker threads for CPU-bound work

```js
// worker.js
import { parentPort, workerData } from 'node:worker_threads';
import { pbkdf2Sync } from 'node:crypto';
parentPort.postMessage(pbkdf2Sync(workerData.pw, workerData.salt, 100_000, 64, 'sha512'));

// main.js — with piscina (pool management)
import Piscina from 'piscina';
const pool = new Piscina({ filename: new URL('./worker.js', import.meta.url).href });
const hash = await pool.run({ pw, salt });
```

---

## Useful Node.js flags

| Flag | Use |
|---|---|
| `--trace-gc` | Print GC events to stderr |
| `--trace-deopt` | Print deoptimisation events (use with `lanterna run --deep`) |
| `--trace-opt` | Print optimisation events |
| `--inspect` | Open Chrome DevTools for heap/CPU profiling |
| `--heap-prof` | Write heap allocation profile |
