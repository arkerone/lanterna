// FIXED external-buffer — a small, fixed buffer pool that is reused.
// Verified to produce NO `external-buffer-pressure` finding (off-heap memory
// stays well under the detector's absolute floor and never grows).

const POOL = 12; // 12 MB total, reused forever
const buffers = [];
for (let i = 0; i < POOL; i++) buffers.push(Buffer.allocUnsafe(1024 * 1024));

let n = 0;
const interval = setInterval(() => {
  const buf = buffers[n % POOL];
  buf.fill(n & 0xff); // reuse an existing buffer; no new off-heap allocation
  n++;
}, 20);

setTimeout(() => {
  clearInterval(interval);
  console.log(`reused a pool of ${buffers.length} buffers`);
}, 120_000);
