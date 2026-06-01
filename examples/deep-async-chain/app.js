// Deep async chain demo — recursion through awaited promises builds a deep chain.
// Run with `--kind cpu,async` and you should see:
//   - finding: deep-async-chain (chain depth >= 30)
//   - profiles.async chain rooted in `resolveLevel`
//
// A recursive resolver awaits itself ~40 levels deep — e.g. walking a nested
// structure with an `await` at every level instead of iterating.

async function resolveLevel(depth) {
  // A microtask hop at each level so async_hooks records a fresh resource,
  // linking child -> parent into one deep trigger chain.
  await Promise.resolve();
  if (depth <= 0) return 0;
  return 1 + (await resolveLevel(depth - 1));
}

let running = true;
(async () => {
  while (running) {
    await resolveLevel(40);
  }
})();

setTimeout(() => {
  running = false;
  console.log('deep-async-chain demo done');
}, 120_000);
