// FIXED alloc-in-hot-path — reuse a pre-allocated row pool (mutate in place).
// Verified to produce NO `alloc-in-hot-path` / `large-allocator` finding (the
// hot frame no longer allocates — it only computes).

const RUN_MS = 120_000;
const ROWS = 3000;

// Allocate the row pool once, up front.
const pool = new Array(ROWS);
for (let i = 0; i < ROWS; i++) pool[i] = { id: 0, a: 0, b: 0, c: 0 };

function buildReport() {
  let checksum = 0;
  for (let i = 0; i < ROWS; i++) {
    const row = pool[i];
    row.id = i;
    row.a = i;
    row.b = i * 2;
    row.c = i * 3;
    checksum += row.a + row.b + row.c; // CPU work, but no allocation
  }
  return checksum;
}

let running = true;
let reports = 0;
let sink = 0;

function tick() {
  if (!running) return;
  for (let batch = 0; batch < 20; batch++) {
    sink += buildReport();
    reports += 1;
  }
  setImmediate(tick);
}
tick();

setTimeout(() => {
  running = false;
  console.log(`built ${reports} reports (${sink})`);
}, RUN_MS);
