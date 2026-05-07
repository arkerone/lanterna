// Event-loop stall demo — periodic synchronous fs read on a hot path.
// Run with Lanterna and you should see:
//   - finding: blocking-io (readFileSync on a hot stack)
//   - finding: event-loop-stall (lag spikes correlated with the sync read)
//   - eventLoop.histogram with elevated p99 / max

import { readFileSync } from 'node:fs';

function loadConfig() {
  // Re-reads package-lock.json synchronously every iteration.
  // Replace with cached read or fs.promises to fix.
  return readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8').length;
}

let total = 0;
const interval = setInterval(() => {
  // Light async work
  setImmediate(() => {
    total += 1;
  });
  // Blocking sync work — stalls the loop
  total += loadConfig();
}, 25);

setTimeout(() => {
  clearInterval(interval);
  console.log(`accumulated ${total}`);
}, 25_000);
