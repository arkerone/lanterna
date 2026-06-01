// FIXED long-await — the downstream call carries a short deadline and resolves
// fast. Verified to produce NO `long-await` finding (no async op lives ≥ 100ms).
//
// Driven by a setInterval so each request is its own async context (rather than
// a tight `while { await }` loop, which would build an ever-deeper trigger chain).

function fastDownstreamCall(id) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(`resp-${id}`), 5); // ~5ms, well within budget
  });
}

let handled = 0;
const interval = setInterval(async () => {
  await fastDownstreamCall(handled++);
}, 25);

setTimeout(() => {
  clearInterval(interval);
  console.log(`handled ${handled} requests`);
}, 120_000);
