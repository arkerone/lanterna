// CPU hotspot demo — synchronous crypto on a hot path.
// Run with Lanterna and you should see:
//   - finding: sync-crypto-on-hot-path
//   - hotspot dominated by node:internal/crypto
//   - high userCodeRatio for `hashPassword` if frame attribution lands there

import { pbkdf2Sync } from 'node:crypto';

function hashPassword(password, salt) {
  return pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
}

function processBatch(size) {
  const out = [];
  for (let i = 0; i < size; i++) {
    out.push(hashPassword(`user-${i}`, `salt-${i}`));
  }
  return out;
}

const start = Date.now();
let total = 0;
while (Date.now() - start < 25_000) {
  total += processBatch(20).length;
}
console.log(`hashed ${total} passwords in 25s`);
