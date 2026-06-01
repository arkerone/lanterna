// FIXED microtask-flood — process work at a bounded rate, draining each batch.
// Verified to produce NO `microtask-flood` finding (inflight stays small).
//
// A setInterval ticks at a fixed cadence and launches a small, awaited batch.
// Each tick is its own async context triggered by the timer (so no ever-growing
// trigger chain), and the backlog never builds up.

function asyncTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

let launched = 0;
const interval = setInterval(async () => {
  const batch = [];
  for (let i = 0; i < 32; i++) batch.push(asyncTask()); // small, bounded batch
  await Promise.all(batch); // drain it before the next tick
  launched += 32;
}, 25);

setTimeout(() => {
  clearInterval(interval);
  console.log(`processed ${launched} tasks`);
}, 120_000);
