// Fixture: triggers sync-crypto-on-hot-path detector.
// Calls pbkdf2Sync in a tight loop so it appears on the hot path.
import { pbkdf2Sync } from 'node:crypto';

const salt = Buffer.from('lanterna-test-salt');

function hashPassword(password) {
  return pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
}

// Run for a while so the profiler catches it
const deadline = Date.now() + 60_000;
let i = 0;
while (Date.now() < deadline) {
  hashPassword(`password-${i++}`);
}
