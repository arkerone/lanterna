#!/usr/bin/env node
import { main } from '../dist/main.js';

main(process.argv.slice(2)).catch((err) => {
  process.exitCode = 1;
  if (err && typeof err === 'object' && err.lanternaReported === true) {
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lanterna: ${message}\n`);
});
