// Async latency demo — exercises the async kind's latency-cause classifier.
// Run with `--kind cpu,async`. Reliably classified, per profiles.async.topOperations:
//   - latencyCause: "event-loop-blocked"  (callback ready, loop busy) plus a
//                                          top-level event-loop-blocked-async finding
//   - latencyCause: "cpu-bound"           (the handler itself burns CPU)
//   - latencyCause: "io-wait"             (genuine fs read, no stall overlap)
// The other two cases illustrate the classifier's LIMITS (see docs/kinds/async.md):
//   - downstreamCase -> usually "unknown": the awaited inner work only *waits*
//                       (a timer), so there are no descendant *run* windows.
//   - gcCase         -> usually "cpu-bound"/"unknown": real GC pauses rarely
//                       cover >=50% of a wait, so "gc-pause" seldom fires.

import { readFile } from 'node:fs/promises';

const PKG_LOCK = new URL('../../package-lock.json', import.meta.url);

function blockLoopFor(ms) {
  const end = Date.now() + ms;
  // Synchronous busy-loop: nothing else on the loop can run until this returns.
  while (Date.now() < end) {
    /* spin */
  }
}

// 1) event-loop-blocked: a timer is scheduled, then the loop is blocked so the
//    callback fires hundreds of ms late — the latency is the block, not the timer.
async function eventLoopBlockedCase() {
  const ready = new Promise((resolve) => setTimeout(resolve, 30));
  blockLoopFor(350);
  await ready;
}

// 2) downstreamCase: outer awaits a slow inner timer. Classifies as "unknown",
//    not "downstream-async" — the inner only waits (a timer), it never runs, so
//    there are no descendant run windows to attribute the wait to.
async function inner() {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
async function downstreamCase() {
  await inner();
}

// 3) cpu-bound: the awaited work is CPU, not waiting.
async function cpuBoundCase() {
  await Promise.resolve();
  let acc = 0;
  for (let i = 0; i < 5_000_000; i += 1) acc += Math.sqrt(i) * Math.sin(i);
  return acc;
}

// 4) io-wait: a real filesystem read with no loop stall around it.
async function ioWaitCase() {
  const buf = await readFile(PKG_LOCK, 'utf8');
  return buf.length;
}

// 5) gcCase: allocate aggressively to provoke GC. Usually "cpu-bound"/"unknown":
//    real GC pauses rarely cover >=50% of a wait, so "gc-pause" seldom fires.
async function gcCase() {
  const sink = [];
  for (let i = 0; i < 40; i += 1) {
    sink.push(new Array(50_000).fill(i));
    await Promise.resolve();
  }
  return sink.length;
}

let running = true;
async function tick() {
  await eventLoopBlockedCase();
  await downstreamCase();
  await cpuBoundCase();
  await ioWaitCase();
  await gcCase();
}

(async () => {
  while (running) {
    await tick();
  }
})();

setTimeout(() => {
  running = false;
  console.log('async-latency demo done');
}, 20_000);
