#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv.slice(2)).catch((err) => {
  process.exitCode = 1;
  process.stderr.write(`lanterna: ${err.stack || err.message || err}\n`);
});
