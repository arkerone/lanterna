// CPU hotspot demo — synchronous password hashing blocks the event loop.
// Run with `--kind cpu` and you should see:
//   - finding: sync-crypto-on-hot-path
//   - hotspots dominated by node:internal/crypto/pbkdf2
//   - low summary.userCodeRatio (the cost is native crypto, not your wrapper)
//
// An auth service verifies a stream of login attempts with pbkdf2Sync. The
// synchronous key-derivation runs on the main thread, so every verification
// blocks the event loop.

import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = 100_000;

function hashPassword(password, salt) {
  return pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('hex');
}

// Build a small user store once (each user has a salt + stored hash).
const users = [];
for (let i = 0; i < 50; i++) {
  const salt = randomBytes(16).toString('hex');
  users.push({ name: `user-${i}`, salt, hash: hashPassword(`secret-${i}`, salt) });
}

function verifyLogin(user, password) {
  return hashPassword(password, user.salt) === user.hash; // pbkdf2Sync on the hot path
}

const RUN_MS = 120_000;
const start = Date.now();
let checks = 0;
while (Date.now() - start < RUN_MS) {
  const user = users[checks % users.length];
  verifyLogin(user, `secret-${checks % users.length}`);
  checks++;
}
console.log(`verified ${checks} logins`);
