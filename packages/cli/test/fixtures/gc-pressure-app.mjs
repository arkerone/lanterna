// Fixture: triggers excessive-gc detector.
// Keeps references to objects long enough to promote them to old-gen,
// then releases them in bursts to generate major GC (mark-sweep) pauses.
// Uses setImmediate so the event loop ticks → PerformanceObserver fires.
const KEEP_COUNT = 20;
const retained = [];
let batch = 0;
let total = 0;

function makeObjects() {
  const arr = [];
  for (let i = 0; i < 20_000; i++) {
    arr.push({ id: i + batch * 20000, data: new Array(200).fill(i), label: `item-${i}` });
  }
  return arr;
}

const deadline = Date.now() + 60_000;

function tick() {
  if (Date.now() >= deadline) return;
  const objs = makeObjects();
  total += objs.reduce((s, o) => s + o.id, 0);

  // Keep some to promote to old-gen, then flush older batches
  retained.push(objs);
  if (retained.length > KEEP_COUNT) {
    retained.splice(0, Math.floor(KEEP_COUNT / 2));
  }

  batch++;
  setImmediate(tick);
}
tick();

process.on('exit', () => { if (total < 0) console.log('x'); });
