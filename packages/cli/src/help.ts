import chalk from 'chalk';

export interface OptionRow {
  flag: string;
  description: string;
  hint?: string;
}

const FLAG_COLUMN_WIDTH = 32;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte is required to match ANSI sequences
const ANSI_REGEX = /\[[0-9;]*m/g;

function visibleLength(value: string): number {
  return value.replace(ANSI_REGEX, '').length;
}

export function formatOptionRow(
  flag: string,
  description: string,
  hint?: string,
  width = FLAG_COLUMN_WIDTH,
): string {
  const coloredFlag = chalk.cyan(flag);
  const padding = Math.max(2, width - visibleLength(flag));
  const tail = hint ? `  ${chalk.gray(`(${hint})`)}` : '';
  return `  ${coloredFlag}${' '.repeat(padding)}${description}${tail}`;
}

export function formatSection(title: string, rows: string[]): string {
  if (rows.length === 0) return chalk.bold(title);
  return `${chalk.bold(title)}\n${rows.join('\n')}`;
}

export interface ExampleEntry {
  comment: string;
  cmd: string;
}

export function formatExamples(title: string, examples: ExampleEntry[]): string {
  const blocks = examples.map(({ comment, cmd }) => `  ${chalk.gray(`# ${comment}`)}\n  ${cmd}`);
  return `${chalk.bold(title)}\n${blocks.join('\n\n')}`;
}

export function formatNotes(title: string, notes: string[]): string {
  const bullets = notes.map((note) => `  ${chalk.hex('#22d3ee').dim('·')} ${note}`);
  return `${chalk.bold(title)}\n${bullets.join('\n')}`;
}

export function formatFooterHint(message: string): string {
  return chalk.gray(message);
}

export function formatUnknownCommandError(command: string): string {
  const head = chalk.red.bold('Error');
  const sep = chalk.red('›');
  return `${head} ${sep} Unknown command: ${chalk.bold(command)}\n${chalk.gray(
    'Run `lanterna --help` to see available commands.',
  )}\n`;
}
