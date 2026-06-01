// CPU hotspot demo — a pure user-code function dominates self time.
// Run with `--kind cpu` and you should see:
//   - finding: cpu-hotspot:... anchored on `scoreDocument`
//   - high userCodeRatio (no syscall, no dependency — all the cost is your code)
//
// This is the generic CPU hotspot: work that isn't sync I/O, crypto, JSON or a
// dependency, so it surfaces as a plain user-code hotspot.

const RUN_MS = 120_000;

// A naive relevance scorer — intentionally O(doc * query) character matching.
function scoreDocument(query, doc) {
  let score = 0;
  for (let i = 0; i < doc.length; i++) {
    const a = doc.charCodeAt(i);
    for (let j = 0; j < query.length; j++) {
      const b = query.charCodeAt(j);
      score += a === b ? 2 : 1 / (1 + Math.abs(a - b));
    }
  }
  return score;
}

const query = 'performance profiler for nodejs';
const doc = 'the quick brown fox jumps over the lazy dog. '.repeat(40);

const start = Date.now();
let scored = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += scoreDocument(query, doc);
  scored++;
}
console.log(`scored ${scored} documents (${total})`);
