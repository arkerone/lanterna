// External buffer pressure demo — off-heap memory dwarfs the V8 heap.
// Run with `--kind memory` and you should see:
//   - finding: external-buffer-pressure (external >= 0.5x heapUsed)
//   - profiles.memory.series.external well above heapUsed
//
// A blob cache (decoded images / file bodies) keeps binary data in Buffers.
// Buffers live off-heap, outside V8's GC reach, so heapUsed stays small while
// `external` balloons — a leak that never shows up in a heap snapshot.

const blobs = [];

function cacheBlob(sizeBytes) {
  const buf = Buffer.allocUnsafe(sizeBytes); // off-heap allocation
  buf.fill(7);
  blobs.push(buf); // retained -> never collected
}

// Seed a 48 MB working set so `external` is already above the 32 MB floor when
// capture starts, then keep leaking ~4 MB per tick (capped to avoid OOM).
for (let i = 0; i < 48; i++) cacheBlob(1024 * 1024);

const MAX_BLOBS = 400;
const interval = setInterval(() => {
  if (blobs.length < MAX_BLOBS) {
    for (let i = 0; i < 4; i++) cacheBlob(1024 * 1024);
  }
}, 100);

setTimeout(() => {
  clearInterval(interval);
  console.log(`cached ${blobs.length} blobs (~${blobs.length} MB off-heap)`);
}, 120_000);
