import { writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import ora from 'ora';
import {
  formatLanternaPrefix,
  formatStepFailureSymbol,
  formatStepInfoSymbol,
  formatStepSuccessSymbol,
} from './terminal-style.js';

export interface ActivityIndicator {
  update(message: string): void;
  info(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
}

interface StartActivityIndicatorOptions {
  keepHistory?: boolean;
}

export function startActivityIndicator(
  label: string,
  options: StartActivityIndicatorOptions = {},
): ActivityIndicator {
  let currentMessage = label;
  let stepStartedAt = performance.now();
  const spinner = ora({
    text: chalk.cyanBright(label),
    prefixText: formatLanternaPrefix(),
    color: 'cyan',
    stream: process.stderr,
  }).start();

  function elapsedHint(): string {
    const ms = Math.max(0, performance.now() - stepStartedAt);
    if (ms < 1000) return chalk.gray(` (${Math.round(ms)}ms)`);
    return chalk.gray(` (${(ms / 1000).toFixed(1)}s)`);
  }

  function persistCurrent(symbol: string, color: (s: string) => string): void {
    spinner.stopAndPersist({
      symbol,
      text: `${color(currentMessage)}${elapsedHint()}`,
      prefixText: formatLanternaPrefix(),
    });
  }

  return {
    update(message) {
      if (options.keepHistory && currentMessage !== message) {
        persistCurrent(formatStepSuccessSymbol(), chalk.green);
        spinner.start();
        stepStartedAt = performance.now();
      }
      currentMessage = message;
      spinner.text = chalk.cyanBright(message);
    },
    info(message) {
      if (options.keepHistory) {
        persistCurrent(formatStepInfoSymbol(), (s) => chalk.gray(s));
        spinner.start();
        stepStartedAt = performance.now();
      }
      currentMessage = message;
      spinner.text = chalk.cyanBright(message);
    },
    succeed(message) {
      spinner.succeed(message ? chalk.green(message) : undefined);
    },
    fail(message) {
      if (options.keepHistory) {
        persistCurrent(formatStepFailureSymbol(), chalk.red);
        if (message) {
          writeStderrLine(chalk.red(message));
        }
        return;
      }
      if (!process.stderr.isTTY) {
        spinner.stop();
        if (message) {
          writeStderrLine(chalk.red(message));
        }
        return;
      }
      spinner.fail(message ? chalk.red(message) : undefined);
    },
    stop() {
      spinner.stop();
    },
  };
}

function writeStderrLine(message: string): void {
  writeSync(2, `${message}\n`);
}
