import chalk from 'chalk';
import ora from 'ora';

export interface ActivityIndicator {
  update(message: string): void;
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
  const spinner = ora({
    text: chalk.cyan(label),
    prefixText: chalk.bold('lanterna'),
    color: 'cyan',
    stream: process.stderr,
  }).start();

  return {
    update(message) {
      if (options.keepHistory && currentMessage !== message) {
        spinner.stopAndPersist({
          symbol: chalk.green('✔'),
          text: chalk.green(currentMessage),
          prefixText: chalk.bold('lanterna'),
        });
        spinner.start();
      }
      currentMessage = message;
      spinner.text = chalk.cyan(message);
    },
    succeed(message) {
      spinner.succeed(message ? chalk.green(message) : undefined);
    },
    fail(message) {
      if (options.keepHistory) {
        spinner.stopAndPersist({
          symbol: chalk.red('✖'),
          text: chalk.red(currentMessage),
          prefixText: chalk.bold('lanterna'),
        });
        if (message) {
          process.stderr.write(`${chalk.red(message)}\n`);
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
