import chalk from 'chalk';
import gradient from 'gradient-string';

const lanternGradient = gradient(['#d97706', '#f59e0b', '#fbbf24', '#fde68a']);

const LANTERNA_WORDMARK = `  ██╗      █████╗ ███╗   ██╗████████╗███████╗██████╗ ███╗   ██╗ █████╗
  ██║     ██╔══██╗████╗  ██║╚══██╔══╝██╔════╝██╔══██╗████╗  ██║██╔══██╗
  ██║     ███████║██╔██╗ ██║   ██║   █████╗  ██████╔╝██╔██╗ ██║███████║
  ██║     ██╔══██║██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗██║╚██╗██║██╔══██║
  ███████╗██║  ██║██║ ╚████║   ██║   ███████╗██║ ╚██╗██║ ╚████║██║  ██║
  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝`;

const RULE_CHAR = '─';
const MIN_RULE_WIDTH = 44;

interface BrandHeaderOptions {
  title?: string;
  subtitle: string;
  accent?: string;
  version?: string;
}

export function renderBrandHeader({
  subtitle,
  accent = 'Agent-first Node.js profiler',
  version,
}: BrandHeaderOptions): string {
  const wordmark = renderWordmark(version);
  const tagline = chalk.hex('#f59e0b')(subtitle);
  const accentLine = chalk.gray(`${accent}`);
  const ruleWidth = Math.max(subtitle.length, accent.length, MIN_RULE_WIDTH);
  const rule = chalk.gray(RULE_CHAR.repeat(ruleWidth));
  return `${wordmark}\n\n  ${tagline}\n  ${accentLine}\n  ${rule}`;
}

function renderWordmark(version?: string): string {
  const wordmark = lanternGradient.multiline(LANTERNA_WORDMARK);
  if (!version) return wordmark;

  const lines = wordmark.split('\n');
  lines[0] = `${lines[0]}  ${chalk.gray(`v${version}`)}`;
  return lines.join('\n');
}

interface CommandHeaderOptions {
  command: string;
  subtitle: string;
}

export function renderCommandHeader({ command, subtitle }: CommandHeaderOptions): string {
  const icon = chalk.hex('#ffb454')('◈');
  const brand = chalk.bold.cyan('LANTERNA');
  const breadcrumb = chalk.gray('›');
  const cmd = chalk.bold.hex('#fbbf24')(command.toUpperCase());
  const sep = chalk.gray('·');
  const tagline = chalk.hex('#f59e0b')(subtitle);
  const headerLine = `${icon} ${brand} ${breadcrumb} ${cmd}  ${sep}  ${tagline}`;
  const ruleWidth = Math.max(stripAnsiLength(headerLine), MIN_RULE_WIDTH);
  const rule = chalk.gray(RULE_CHAR.repeat(ruleWidth));
  return `${headerLine}\n${rule}`;
}

export function formatLanternaPrefix(): string {
  return `${chalk.hex('#ffb454')('◈')} ${chalk.bold.cyan('Lanterna')}`;
}

export function formatStepSuccessSymbol(): string {
  return chalk.hex('#ffb454')('✔');
}

export function formatStepFailureSymbol(): string {
  return chalk.red('✖');
}

export function formatStepInfoSymbol(): string {
  return chalk.hex('#22d3ee').dim('◇');
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte is required to match ANSI sequences
const ANSI_REGEX = /\[[0-9;]*m/g;
function stripAnsiLength(value: string): number {
  return value.replace(ANSI_REGEX, '').length;
}
