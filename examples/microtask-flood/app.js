// Microtask flood demo — unbounded async fan-out saturates the event loop.
// Run with `--kind async` and you should see:
//   - finding: microtask-flood (mean inflight >= 200)
//   - profiles.async.summary.concurrency with a high mean/max inflight
//
// Simulates consuming a firehose without backpressure: every tick we launch
// hundreds of async tasks and never wait for them, so the backlog never drains.

function asyncTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

let running = true;
let launched = 0;

function pump() {
  if (!running) return;
  // Keep a large backlog inflight at all times — no concurrency cap, no await.
  for (let i = 0; i < 800; i++) asyncTask();
  launched += 800;
  setImmediate(pump);
}
pump();

setTimeout(() => {
  running = false;
  console.log(`flooded with ${launched} tasks`);
}, 120_000);
