// Fixture: triggers blocking-io detector.
// Calls readFileSync in a tight loop.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);

function readConfig() {
  return readFileSync(selfPath, 'utf8');
}

const deadline = Date.now() + 60_000;
let i = 0;
while (Date.now() < deadline) {
  readConfig();
  i++;
}
