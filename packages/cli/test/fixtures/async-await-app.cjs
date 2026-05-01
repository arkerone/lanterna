setTimeout(() => {
  const { run } = require('./async-await-worker.cjs');
  void run();
}, 300);
