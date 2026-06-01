// FIXED cpu-hotspot — async pbkdf2 keeps the event loop responsive.
// Verified to produce NO `sync-crypto-on-hot-path` finding (the work runs on the
// libuv threadpool, not the JS main thread).

import { pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);
const ITERATIONS = 100_000;

async function hashPassword(password, salt) {
  return (await pbkdf2Async(password, salt, ITERATIONS, 32, 'sha256')).toString('hex');
}

const users = [];
for (let i = 0; i < 50; i++) {
  const salt = randomBytes(16).toString('hex');
  users.push({ salt, hash: await hashPassword(`secret-${i}`, salt) });
}

let running = true;
(async () => {
  let i = 0;
  while (running) {
    const batch = [];
    for (let k = 0; k < 8; k++) {
      const user = users[i % users.length];
      batch.push(hashPassword(`secret-${i % users.length}`, user.salt));
      i++;
    }
    await Promise.all(batch); // bounded concurrency, off the main thread
  }
})();

setTimeout(() => {
  running = false;
}, 120_000);
