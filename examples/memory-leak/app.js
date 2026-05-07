// Memory leak demo — unbounded cache with a closure retainer.
// Run with `--kind memory` and you should see:
//   - finding: memory-growth (rss and/or heapUsed slope > 0)
//   - finding: large-allocator pointing at `cacheLine`
//   - heap snapshot analysis flags `cache` as a retainer pattern (with --heap-snapshot-analysis)

const cache = new Map();

function cacheLine(key, payload) {
  // Allocate a fresh string + retain via closure wrapper to defeat GC.
  const heavy = payload.repeat(256);
  const wrapper = () => heavy;
  cache.set(key, wrapper);
}

let i = 0;
const interval = setInterval(() => {
  for (let j = 0; j < 200; j++) {
    cacheLine(`k-${i++}`, `payload-${Math.random().toString(36)}`);
  }
}, 50);

setTimeout(() => {
  clearInterval(interval);
  console.log(`cache holds ${cache.size} entries`);
}, 30_000);
