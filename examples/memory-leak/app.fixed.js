// FIXED memory-leak — bounded store with a reused object pool.
// Verified to produce NO `memory-growth` / `large-allocator` finding (the keyset
// is bounded and the session records are reused, not re-allocated).

const MAX = 500;
const store = new Map();

// Pre-allocate a fixed pool of session records and reuse them in place.
const pool = [];
for (let i = 0; i < MAX; i++) pool.push({ id: 0, hits: 0, lastSeen: 0 });

let next = 0;
const interval = setInterval(() => {
  for (let i = 0; i < 160; i++) {
    const slot = next % MAX;
    const session = pool[slot];
    session.id = next;
    session.hits += 1;
    session.lastSeen = Date.now();
    store.set(slot, session); // bounded: at most MAX keys, objects reused
    next++;
  }
}, 50);

setTimeout(() => {
  clearInterval(interval);
  console.log(`store holds ${store.size} sessions`);
}, 120_000);
