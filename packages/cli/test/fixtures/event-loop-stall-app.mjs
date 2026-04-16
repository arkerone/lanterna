// Fixture: triggers event-loop-stall detector.
// Blocks the event loop deliberately with a busy-wait loop.
function busyWait(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* spin */ }
}

// Stall every 200ms for 300ms → p99 lag > 100ms
const deadline = Date.now() + 60_000;
let round = 0;
function tick() {
  busyWait(300); // block for 300ms
  round++;
  if (Date.now() < deadline) setImmediate(tick);
}
tick();
