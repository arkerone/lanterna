async function waitForSlowOperation() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function asyncChain(depth) {
  if (depth <= 0) return;
  await new Promise((resolve) => setImmediate(resolve));
  return asyncChain(depth - 1);
}

exports.run = async function run() {
  const start = Date.now();
  while (Date.now() - start < 1200) {
    await waitForSlowOperation();
    await asyncChain(8);
  }
};
