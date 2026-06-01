// Long await demo — async operations without a timeout sit idle for ~250ms.
// Run with `--kind cpu,async` and you should see:
//   - finding: long-await:... (an async op alive >= 100ms)
//   - profiles.async.topOperations ranked by duration, anchored on the call site
//
// Simulates calling a slow downstream service (no timeout) on each request.

function slowDownstreamCall(id) {
  return new Promise((resolve) => {
    // ~250ms round-trip, well past the 100ms p99 latency budget.
    setTimeout(() => resolve(`resp-${id}`), 250);
  });
}

async function handleRequest(id) {
  const res = await slowDownstreamCall(id); // the long await
  return res.length;
}

let running = true;
(async () => {
  let id = 0;
  while (running) {
    await handleRequest(id++); // sequential: each request waits ~250ms
  }
})();

setTimeout(() => {
  running = false;
  console.log('long-await demo done');
}, 120_000);
