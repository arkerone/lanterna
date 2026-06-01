// Alloc-in-hot-path demo — one function is both CPU-hot and a top allocator.
// Run with `--kind cpu,memory` and you should see:
//   - finding: alloc-in-hot-path:... on `buildReport` (or its caller `tick`)
//   - the same frame ranked in both profiles.cpu.hotspots and
//     profiles.memory.hotAllocators
//
// `buildReport` allocates a batch of row objects (the bulk of sampled bytes) and
// sums over them (the CPU). The rows are kept in a small bounded ring buffer so
// they actually escape onto the heap (otherwise V8 scalar-replaces them and no
// allocation is sampled). Work yields via setImmediate so the heap sampler runs.

const recent = []; // bounded ring buffer — forces real heap allocation
const RING = 60;

function buildReport(rowCount) {
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push({ id: i, label: `row-${i}`, values: [i, i * 2, i * 3], meta: { even: i % 2 === 0 } });
  }
  let checksum = 0;
  for (const row of rows) checksum += row.values[0] + row.values[1] + row.values[2];
  rows.checksum = checksum;
  return rows;
}

let running = true;
let reports = 0;
let sink = 0;

function tick() {
  if (!running) return;
  for (let batch = 0; batch < 20; batch++) {
    const report = buildReport(3000);
    recent.push(report);
    if (recent.length > RING) recent.shift();
    sink += report.checksum;
    reports += 1;
  }
  setImmediate(tick); // yield so the memory sampler / poller can run
}
tick();

setTimeout(() => {
  running = false;
  console.log(`built ${reports} reports (${sink})`);
}, 120_000);
