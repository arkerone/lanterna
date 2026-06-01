// FIXED orphan-async — every timer is short-lived and removes itself.
// Verified to produce NO `orphan-async-resource` finding (no async resource is
// left pending older than the detector's age threshold).

const active = new Set();

function startJob(id) {
  const timer = setTimeout(() => {
    active.delete(timer); // fires quickly and cleans up after itself
  }, 50);
  active.add(timer);
  return id;
}

for (let i = 0; i < 300; i++) startJob(i);

let next = 300;
const ticker = setInterval(() => {
  startJob(next++);
}, 50);

setTimeout(() => {
  clearInterval(ticker);
  for (const timer of active) clearTimeout(timer);
  console.log('orphan-async (fixed) done');
  process.exit(0);
}, 120_000);
