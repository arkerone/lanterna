#!/usr/bin/env node
import { main } from '../dist/cli/main.js';
import { logger } from '../dist/shared/logger.js';

main(process.argv.slice(2)).catch((err) => {
  process.exitCode = 1;
  logger.error({ err }, 'lanterna failed');
});
