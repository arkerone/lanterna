// Memory leak demo — an unbounded response cache retains every session.
// Run with `--kind memory` and you should see:
//   - finding: memory-growth (rss and/or heapUsed slope > 0)
//   - finding: large-allocator pointing at `buildSession`
//   - heap snapshot analysis flags the `store` Map as a retainer (with
//     --heap-snapshot-analysis)
//
// `store` is never evicted, so every session record (built by `buildSession`)
// is retained forever — the classic unbounded-cache leak.

const store = new Map();

function buildSession(id) {
  // Allocate a chunky, retained session record — all user-attributed bytes.
  const events = [];
  for (let i = 0; i < 150; i++) {
    events.push({
      at: id * 1000 + i,
      type: `evt-${i % 8}`,
      payload: { a: i, b: i * 2, note: `value-${i}` },
    });
  }
  return { id, createdAt: Date.now(), events, scratch: new Array(400).fill(id) };
}

let next = 0;
const interval = setInterval(() => {
  for (let i = 0; i < 160; i++) {
    const id = next++;
    store.set(id, buildSession(id)); // retained forever
  }
}, 50);

setTimeout(() => {
  clearInterval(interval);
  console.log(`cache holds ${store.size} sessions`);
}, 120_000);
