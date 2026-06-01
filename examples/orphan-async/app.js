// Orphan async resources demo — async handles created but never cleaned up.
// Run with `--kind async` and you should see:
//   - finding: orphan-async-resource (>= 50 resources never resolved/destroyed)
//   - the dominant init frame pointed at `startJob`
//
// Each "job" schedules a long retry timer but the cleanup path is missing, so
// these async resources pile up and never destroy — a listener/timer leak.

const leaked = [];

function startJob(id) {
  // A retry timer scheduled far in the future and never cleared.
  const timer = setTimeout(() => {}, 60 * 60 * 1000);
  leaked.push(timer);
  return id;
}

// Leak ~300 resources up front, then keep leaking a few per tick.
for (let i = 0; i < 300; i++) startJob(i);

let next = 300;
const ticker = setInterval(() => {
  startJob(next++);
}, 50);

setTimeout(() => {
  clearInterval(ticker);
  console.log(`leaked ${leaked.length} async resources`);
  process.exit(0);
}, 120_000);
