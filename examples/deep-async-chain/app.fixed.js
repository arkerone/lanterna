// FIXED deep-async-chain — a sequential queue consumer / poller.
//
// A `while { await }` loop chains each iteration onto the previous one via
// `triggerAsyncId`, so the async *trigger* depth grows without bound (hundreds
// to thousands over a run). But nothing recurses — each iteration's creation
// stack is shallow. This is the queue-consumer / poller shape that is extremely
// common in production and used to trip `deep-async-chain`.
//
// Lanterna now flags recursion-through-promises (a frame repeated in a
// resource's creation stack), not structural trigger depth, so this produces NO
// `deep-async-chain` finding: the chain's `recursionDepth` is ~1.

const RUN_MS = 120_000;

const queue = [];
let produced = 0;
// A producer keeps the queue fed so the consumer always has work.
const producer = setInterval(() => {
  for (let i = 0; i < 50; i++) queue.push(produced++);
}, 5);

function processItem(item) {
  // A little async work per item; resolves before the next iteration starts.
  return new Promise((resolve) => setImmediate(() => resolve(item * 2)));
}

let running = true;
let consumed = 0;
let sink = 0;
(async () => {
  // Sequential consumer: each iteration awaits the previous one to finish, so
  // the resources form a long linear trigger chain that is never nested.
  while (running) {
    const item = queue.shift();
    if (item === undefined) {
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }
    sink += await processItem(item);
    consumed += 1;
  }
})();

setTimeout(() => {
  running = false;
  clearInterval(producer);
  console.log(`consumed ${consumed} items (${sink})`);
}, RUN_MS);
